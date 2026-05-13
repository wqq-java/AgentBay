import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from './db.js';
import { createGroup } from './groups.js';
import { createTopic, listTopicsByGroup, getTopic, resolveTopic, reopenTopic } from './topics.js';

let dbPath: string;
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `tp-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
});
afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

describe('topics catalog', () => {
  it('createTopic in group', () => {
    const g = createGroup(db, { name: 'team' });
    const t = createTopic(db, { groupId: g.id, title: '加 API' });
    expect(t.title).toBe('加 API');
    expect(t.state).toBe('open');
    expect(t.groupId).toBe(g.id);
  });

  it('listTopicsByGroup filters by group', () => {
    const g1 = createGroup(db, { name: 'g1' });
    const g2 = createGroup(db, { name: 'g2' });
    createTopic(db, { groupId: g1.id, title: 't1' });
    createTopic(db, { groupId: g1.id, title: 't2' });
    createTopic(db, { groupId: g2.id, title: 't3' });
    expect(listTopicsByGroup(db, g1.id)).toHaveLength(2);
    expect(listTopicsByGroup(db, g2.id)).toHaveLength(1);
  });

  it('onlyOpen filter', () => {
    const g = createGroup(db, { name: 'g' });
    const open = createTopic(db, { groupId: g.id, title: 'open' });
    const resolved = createTopic(db, { groupId: g.id, title: 'done' });
    resolveTopic(db, resolved.id);
    const list = listTopicsByGroup(db, g.id, { onlyOpen: true });
    expect(list.map(t => t.id)).toEqual([open.id]);
  });

  it('resolveTopic sets state + resolvedAt', () => {
    const g = createGroup(db, { name: 'g' });
    const t = createTopic(db, { groupId: g.id, title: 't' });
    const resolved = resolveTopic(db, t.id);
    expect(resolved?.state).toBe('resolved');
    expect(resolved?.resolvedAt).toBeGreaterThan(0);
  });

  it('reopenTopic clears resolvedAt', () => {
    const g = createGroup(db, { name: 'g' });
    const t = createTopic(db, { groupId: g.id, title: 't' });
    resolveTopic(db, t.id);
    const reopened = reopenTopic(db, t.id);
    expect(reopened?.state).toBe('open');
    expect(reopened?.resolvedAt).toBeNull();
  });

  it('resolveTopic is idempotent on already-resolved', () => {
    const g = createGroup(db, { name: 'g' });
    const t = createTopic(db, { groupId: g.id, title: 't' });
    resolveTopic(db, t.id);
    const first = getTopic(db, t.id)?.resolvedAt;
    resolveTopic(db, t.id);
    const second = getTopic(db, t.id)?.resolvedAt;
    expect(second).toBe(first); // resolvedAt 不被覆盖
  });
});
