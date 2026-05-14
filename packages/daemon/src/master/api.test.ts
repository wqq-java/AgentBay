import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { openDb, closeDb } from '../store/db.js';
import { upsertAgent } from '../store/agents.js';
import { createGroup } from '../store/groups.js';
import { startHttpServer } from '../http/server.js';
import { createSseHub } from '../http/sse.js';
import type { Agent } from '@agent-bay/shared';

let dbPath: string;
let db: ReturnType<typeof openDb>;
let server: Awaited<ReturnType<typeof startHttpServer>>;
let url: string;
let token: string;

function mkAgent(id: string, opts: Partial<Agent> = {}): Agent {
  return {
    id, name: id, role: null, tmuxTarget: id, pid: 1, tool: 'claude-code',
    status: 'online', statusMeta: null, groupId: null, isSpawned: false,
    lastSeenAt: Date.now(), createdAt: Date.now(), ...opts,
  };
}

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  dbPath = path.join(os.tmpdir(), `mapi-${stamp}.db`);
  db = openDb(dbPath);
  token = `test-token-${stamp}`;
  const sse = createSseHub();
  server = await startHttpServer({ db, port: 0, sse, masterToken: token });
  const addr = server.address() as AddressInfo;
  url = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await server.stop();
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

function authHeaders(t = token) {
  return { 'authorization': `Bearer ${t}`, 'content-type': 'application/json' };
}

describe('master API · auth', () => {
  it('rejects missing token', async () => {
    const r = await fetch(`${url}/api/master/health`);
    expect(r.status).toBe(401);
  });

  it('rejects wrong token', async () => {
    const r = await fetch(`${url}/api/master/health`, { headers: { authorization: 'Bearer wrong' } });
    expect(r.status).toBe(401);
  });

  it('accepts correct token', async () => {
    const r = await fetch(`${url}/api/master/health`, { headers: authHeaders() });
    expect(r.status).toBe(200);
    const d = await r.json() as { role: string };
    expect(d.role).toBe('master');
  });
});

describe('master API · capture / full', () => {
  it('returns 404 for unknown agent', async () => {
    const r = await fetch(`${url}/api/master/agents/${encodeURIComponent('%nope')}/capture`, { headers: authHeaders() });
    expect(r.status).toBe(404);
  });

  it('returns full state for known agent', async () => {
    upsertAgent(db, mkAgent('%a1', { name: 'frontend' }));
    const r = await fetch(`${url}/api/master/agents/${encodeURIComponent('%a1')}/full`, { headers: authHeaders() });
    expect(r.status).toBe(200);
    const d = await r.json() as { agent: { name: string }; recent_capture: string };
    expect(d.agent.name).toBe('frontend');
    expect(typeof d.recent_capture).toBe('string');
  });
});

describe('master API · escalations', () => {
  it('POST creates,GET lists,POST :id/resolve marks resolved', async () => {
    let r = await fetch(`${url}/api/master/escalations`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ severity: 'warn', message: 'test escalation' }),
    });
    expect(r.status).toBe(200);
    const created = (await r.json() as { escalation: { id: number; severity: string } }).escalation;
    expect(created.severity).toBe('warn');

    r = await fetch(`${url}/api/master/escalations`, { headers: authHeaders() });
    const list = (await r.json() as { escalations: { id: number }[] }).escalations;
    expect(list.map(e => e.id)).toContain(created.id);

    r = await fetch(`${url}/api/master/escalations/${created.id}/resolve`, {
      method: 'POST', headers: authHeaders(),
    });
    const resolved = (await r.json() as { escalation: { resolved: boolean } }).escalation;
    expect(resolved.resolved).toBe(true);
  });

  it('rejects invalid severity', async () => {
    const r = await fetch(`${url}/api/master/escalations`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ severity: 'fatal', message: 'x' }),
    });
    expect(r.status).toBe(400);
  });

  it('only_open filter', async () => {
    await fetch(`${url}/api/master/escalations`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ severity: 'info', message: 'a' }),
    });
    const e2 = (await (await fetch(`${url}/api/master/escalations`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ severity: 'info', message: 'b' }),
    })).json() as { escalation: { id: number } }).escalation;
    await fetch(`${url}/api/master/escalations/${e2.id}/resolve`, { method: 'POST', headers: authHeaders() });

    const r2 = await fetch(`${url}/api/master/escalations?only_open=1`, { headers: authHeaders() });
    const open = (await r2.json() as { escalations: { message: string }[] }).escalations;
    expect(open.map(e => e.message)).toEqual(['a']);
  });
});

describe('master API · group membership', () => {
  it('add + remove member', async () => {
    const g = createGroup(db, { name: 'team-x' });
    upsertAgent(db, mkAgent('%m1'));

    let r = await fetch(`${url}/api/master/groups/${g.id}/members`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ agent_id: '%m1' }),
    });
    expect(r.status).toBe(200);
    let d = await r.json() as { agent: { groupId: string | null } };
    expect(d.agent.groupId).toBe(g.id);

    r = await fetch(`${url}/api/master/groups/${g.id}/members/${encodeURIComponent('%m1')}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    expect(r.status).toBe(200);
    d = await r.json() as { agent: { groupId: string | null } };
    expect(d.agent.groupId).toBeNull();
  });

  it('reject if agent not in this group', async () => {
    const g = createGroup(db, { name: 'team' });
    upsertAgent(db, mkAgent('%m'));
    const r = await fetch(`${url}/api/master/groups/${g.id}/members/${encodeURIComponent('%m')}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    expect(r.status).toBe(409);
  });
});

describe('master API · send-keys', () => {
  it('rejects missing both text and key', async () => {
    upsertAgent(db, mkAgent('%s'));
    const r = await fetch(`${url}/api/master/send-keys`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ agent_id: '%s' }),
    });
    expect(r.status).toBe(400);
  });

  it('rejects when agent gone', async () => {
    upsertAgent(db, mkAgent('%g', { status: 'gone' }));
    const r = await fetch(`${url}/api/master/send-keys`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ agent_id: '%g', text: 'hi' }),
    });
    expect(r.status).toBe(410);
  });
});
