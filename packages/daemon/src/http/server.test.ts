import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { openDb, closeDb } from '../store/db.js';
import { upsertAgent } from '../store/agents.js';
import { createGroup } from '../store/groups.js';
import { createTopic } from '../store/topics.js';
import { startHttpServer } from './server.js';
import { createSseHub } from './sse.js';
import type { Agent } from '@agent-bay/shared';

let dbPath: string;
let db: ReturnType<typeof openDb>;
let server: Awaited<ReturnType<typeof startHttpServer>>;
let url: string;
let sse: ReturnType<typeof createSseHub>;

function mkAgent(id: string, name: string, opts: Partial<Agent> = {}): Agent {
  return {
    id, name, role: null, tmuxTarget: id, pid: 1, tool: 'claude-code',
    status: 'online', statusMeta: null, groupId: null,
    lastSeenAt: Date.now(), createdAt: Date.now(), isSpawned: false, ...opts,
  };
}

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `http-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
  sse = createSseHub();
  server = await startHttpServer({ db, port: 0, sse });
  const addr = server.address() as AddressInfo;
  url = `http://127.0.0.1:${addr.port}`;
});
afterEach(async () => {
  await server.stop();
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

describe('http server', () => {
  it('GET /api/health', async () => {
    const r = await fetch(`${url}/api/health`);
    expect(r.status).toBe(200);
    expect((await r.json() as { ok: boolean }).ok).toBe(true);
  });

  it('GET /api/snapshot empty', async () => {
    const r = await fetch(`${url}/api/snapshot`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ agents: [], groups: [], topics: [] });
  });

  it('GET /api/snapshot with data', async () => {
    const g = createGroup(db, { name: 'team' });
    upsertAgent(db, mkAgent('%0', 'alice'));
    createTopic(db, { groupId: g.id, title: 'planning' });
    const r = await fetch(`${url}/api/snapshot`);
    const d = await r.json() as { agents: unknown[]; groups: unknown[]; topics: unknown[] };
    expect(d.agents).toHaveLength(1);
    expect(d.groups).toHaveLength(1);
    expect(d.topics).toHaveLength(1);
  });

  it('POST /api/groups creates group', async () => {
    const r = await fetch(`${url}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'new-team' }),
    });
    expect(r.status).toBe(200);
    const d = await r.json() as { group: { name: string } };
    expect(d.group.name).toBe('new-team');
  });

  it('POST /api/groups rejects duplicate name', async () => {
    createGroup(db, { name: 'dup' });
    const r = await fetch(`${url}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'dup' }),
    });
    expect(r.status).toBe(409);
  });

  it('POST /api/groups/:id/agents binds agent', async () => {
    const g = createGroup(db, { name: 'team' });
    upsertAgent(db, mkAgent('%0', 'alice'));
    const r = await fetch(`${url}/api/groups/${g.id}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent_id: '%0' }),
    });
    expect(r.status).toBe(200);
    const d = await r.json() as { agent: { groupId: string } };
    expect(d.agent.groupId).toBe(g.id);
  });

  it('PATCH /api/agents/:id/name renames', async () => {
    upsertAgent(db, mkAgent('%0', 'alice'));
    const r = await fetch(`${url}/api/agents/${encodeURIComponent('%0')}/name`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'frontend' }),
    });
    expect(r.status).toBe(200);
    const d = await r.json() as { agent: { name: string } };
    expect(d.agent.name).toBe('frontend');
  });

  it('POST /api/topics creates topic', async () => {
    const g = createGroup(db, { name: 't' });
    const r = await fetch(`${url}/api/topics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ group_id: g.id, title: 'plan A' }),
    });
    expect(r.status).toBe(200);
    const d = await r.json() as { topic: { title: string } };
    expect(d.topic.title).toBe('plan A');
  });

  it('POST /api/topics/:id/resolve', async () => {
    const g = createGroup(db, { name: 'g' });
    const t = createTopic(db, { groupId: g.id, title: 't' });
    const r = await fetch(`${url}/api/topics/${t.id}/resolve`, { method: 'POST' });
    expect(r.status).toBe(200);
    const d = await r.json() as { topic: { state: string } };
    expect(d.topic.state).toBe('resolved');
  });

  it('GET /api/topics/:id/messages returns messages', async () => {
    const g = createGroup(db, { name: 'g' });
    const t = createTopic(db, { groupId: g.id, title: 't' });
    db.prepare(`INSERT INTO messages (topic_id, from_agent_id, body, ts, kind) VALUES (?, NULL, ?, ?, 'text')`)
      .run(t.id, 'hello', Date.now());
    const r = await fetch(`${url}/api/topics/${t.id}/messages`);
    const d = await r.json() as { messages: { body: string }[] };
    expect(d.messages).toHaveLength(1);
    expect(d.messages[0].body).toBe('hello');
  });

  it('bind only 127.0.0.1', () => {
    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
  });
});
