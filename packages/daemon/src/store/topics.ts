import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Topic, TopicState } from '@agent-bay/shared';

interface Row {
  id: string;
  group_id: string;
  title: string;
  state: TopicState;
  resolved_at: number | null;
  created_at: number;
  created_by: string | null;
}

function rowToTopic(r: Row): Topic {
  return {
    id: r.id,
    groupId: r.group_id,
    title: r.title,
    state: r.state,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

export function createTopic(
  db: Database.Database,
  opts: { groupId: string; title: string; createdBy?: string | null },
): Topic {
  const t: Topic = {
    id: randomUUID(),
    groupId: opts.groupId,
    title: opts.title,
    state: 'open',
    resolvedAt: null,
    createdAt: Date.now(),
    createdBy: opts.createdBy ?? null,
  };
  db.prepare(`
    INSERT INTO topics (id, group_id, title, state, resolved_at, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(t.id, t.groupId, t.title, t.state, t.resolvedAt, t.createdAt, t.createdBy);
  return t;
}

export function listTopicsByGroup(
  db: Database.Database,
  groupId: string,
  opts: { onlyOpen?: boolean } = {},
): Topic[] {
  const sql = opts.onlyOpen
    ? `SELECT * FROM topics WHERE group_id = ? AND state = 'open' ORDER BY created_at ASC`
    : `SELECT * FROM topics WHERE group_id = ? ORDER BY created_at ASC`;
  return db.prepare<[string], Row>(sql).all(groupId).map(rowToTopic);
}

export function listAllTopics(db: Database.Database): Topic[] {
  return db.prepare<[], Row>(`SELECT * FROM topics ORDER BY created_at ASC`).all().map(rowToTopic);
}

export function getTopic(db: Database.Database, id: string): Topic | null {
  const r = db.prepare<[string], Row>(`SELECT * FROM topics WHERE id = ?`).get(id);
  return r ? rowToTopic(r) : null;
}

export function resolveTopic(db: Database.Database, id: string): Topic | null {
  db.prepare(`UPDATE topics SET state = 'resolved', resolved_at = ? WHERE id = ? AND state = 'open'`).run(Date.now(), id);
  return getTopic(db, id);
}

export function reopenTopic(db: Database.Database, id: string): Topic | null {
  db.prepare(`UPDATE topics SET state = 'open', resolved_at = NULL WHERE id = ?`).run(id);
  return getTopic(db, id);
}
