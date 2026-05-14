import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from './db.js';
import { createGroup } from './groups.js';
import { createTopic } from './topics.js';
import { upsertAgent } from './agents.js';
import {
  insertMessage, listMessagesByTopic, markRead, getUnreadCount, listUnreadMessages,
} from './messages.js';
import type { Agent } from '@agent-bay/shared';

let dbPath: string;
let db: ReturnType<typeof openDb>;
let groupId: string;
let topicId: string;

function mkAgent(id: string): Agent {
  return {
    id, name: id, role: null, tmuxTarget: id, pid: 1, tool: 'claude-code',
    status: 'online', statusMeta: null, groupId: null, isSpawned: false,
    lastSeenAt: Date.now(), createdAt: Date.now(),
  };
}

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `msg-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
  groupId = createGroup(db, { name: 'g' }).id;
  topicId = createTopic(db, { groupId, title: 't' }).id;
  upsertAgent(db, mkAgent('alice'));
  upsertAgent(db, mkAgent('bob'));
});
afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

describe('messages catalog', () => {
  it('insertMessage assigns id + ts', () => {
    const m = insertMessage(db, { topicId, fromAgentId: 'alice', body: 'hi' });
    expect(m.id).toBeGreaterThan(0);
    expect(m.kind).toBe('text');
    expect(m.body).toBe('hi');
  });

  it('listMessagesByTopic returns in ts order', () => {
    insertMessage(db, { topicId, fromAgentId: 'alice', body: '1' });
    insertMessage(db, { topicId, fromAgentId: 'bob', body: '2' });
    insertMessage(db, { topicId, fromAgentId: 'alice', body: '3' });
    const ms = listMessagesByTopic(db, topicId);
    expect(ms.map(m => m.body)).toEqual(['1', '2', '3']);
  });

  it('markRead + getUnreadCount', () => {
    const m1 = insertMessage(db, { topicId, fromAgentId: 'bob', body: '1' });
    insertMessage(db, { topicId, fromAgentId: 'bob', body: '2' });
    insertMessage(db, { topicId, fromAgentId: 'bob', body: '3' });
    expect(getUnreadCount(db, 'alice', topicId)).toBe(3);
    markRead(db, 'alice', topicId, m1.id);
    expect(getUnreadCount(db, 'alice', topicId)).toBe(2);
  });

  it('listUnreadMessages returns only new', () => {
    const m1 = insertMessage(db, { topicId, fromAgentId: 'bob', body: '1' });
    insertMessage(db, { topicId, fromAgentId: 'bob', body: '2' });
    insertMessage(db, { topicId, fromAgentId: 'bob', body: '3' });
    markRead(db, 'alice', topicId, m1.id);
    const unread = listUnreadMessages(db, 'alice', topicId);
    expect(unread.map(m => m.body)).toEqual(['2', '3']);
  });

  it('image kind inferred from imagePath', () => {
    const m = insertMessage(db, { topicId, fromAgentId: 'alice', body: 'see', imagePath: '/tmp/x.png' });
    expect(m.kind).toBe('image');
    expect(m.imagePath).toBe('/tmp/x.png');
  });
});
