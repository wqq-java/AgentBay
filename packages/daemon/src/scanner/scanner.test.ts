import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from '../store/db.js';
import { listAgents, getAgent } from '../store/agents.js';
import { createScanner } from './scanner.js';
import type { TmuxPane } from './tmux.js';
import type { ServerEvent } from '@agent-bay/shared';

let dbPath: string;
let db: ReturnType<typeof openDb>;
let events: ServerEvent[];
const broadcast = vi.fn((e: ServerEvent) => { events.push(e); });

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `sc-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
  events = [];
  broadcast.mockClear();
});
afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

function mkPane(paneId: string, command = 'claude', extra: Partial<TmuxPane> = {}): TmuxPane {
  // paneId 形如 '%5',我们也派生一个像样的 target 给字段填上
  const n = Number(paneId.replace('%', '') || '0');
  return {
    paneId,
    target: `main:0.${n}`,
    pid: 1000 + n,
    command,
    title: command,
    sessionName: 'main',
    windowIndex: 0,
    paneIndex: n,
    ...extra,
  };
}

describe('scanner', () => {
  it('first tick creates agents for new panes', async () => {
    const scanner = createScanner({
      db, broadcast, captureSource: async () => '',
      paneSource: async () => [mkPane('%0'), mkPane('%1')],
    });
    const result = await scanner.tick();
    expect(result.created.sort()).toEqual(['%0', '%1']);
    expect(listAgents(db)).toHaveLength(2);
    expect(events.filter(e => e.type === 'agent-created')).toHaveLength(2);
  });

  it('second tick on same panes does not broadcast', async () => {
    const panes = [mkPane('%0')];
    const scanner = createScanner({ db, broadcast, paneSource: async () => panes, captureSource: async () => '' });
    await scanner.tick();
    events.length = 0; broadcast.mockClear();
    const result = await scanner.tick();
    expect(result.created).toEqual([]);
    expect(result.gone).toEqual([]);
    expect(events).toEqual([]);
  });

  it('disappeared pane marked gone', async () => {
    let panes = [mkPane('%0'), mkPane('%1')];
    const scanner = createScanner({ db, broadcast, paneSource: async () => panes, captureSource: async () => '' });
    await scanner.tick();
    events.length = 0;

    panes = [mkPane('%0')]; // %1 gone
    const result = await scanner.tick();
    expect(result.gone).toEqual(['%1']);
    expect(getAgent(db, '%1')?.status).toBe('gone');
    expect(events.some(e => e.type === 'agent-gone' && (e as { agentId: string }).agentId === '%1')).toBe(true);
  });

  it('returning pane(gone → online again) broadcasts agent-updated', async () => {
    let panes = [mkPane('%0')];
    const scanner = createScanner({ db, broadcast, paneSource: async () => panes, captureSource: async () => '' });
    await scanner.tick();
    panes = [];
    await scanner.tick(); // marked gone
    events.length = 0;

    panes = [mkPane('%0')];
    await scanner.tick();
    // status 检测后会立刻 detectStatus 把 online 改成 idle(空 capture)
    // 关键是不再是 gone,且广播了 agent-updated
    expect(getAgent(db, '%0')?.status).not.toBe('gone');
    expect(events.some(e => e.type === 'agent-updated')).toBe(true);
  });

  it('infers tool from command', async () => {
    const scanner = createScanner({
      db, broadcast, captureSource: async () => '',
      paneSource: async () => [
        mkPane('%0', 'claude'),
        mkPane('%1', 'codex'),
        mkPane('%2', 'zsh'),
      ],
    });
    await scanner.tick();
    expect(getAgent(db, '%0')?.tool).toBe('claude-code');
    expect(getAgent(db, '%1')?.tool).toBe('codex');
    expect(getAgent(db, '%2')?.tool).toBe('unknown');
  });

  it('preserves user-set name when re-detected', async () => {
    const panes = [mkPane('%0', 'claude', { title: 'claude' })];
    const scanner = createScanner({ db, broadcast, paneSource: async () => panes, captureSource: async () => '' });
    await scanner.tick();
    db.prepare(`UPDATE agents SET name = 'frontend' WHERE id = '%0'`).run();
    await scanner.tick();
    expect(getAgent(db, '%0')?.name).toBe('frontend');
  });

  it('preserves groupId when re-detected', async () => {
    db.exec(`INSERT INTO groups (id, name, is_dm, created_at) VALUES ('g1', 'team', 0, ${Date.now()})`);
    const panes = [mkPane('%0')];
    const scanner = createScanner({ db, broadcast, paneSource: async () => panes, captureSource: async () => '' });
    await scanner.tick();
    db.prepare(`UPDATE agents SET group_id = 'g1' WHERE id = '%0'`).run();
    await scanner.tick();
    expect(getAgent(db, '%0')?.groupId).toBe('g1');
  });
});
