import type Database from 'better-sqlite3';
import type { Message, MessageKind } from '@agent-bay/shared';

interface Row {
  id: number;
  topic_id: string;
  from_agent_id: string | null;
  body: string;
  image_path: string | null;
  ts: number;
  kind: MessageKind;
}

function rowToMessage(r: Row): Message {
  return {
    id: r.id,
    topicId: r.topic_id,
    fromAgentId: r.from_agent_id,
    body: r.body,
    imagePath: r.image_path,
    ts: r.ts,
    kind: r.kind,
  };
}

export function insertMessage(
  db: Database.Database,
  opts: {
    topicId: string;
    fromAgentId: string | null;
    body: string;
    imagePath?: string | null;
    kind?: MessageKind;
  },
): Message {
  const ts = Date.now();
  const kind: MessageKind = opts.kind ?? (opts.imagePath ? 'image' : 'text');
  const info = db.prepare(`
    INSERT INTO messages (topic_id, from_agent_id, body, image_path, ts, kind)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(opts.topicId, opts.fromAgentId, opts.body, opts.imagePath ?? null, ts, kind);
  return {
    id: Number(info.lastInsertRowid),
    topicId: opts.topicId,
    fromAgentId: opts.fromAgentId,
    body: opts.body,
    imagePath: opts.imagePath ?? null,
    ts,
    kind,
  };
}

export function listMessagesByTopic(
  db: Database.Database,
  topicId: string,
  opts: { limit?: number; sinceId?: number } = {},
): Message[] {
  const limit = opts.limit ?? 200;
  if (opts.sinceId != null) {
    return db.prepare<[string, number, number], Row>(
      `SELECT * FROM messages WHERE topic_id = ? AND id > ? ORDER BY ts ASC LIMIT ?`,
    ).all(topicId, opts.sinceId, limit).map(rowToMessage);
  }
  return db.prepare<[string, number], Row>(
    `SELECT * FROM messages WHERE topic_id = ? ORDER BY ts ASC LIMIT ?`,
  ).all(topicId, limit).map(rowToMessage);
}

export function markRead(
  db: Database.Database,
  agentId: string,
  topicId: string,
  lastMessageId: number,
): void {
  db.prepare(`
    INSERT INTO read_marks (agent_id, topic_id, last_message_id)
    VALUES (?, ?, ?)
    ON CONFLICT(agent_id, topic_id) DO UPDATE SET last_message_id = excluded.last_message_id
  `).run(agentId, topicId, lastMessageId);
}

export function getUnreadCount(
  db: Database.Database,
  agentId: string,
  topicId: string,
): number {
  const row = db.prepare<[string, string, string], { c: number }>(`
    SELECT COUNT(*) AS c FROM messages
    WHERE topic_id = ? AND id > COALESCE((SELECT last_message_id FROM read_marks WHERE agent_id = ? AND topic_id = ?), 0)
  `).get(topicId, agentId, topicId);
  return row?.c ?? 0;
}

export function listUnreadMessages(
  db: Database.Database,
  agentId: string,
  topicId: string,
  limit = 200,
): Message[] {
  return db.prepare<[string, string, string, number], Row>(`
    SELECT * FROM messages
    WHERE topic_id = ? AND id > COALESCE((SELECT last_message_id FROM read_marks WHERE agent_id = ? AND topic_id = ?), 0)
    ORDER BY ts ASC LIMIT ?
  `).all(topicId, agentId, topicId, limit).map(rowToMessage);
}
