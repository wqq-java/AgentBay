import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { startDaemon } from './main.js';

let tmpHome: string;
let projectsDir: string;
let dbPath: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  tmpHome = path.join(os.tmpdir(), `cth-${stamp}`);
  projectsDir = path.join(tmpHome, '.claude', 'projects');
  dbPath = path.join(tmpHome, '.claude-teams', 'state.db');
  fs.mkdirSync(projectsDir, { recursive: true });

  // 预放一个 jsonl 让 discovery 能找到
  const wsDir = path.join(projectsDir, '-test-repo');
  fs.mkdirSync(wsDir);
  fs.writeFileSync(
    path.join(wsDir, 'sess-fixture.jsonl'),
    JSON.stringify({ type: 'user', sessionId: 'sess-fixture', cwd: '/test/repo' }) + '\n'
  );

  daemon = await startDaemon({ port: 0, dbPath, claudeProjectsDir: projectsDir });
});

afterEach(async () => {
  await daemon.stop();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('daemon main', () => {
  it('starts and runs discovery before accepting requests', async () => {
    const r = await fetch(`http://127.0.0.1:${daemon.port}/api/snapshot`);
    const snap = await r.json();
    expect(snap.sessions.map((s: { id: string }) => s.id)).toContain('sess-fixture');
  });

  it('handles SessionStart hook end-to-end', async () => {
    const r = await fetch(`http://127.0.0.1:${daemon.port}/api/hook-event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'live-sess', cwd: '/live/repo' }),
    });
    expect(r.status).toBe(200);
    const snap = await (await fetch(`http://127.0.0.1:${daemon.port}/api/snapshot`)).json();
    expect(snap.sessions.map((s: { id: string }) => s.id)).toContain('live-sess');
  });
});
