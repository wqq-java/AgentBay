import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from './db.js';
import {
  upsertAgent, listAgents, listOnlineAgents, getAgent, getAgentByTmuxTarget,
  markAgentGone, updateAgentStatus, updateAgentGroup, renameAgent,
} from './agents.js';
import { createGroup } from './groups.js';
import type { Agent } from '@agent-bay/shared';

let dbPath: string;
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `ag-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
});
afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

function mk(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'main:0.1',
    name: 'pane-1',
    role: null,
    tmuxTarget: 'main:0.1',
    pid: 1234,
    tool: 'claude-code',
    status: 'online',
    statusMeta: null,
    groupId: null,
    isSpawned: false,
    lastSeenAt: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('agents catalog', () => {
  it('upsert + get roundtrip', () => {
    const a = mk();
    upsertAgent(db, a);
    expect(getAgent(db, a.id)).toEqual(a);
  });

  it('upsert is idempotent (same id updates fields)', () => {
    upsertAgent(db, mk());
    upsertAgent(db, mk({ name: 'renamed', status: 'idle' }));
    expect(listAgents(db)).toHaveLength(1);
    const got = getAgent(db, 'main:0.1');
    expect(got?.name).toBe('renamed');
    expect(got?.status).toBe('idle');
  });

  it('listOnlineAgents excludes gone', () => {
    upsertAgent(db, mk({ id: 'a', tmuxTarget: 'a', status: 'online' }));
    upsertAgent(db, mk({ id: 'b', tmuxTarget: 'b', status: 'idle' }));
    upsertAgent(db, mk({ id: 'c', tmuxTarget: 'c', status: 'gone' }));
    const list = listOnlineAgents(db);
    expect(list.map(a => a.id).sort()).toEqual(['a', 'b']);
  });

  it('getAgentByTmuxTarget finds by target', () => {
    upsertAgent(db, mk({ id: 'x', tmuxTarget: 'sess:1.2' }));
    expect(getAgentByTmuxTarget(db, 'sess:1.2')?.id).toBe('x');
    expect(getAgentByTmuxTarget(db, 'nope')).toBeNull();
  });

  it('markAgentGone sets status', () => {
    upsertAgent(db, mk());
    markAgentGone(db, 'main:0.1');
    expect(getAgent(db, 'main:0.1')?.status).toBe('gone');
  });

  it('updateAgentStatus updates status + meta', () => {
    upsertAgent(db, mk());
    updateAgentStatus(db, 'main:0.1', 'rate-limited', { resetsAt: 1000 });
    const got = getAgent(db, 'main:0.1');
    expect(got?.status).toBe('rate-limited');
    expect(got?.statusMeta).toEqual({ resetsAt: 1000 });
  });

  it('updateAgentGroup binds to group', () => {
    const g = createGroup(db, { name: 'team-a' });
    upsertAgent(db, mk());
    updateAgentGroup(db, 'main:0.1', g.id);
    expect(getAgent(db, 'main:0.1')?.groupId).toBe(g.id);
  });

  it('renameAgent updates name', () => {
    upsertAgent(db, mk());
    renameAgent(db, 'main:0.1', 'frontend');
    expect(getAgent(db, 'main:0.1')?.name).toBe('frontend');
  });

  it('statusMeta JSON roundtrips correctly', () => {
    upsertAgent(db, mk({ statusMeta: { x: 1, y: ['a', 'b'] } }));
    const got = getAgent(db, 'main:0.1');
    expect(got?.statusMeta).toEqual({ x: 1, y: ['a', 'b'] });
  });
});
