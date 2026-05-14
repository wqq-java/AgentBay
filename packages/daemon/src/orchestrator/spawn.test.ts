import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from '../store/db.js';
import { upsertAgent } from '../store/agents.js';
import { createGroup } from '../store/groups.js';
import { configSchema } from '../config/config.js';
import { spawnWorker, killWorker, waitForAgent } from './spawn.js';
import type { Agent } from '@agent-bay/shared';

let dbPath: string;
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `sp-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
});
afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

function mkAgent(id: string, opts: Partial<Agent> = {}): Agent {
  return {
    id, name: id, role: null, tmuxTarget: id, pid: 1, tool: 'claude-code',
    status: 'online', statusMeta: null, groupId: null, isSpawned: false,
    lastSeenAt: Date.now(), createdAt: Date.now(), ...opts,
  };
}

describe('spawnWorker', () => {
  const cfg = configSchema.parse({ spawn: { commands: ['claude', 'codex'] } });

  it('happy path: ensure session → new window → wait for scanner pickup → mark spawned', async () => {
    const ensureSession = vi.fn(async () => { /* noop */ });
    const newWindow = vi.fn(async () => ({ paneId: '%99', windowIndex: 5 }));
    // 模拟 scanner:在 spawnWorker 等待中,我们手动 upsert 这个 agent
    setTimeout(() => upsertAgent(db, mkAgent('%99')), 100);

    const r = await spawnWorker(db, cfg, {
      command: 'claude', cwd: '/Users/eoi/EOI', name: 'worker-1',
      ensureSession, newWindow,
      waitTimeoutMs: 2000,
      jsonlWaitTimeoutMs: 0,
    });
    expect(r.agent.id).toBe('%99');
    expect(r.agent.isSpawned).toBe(true);
    expect(ensureSession).toHaveBeenCalled();
    expect(newWindow).toHaveBeenCalled();
  });

  it('rejects when command not in allowlist', async () => {
    await expect(spawnWorker(db, cfg, {
      command: 'rm -rf /', cwd: '/', ensureSession: async () => {}, newWindow: async () => ({ paneId: '%1', windowIndex: 0 }),
    })).rejects.toThrow(/not in spawn allowlist/);
  });

  it('rejects when scanner does not pick up in time', async () => {
    await expect(spawnWorker(db, cfg, {
      command: 'claude', cwd: '/',
      ensureSession: async () => {},
      newWindow: async () => ({ paneId: '%dead', windowIndex: 0 }),
      waitTimeoutMs: 300,
    })).rejects.toThrow(/scanner did not pick it up/);
  });

  it('joins group when groupId given', async () => {
    const g = createGroup(db, { name: 'team' });
    setTimeout(() => upsertAgent(db, mkAgent('%5')), 100);
    const r = await spawnWorker(db, cfg, {
      command: 'claude', cwd: '/',
      groupId: g.id,
      ensureSession: async () => {},
      newWindow: async () => ({ paneId: '%5', windowIndex: 0 }),
      waitTimeoutMs: 2000,
      jsonlWaitTimeoutMs: 0,
    });
    expect(r.agent.groupId).toBe(g.id);
  });

  it('respects maxConcurrent', async () => {
    const cfg2 = configSchema.parse({ spawn: { commands: ['claude'], maxConcurrent: 1 } });
    upsertAgent(db, mkAgent('%existing', { isSpawned: true }));
    await expect(spawnWorker(db, cfg2, {
      command: 'claude', cwd: '/',
      ensureSession: async () => {},
      newWindow: async () => ({ paneId: '%new', windowIndex: 0 }),
    })).rejects.toThrow(/concurrent worker limit/);
  });
});

describe('killWorker', () => {
  it('kills isSpawned agent', async () => {
    upsertAgent(db, mkAgent('%w', { isSpawned: true }));
    const killImpl = vi.fn();
    const r = await killWorker(db, { agentId: '%w', killImpl });
    expect(r.killedTarget).toBe('%w');
    expect(killImpl).toHaveBeenCalledWith('%w');
  });

  it('refuses to kill non-spawned agent', async () => {
    upsertAgent(db, mkAgent('%manual', { isSpawned: false }));
    await expect(killWorker(db, { agentId: '%manual', killImpl: async () => {} })).rejects.toThrow(/not spawned/);
  });

  it('force=true bypasses isSpawned check', async () => {
    upsertAgent(db, mkAgent('%manual', { isSpawned: false }));
    const killImpl = vi.fn();
    await killWorker(db, { agentId: '%manual', force: true, killImpl });
    expect(killImpl).toHaveBeenCalled();
  });

  it('refuses to kill missing agent', async () => {
    await expect(killWorker(db, { agentId: '%nope', killImpl: async () => {} })).rejects.toThrow(/not found/);
  });

  it('refuses to kill already-gone agent', async () => {
    upsertAgent(db, mkAgent('%dead', { isSpawned: true, status: 'gone' }));
    await expect(killWorker(db, { agentId: '%dead', killImpl: async () => {} })).rejects.toThrow(/already gone/);
  });
});

describe('waitForAgent', () => {
  it('returns immediately if agent already there', async () => {
    upsertAgent(db, mkAgent('%here'));
    const a = await waitForAgent(db, { agentId: '%here', timeoutMs: 500 });
    expect(a.id).toBe('%here');
  });

  it('waits for agent to appear', async () => {
    setTimeout(() => upsertAgent(db, mkAgent('%late')), 100);
    const a = await waitForAgent(db, { agentId: '%late', timeoutMs: 1000 });
    expect(a.id).toBe('%late');
  });

  it('throws on timeout', async () => {
    await expect(waitForAgent(db, { agentId: '%never', timeoutMs: 200 })).rejects.toThrow(/timed out/);
  });

  it('finds by name', async () => {
    upsertAgent(db, mkAgent('%x', { name: 'frontend' }));
    const a = await waitForAgent(db, { agentName: 'frontend', timeoutMs: 500 });
    expect(a.name).toBe('frontend');
  });

  it('skips gone agent when looking by id', async () => {
    upsertAgent(db, mkAgent('%g', { status: 'gone' }));
    await expect(waitForAgent(db, { agentId: '%g', timeoutMs: 200 })).rejects.toThrow(/timed out/);
  });
});
