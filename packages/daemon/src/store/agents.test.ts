import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from './db.js';
import { createOrGetWorkspaceByCwd } from './workspaces.js';
import { upsertSession } from './sessions.js';
import {
  upsertAgent,
  listAgentsBySession,
  getAgent,
  updateAgentState,
  updateAgentTokens,
} from './agents.js';
import type { Agent, Session } from '@agent-bay/shared';

let dbPath: string;
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `ag-test-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
});
afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

function seed(): Session {
  const ws = createOrGetWorkspaceByCwd(db, '/test');
  const s: Session = {
    id: 'sess-A', workspaceId: ws.id, mode: 'observed', pid: null, state: 'running',
    jsonlPath: '/tmp/x.jsonl', jsonlOffset: 0, startedAt: Date.now(), endedAt: null,
  };
  upsertSession(db, s);
  return s;
}

describe('agents catalog', () => {
  it('upsertAgent inserts and id is sessionId:name', () => {
    const s = seed();
    const a: Agent = {
      id: `${s.id}:main`, sessionId: s.id, name: 'main', role: null,
      state: 'idle', tokenCount: 0, contextPct: 0, lastActivityAt: null,
    };
    upsertAgent(db, a);
    expect(getAgent(db, a.id)).toEqual(a);
  });

  it('listAgentsBySession returns agents in name order', () => {
    const s = seed();
    upsertAgent(db, { id: `${s.id}:main`, sessionId: s.id, name: 'main', role: null, state: 'idle', tokenCount: 0, contextPct: 0, lastActivityAt: null });
    upsertAgent(db, { id: `${s.id}:backend`, sessionId: s.id, name: 'backend', role: 'general-purpose', state: 'idle', tokenCount: 0, contextPct: 0, lastActivityAt: null });
    const list = listAgentsBySession(db, s.id);
    expect(list.map(a => a.name).sort()).toEqual(['backend', 'main']);
  });

  it('updateAgentState updates state and lastActivityAt', () => {
    const s = seed();
    const a: Agent = { id: `${s.id}:main`, sessionId: s.id, name: 'main', role: null, state: 'idle', tokenCount: 0, contextPct: 0, lastActivityAt: null };
    upsertAgent(db, a);
    updateAgentState(db, a.id, 'thinking');
    const updated = getAgent(db, a.id)!;
    expect(updated.state).toBe('thinking');
    expect(updated.lastActivityAt).toBeGreaterThan(0);
  });

  it('updateAgentTokens updates count and context pct', () => {
    const s = seed();
    const a: Agent = { id: `${s.id}:main`, sessionId: s.id, name: 'main', role: null, state: 'idle', tokenCount: 0, contextPct: 0, lastActivityAt: null };
    upsertAgent(db, a);
    updateAgentTokens(db, a.id, 12345, 0.42);
    const got = getAgent(db, a.id)!;
    expect(got.tokenCount).toBe(12345);
    expect(got.contextPct).toBeCloseTo(0.42);
  });
});
