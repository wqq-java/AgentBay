import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from './db.js';
import { createOrGetWorkspaceByCwd } from './workspaces.js';
import {
  upsertSession,
  listSessions,
  listSessionsByWorkspace,
  getSession,
  updateSessionState,
  updateSessionJsonlOffset,
} from './sessions.js';
import type { Session } from '@agent-bay/shared';

let dbPath: string;
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `sess-test-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
});
afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

function makeSession(overrides: Partial<Session> = {}): Session {
  const ws = createOrGetWorkspaceByCwd(db, '/test/repo');
  return {
    id: 'sess-1',
    workspaceId: ws.id,
    mode: 'observed',
    pid: null,
    state: 'running',
    jsonlPath: '/tmp/fake.jsonl',
    jsonlOffset: 0,
    startedAt: Date.now(),
    endedAt: null,
    ...overrides,
  };
}

describe('sessions catalog', () => {
  it('upsertSession inserts new row', () => {
    const s = makeSession();
    upsertSession(db, s);
    expect(getSession(db, s.id)).toEqual(s);
  });

  it('upsertSession is idempotent (same id updates)', () => {
    const s = makeSession();
    upsertSession(db, s);
    upsertSession(db, { ...s, state: 'idle' });
    expect(getSession(db, s.id)?.state).toBe('idle');
    expect(listSessions(db)).toHaveLength(1);
  });

  it('updateSessionState updates only state', () => {
    const s = makeSession();
    upsertSession(db, s);
    updateSessionState(db, s.id, 'idle');
    expect(getSession(db, s.id)?.state).toBe('idle');
  });

  it('updateSessionJsonlOffset persists offset', () => {
    const s = makeSession();
    upsertSession(db, s);
    updateSessionJsonlOffset(db, s.id, 2048);
    expect(getSession(db, s.id)?.jsonlOffset).toBe(2048);
  });

  it('listSessionsByWorkspace filters by workspace', () => {
    const ws1 = createOrGetWorkspaceByCwd(db, '/ws1');
    const ws2 = createOrGetWorkspaceByCwd(db, '/ws2');
    upsertSession(db, makeSession({ id: 's1', workspaceId: ws1.id }));
    upsertSession(db, makeSession({ id: 's2', workspaceId: ws2.id }));
    upsertSession(db, makeSession({ id: 's3', workspaceId: ws1.id }));
    expect(listSessionsByWorkspace(db, ws1.id).map(s => s.id).sort()).toEqual(['s1', 's3']);
    expect(listSessionsByWorkspace(db, ws2.id).map(s => s.id)).toEqual(['s2']);
  });

  it('getSession returns null for unknown id', () => {
    expect(getSession(db, 'nope')).toBeNull();
  });
});
