import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { openDb, closeDb } from '../store/db.js';
import { createOrGetWorkspaceByCwd } from '../store/workspaces.js';
import { upsertSession } from '../store/sessions.js';
import { startHttpServer } from './server.js';

let dbPath: string;
let db: ReturnType<typeof openDb>;
let server: Awaited<ReturnType<typeof startHttpServer>>;
let url: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `http-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
  server = await startHttpServer({ db, port: 0, broadcast: () => {} });
  const addr = server.address() as AddressInfo;
  url = `http://127.0.0.1:${addr.port}`;
});
afterEach(async () => {
  await server.stop();
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

describe('http server', () => {
  it('GET /api/health returns 200 ok', async () => {
    const r = await fetch(`${url}/api/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('GET /api/snapshot returns empty arrays for fresh db', async () => {
    const r = await fetch(`${url}/api/snapshot`);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data).toEqual({ workspaces: [], sessions: [], agents: [] });
  });

  it('GET /api/snapshot returns seeded data', async () => {
    const ws = createOrGetWorkspaceByCwd(db, '/foo');
    upsertSession(db, {
      id: 'sess-1', workspaceId: ws.id, mode: 'observed', pid: null, state: 'idle',
      jsonlPath: '/tmp/x.jsonl', jsonlOffset: 0, startedAt: 1000, endedAt: null,
    });
    const r = await fetch(`${url}/api/snapshot`);
    const data = await r.json();
    expect(data.workspaces).toHaveLength(1);
    expect(data.sessions).toHaveLength(1);
    expect(data.workspaces[0].cwd).toBe('/foo');
  });

  it('only binds to 127.0.0.1', () => {
    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
  });

  it('POST /api/hook-event creates session', async () => {
    const r = await fetch(`${url}/api/hook-event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'SessionStart',
        session_id: 'http-sess',
        cwd: '/test/repo',
      }),
    });
    expect(r.status).toBe(200);
    const snap = await (await fetch(`${url}/api/snapshot`)).json();
    expect(snap.sessions.map((s: { id: string }) => s.id)).toContain('http-sess');
  });

  it('POST /api/hook-event rejects invalid payload', async () => {
    const r = await fetch(`${url}/api/hook-event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ missing: 'event' }),
    });
    expect(r.status).toBe(400);
  });
});
