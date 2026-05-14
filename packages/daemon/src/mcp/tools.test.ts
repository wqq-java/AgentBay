import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from '../store/db.js';
import { upsertAgent, updateAgentGroup } from '../store/agents.js';
import { createGroup } from '../store/groups.js';
import { createTopic, resolveTopic } from '../store/topics.js';
import {
  listAgentsTool, listTopicsTool, sendMessageTool, sendDmTool, readTopicTool,
  createTopicTool, resolveTopicTool, type ToolContext,
} from './tools.js';
import type { Agent, ServerEvent } from '@agent-bay/shared';

let dbPath: string;
let db: ReturnType<typeof openDb>;
let events: ServerEvent[];
let sentKeys: Array<{ target: string; body: string; enter?: boolean }>;
let ctx: (callerId?: string | null) => ToolContext;

function mkAgent(id: string, name: string, opts: Partial<Agent> = {}): Agent {
  return {
    id, name, role: null, tmuxTarget: id, pid: 1, tool: 'claude-code',
    status: 'online', statusMeta: null, groupId: null,
    lastSeenAt: Date.now(), createdAt: Date.now(), ...opts,
  };
}

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `mcp-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
  events = [];
  sentKeys = [];
  ctx = (callerId: string | null = null): ToolContext => ({
    db,
    broadcast: vi.fn((e: ServerEvent) => { events.push(e); }),
    callerAgentId: callerId,
    sendKeys: vi.fn(async (target, body, opts) => { sentKeys.push({ target, body, ...opts }); }),
  });
});
afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

describe('list_agents', () => {
  it('returns only online agents', () => {
    upsertAgent(db, mkAgent('%0', 'alice'));
    upsertAgent(db, mkAgent('%1', 'bob', { status: 'gone' }));
    const r = listAgentsTool(ctx());
    expect(r.agents.map(a => a.name)).toEqual(['alice']);
  });
});

describe('list_topics', () => {
  it('filters by group_id', () => {
    const g1 = createGroup(db, { name: 'g1' });
    const g2 = createGroup(db, { name: 'g2' });
    createTopic(db, { groupId: g1.id, title: 't-1' });
    createTopic(db, { groupId: g2.id, title: 't-2' });
    const r = listTopicsTool(ctx(), { group_id: g1.id });
    expect(r.topics.map(t => t.title)).toEqual(['t-1']);
  });

  it('only_open by default excludes resolved', () => {
    const g = createGroup(db, { name: 'g' });
    createTopic(db, { groupId: g.id, title: 'open-1' });
    const resolved = createTopic(db, { groupId: g.id, title: 'done' });
    resolveTopic(db, resolved.id);
    const r = listTopicsTool(ctx());
    expect(r.topics.map(t => t.title)).toEqual(['open-1']);
  });
});

describe('send_message', () => {
  it('writes message and tmux send-keys to same-group agents', async () => {
    const g = createGroup(db, { name: 'g' });
    const t = createTopic(db, { groupId: g.id, title: 't' });
    upsertAgent(db, mkAgent('%0', 'alice'));
    upsertAgent(db, mkAgent('%1', 'bob'));
    upsertAgent(db, mkAgent('%2', 'charlie'));
    updateAgentGroup(db, '%0', g.id);
    updateAgentGroup(db, '%1', g.id);
    updateAgentGroup(db, '%2', g.id);

    const r = await sendMessageTool(ctx('%0'), { topic_id: t.id, body: 'hello team' });

    expect(r.message_id).toBeGreaterThan(0);
    expect(r.delivered_to.sort()).toEqual(['%1', '%2']);
    expect(sentKeys.map(s => s.target).sort()).toEqual(['%1', '%2']);
    expect(sentKeys[0].body).toMatch(/from @alice/);
    expect(sentKeys[0].body).toMatch(/hello team/);
    expect(sentKeys[0].enter).toBeUndefined();
    expect(events.some(e => e.type === 'message-created')).toBe(true);
  });

  it('does not send back to caller', async () => {
    const g = createGroup(db, { name: 'g' });
    const t = createTopic(db, { groupId: g.id, title: 't' });
    upsertAgent(db, mkAgent('%0', 'alice', { groupId: g.id }));
    const r = await sendMessageTool(ctx('%0'), { topic_id: t.id, body: 'hi' });
    expect(r.delivered_to).toEqual([]);
    expect(sentKeys).toEqual([]);
  });

  it('does not send to agents in other groups', async () => {
    const g1 = createGroup(db, { name: 'g1' });
    const g2 = createGroup(db, { name: 'g2' });
    const t = createTopic(db, { groupId: g1.id, title: 't' });
    upsertAgent(db, mkAgent('%0', 'alice', { groupId: g1.id }));
    upsertAgent(db, mkAgent('%1', 'outsider', { groupId: g2.id }));
    const r = await sendMessageTool(ctx('%0'), { topic_id: t.id, body: 'hi' });
    expect(r.delivered_to).toEqual([]);
  });

  it('throws on resolved topic', async () => {
    const g = createGroup(db, { name: 'g' });
    const t = createTopic(db, { groupId: g.id, title: 't' });
    resolveTopic(db, t.id);
    await expect(sendMessageTool(ctx('%0'), { topic_id: t.id, body: 'x' })).rejects.toThrow(/resolved/);
  });

  it('throws on missing topic', async () => {
    await expect(sendMessageTool(ctx('%0'), { topic_id: 'nope', body: 'x' })).rejects.toThrow(/not found/);
  });

  it('human-sent (no callerAgentId) shows "from @human"', async () => {
    const g = createGroup(db, { name: 'g' });
    const t = createTopic(db, { groupId: g.id, title: 't' });
    upsertAgent(db, mkAgent('%0', 'alice', { groupId: g.id }));
    await sendMessageTool(ctx(null), { topic_id: t.id, body: 'hi from terminal' });
    expect(sentKeys[0].body).toMatch(/from @human/);
  });
});

describe('read_topic', () => {
  it('returns all messages in topic', async () => {
    const g = createGroup(db, { name: 'g' });
    const t = createTopic(db, { groupId: g.id, title: 't' });
    upsertAgent(db, mkAgent('%0', 'a', { groupId: g.id }));
    upsertAgent(db, mkAgent('%1', 'b', { groupId: g.id }));
    upsertAgent(db, mkAgent('%reader2', 'reader2'));
    await sendMessageTool(ctx('%0'), { topic_id: t.id, body: 'm1' });
    await sendMessageTool(ctx('%1'), { topic_id: t.id, body: 'm2' });
    const r = readTopicTool(ctx('%reader2'), { topic_id: t.id });
    expect(r.messages.map(m => m.body)).toEqual(['m1', 'm2']);
  });

  it('unread_only filters by read mark and updates mark', async () => {
    const g = createGroup(db, { name: 'g' });
    const t = createTopic(db, { groupId: g.id, title: 't' });
    upsertAgent(db, mkAgent('%0', 'a', { groupId: g.id }));
    upsertAgent(db, mkAgent('%reader', 'reader'));
    await sendMessageTool(ctx('%0'), { topic_id: t.id, body: 'm1' });
    await sendMessageTool(ctx('%0'), { topic_id: t.id, body: 'm2' });
    // first read with unread_only
    const r1 = readTopicTool(ctx('%reader'), { topic_id: t.id, unread_only: true });
    expect(r1.messages.map(m => m.body)).toEqual(['m1', 'm2']);
    // second call (without new messages) returns []
    const r2 = readTopicTool(ctx('%reader'), { topic_id: t.id, unread_only: true });
    expect(r2.messages).toEqual([]);
  });
});

describe('create_topic', () => {
  it('creates topic + broadcasts', () => {
    const g = createGroup(db, { name: 'g' });
    upsertAgent(db, mkAgent('%caller', 'me'));
    const r = createTopicTool(ctx('%caller'), { group_id: g.id, title: 'new thread' });
    expect(r.topic.title).toBe('new thread');
    expect(r.topic.createdBy).toBe('%caller');
    expect(events.some(e => e.type === 'topic-created')).toBe(true);
  });
});

describe('send_dm(M2)', () => {
  it('creates DM group + topic on first send,delivers to target', async () => {
    upsertAgent(db, mkAgent('%alice', 'alice'));
    upsertAgent(db, mkAgent('%bob', 'bob'));
    const r = await sendDmTool(ctx('%alice'), { to_agent_id: '%bob', body: 'hi privately' });
    expect(r.topic_id).toBeTruthy();
    expect(r.delivered).toBe(true);
    expect(sentKeys[0].target).toBe('%bob');
    expect(sentKeys[0].body).toMatch(/DM @alice/);
    expect(sentKeys[0].body).toMatch(/hi privately/);
  });

  it('reuses same DM group + topic on subsequent sends', async () => {
    upsertAgent(db, mkAgent('%alice', 'alice'));
    upsertAgent(db, mkAgent('%bob', 'bob'));
    const r1 = await sendDmTool(ctx('%alice'), { to_agent_id: '%bob', body: 'msg 1' });
    const r2 = await sendDmTool(ctx('%bob'), { to_agent_id: '%alice', body: 'reply' });
    expect(r2.topic_id).toBe(r1.topic_id);
  });

  it('throws when targetting yourself', async () => {
    upsertAgent(db, mkAgent('%alice', 'alice'));
    await expect(sendDmTool(ctx('%alice'), { to_agent_id: '%alice', body: 'x' })).rejects.toThrow(/yourself/);
  });

  it('throws when target not found', async () => {
    upsertAgent(db, mkAgent('%alice', 'alice'));
    await expect(sendDmTool(ctx('%alice'), { to_agent_id: '%nope', body: 'x' })).rejects.toThrow(/not found/);
  });

  it('throws when no caller', async () => {
    upsertAgent(db, mkAgent('%bob', 'bob'));
    await expect(sendDmTool(ctx(null), { to_agent_id: '%bob', body: 'x' })).rejects.toThrow(/caller/);
  });

  it('image_path is appended to body in delivery', async () => {
    upsertAgent(db, mkAgent('%a', 'a'));
    upsertAgent(db, mkAgent('%b', 'b'));
    await sendDmTool(ctx('%a'), { to_agent_id: '%b', body: 'see this', image_path: '/tmp/x.png' });
    expect(sentKeys[0].body).toMatch(/\[image: \/tmp\/x\.png\]/);
  });
});

describe('send_message · M2 image support', () => {
  it('image_path stored on message + appended in delivery', async () => {
    const g = createGroup(db, { name: 'g' });
    const t = createTopic(db, { groupId: g.id, title: 't' });
    upsertAgent(db, mkAgent('%a', 'a', { groupId: g.id }));
    upsertAgent(db, mkAgent('%b', 'b', { groupId: g.id }));
    const r = await sendMessageTool(ctx('%a'), { topic_id: t.id, body: 'pic', image_path: '/tmp/y.png' });
    expect(r.delivered_to).toEqual(['%b']);
    expect(sentKeys[0].body).toMatch(/\[image: \/tmp\/y\.png\]/);
  });
});

describe('resolve_topic', () => {
  it('marks resolved + broadcasts', () => {
    const g = createGroup(db, { name: 'g' });
    const t = createTopic(db, { groupId: g.id, title: 't' });
    const r = resolveTopicTool(ctx(), { topic_id: t.id });
    expect(r.topic?.state).toBe('resolved');
    expect(events.some(e => e.type === 'topic-updated')).toBe(true);
  });
});
