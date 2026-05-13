import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { startDaemon } from './main.js';

let tmpDir: string;
let dbPath: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  tmpDir = path.join(os.tmpdir(), `cb-${stamp}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  dbPath = path.join(tmpDir, 'state.db');
  daemon = await startDaemon({ port: 0, dbPath, noScanner: true });
});

afterEach(async () => {
  await daemon.stop();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('daemon main', () => {
  it('starts and serves /api/health', async () => {
    const r = await fetch(`http://127.0.0.1:${daemon.port}/api/health`);
    expect(r.status).toBe(200);
  });

  it('serves empty snapshot for fresh db', async () => {
    const r = await fetch(`http://127.0.0.1:${daemon.port}/api/snapshot`);
    const d = await r.json() as { agents: unknown[]; groups: unknown[]; topics: unknown[] };
    expect(d.agents).toEqual([]);
    expect(d.groups).toEqual([]);
    expect(d.topics).toEqual([]);
  });

  it('persists data across restart', async () => {
    await fetch(`http://127.0.0.1:${daemon.port}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'persistent' }),
    });
    await daemon.stop();
    daemon = await startDaemon({ port: 0, dbPath, noScanner: true });
    const r = await fetch(`http://127.0.0.1:${daemon.port}/api/snapshot`);
    const d = await r.json() as { groups: { name: string }[] };
    expect(d.groups.map(g => g.name)).toContain('persistent');
  });
});
