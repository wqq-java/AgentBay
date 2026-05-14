// HTTP server 新版(M1)。
// Endpoints:
//   GET  /api/health
//   GET  /api/snapshot              → { agents, groups, topics }
//   GET  /api/topics/:id/messages?limit=N
//   POST /api/groups                → 创建 group
//   POST /api/groups/:id/agents     → 把 agent 加入 group(body: { agent_id })
//   PATCH /api/agents/:id/name      → 改 agent 显示名
//   POST /api/send                  → tmux send-keys 一段文本给 agent
//   POST /api/topics                → 创建 topic
//   POST /api/topics/:id/resolve    → 标 resolved
//   GET  /api/events                → SSE 流

import express from 'express';
import http from 'node:http';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { listAgents, getAgent, updateAgentGroup, renameAgent } from '../store/agents.js';
import { listGroups, createGroup, getGroup } from '../store/groups.js';
import { listAllTopics, createTopic, getTopic, resolveTopic } from '../store/topics.js';
import { listMessagesByTopic } from '../store/messages.js';
import {
  listWorkerProfiles, createWorkerProfile, deleteWorkerProfile,
} from '../store/worker-profiles.js';
import { sendKeys, sendRawKey } from '../scanner/tmux.js';
import { spawnWorker, killWorker } from '../orchestrator/spawn.js';
import { loadConfig } from '../config/config.js';
import { buildMasterRouter } from '../master/api.js';
import { ensureMasterToken } from '../master/auth.js';
import { hookEventSchema } from '../hooks/schemas.js';
import { handleHookEvent } from '../hooks/router.js';
import type { SseHub } from './sse.js';

export interface StartOpts {
  db: Database.Database;
  port: number;
  sse: SseHub;
  /** 可注入 sendKeys 实现,测试用 */
  sendKeysImpl?: typeof sendKeys;
  /** 可注入 master token,测试用;不传则 ensureMasterToken() */
  masterToken?: string;
}

export interface ServerHandle {
  stop: () => Promise<void>;
  address: () => ReturnType<http.Server['address']>;
}

const createGroupSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().optional(),
  is_dm: z.boolean().optional(),
});

const addAgentSchema = z.object({ agent_id: z.string() });

const sendSchema = z.object({
  agent_id: z.string(),
  text: z.string(),
  enter: z.boolean().optional(),
});

const sendKeySchema = z.object({
  agent_id: z.string(),
  key: z.string(),
});

const createTopicSchema = z.object({
  group_id: z.string(),
  title: z.string().min(1).max(200),
});

const renameAgentSchema = z.object({ name: z.string().min(1).max(60) });

const spawnSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().min(1),
  name: z.string().optional(),
  group_id: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  wait_timeout_ms: z.number().int().positive().optional(),
});

const workerProfileSchema = z.object({
  name: z.string().min(1).max(60),
  command: z.string().min(1),
  cwd: z.string().min(1),
  role: z.string().nullable().optional(),
  group_id: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export async function startHttpServer(opts: StartOpts): Promise<ServerHandle> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const sendKeysFn = opts.sendKeysImpl ?? sendKeys;

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: '0.0.1' });
  });

  app.get('/api/snapshot', (_req, res) => {
    res.json({
      agents: listAgents(opts.db),
      groups: listGroups(opts.db),
      topics: listAllTopics(opts.db),
    });
  });

  app.get('/api/topics/:id/messages', (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const topic = getTopic(opts.db, req.params.id);
    if (!topic) {
      res.status(404).json({ error: 'topic not found' });
      return;
    }
    res.json({
      topic,
      messages: listMessagesByTopic(opts.db, topic.id, { limit }),
    });
  });

  app.post('/api/groups', (req, res) => {
    const parsed = createGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
      return;
    }
    try {
      const group = createGroup(opts.db, {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        isDm: parsed.data.is_dm,
      });
      opts.sse.broadcast({ type: 'group-created', group });
      res.json({ group });
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  });

  app.post('/api/groups/:id/agents', (req, res) => {
    const parsed = addAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
      return;
    }
    const group = getGroup(opts.db, req.params.id);
    if (!group) { res.status(404).json({ error: 'group not found' }); return; }
    const agent = getAgent(opts.db, parsed.data.agent_id);
    if (!agent) { res.status(404).json({ error: 'agent not found' }); return; }
    updateAgentGroup(opts.db, agent.id, group.id);
    const updated = getAgent(opts.db, agent.id);
    if (updated) opts.sse.broadcast({ type: 'agent-updated', agent: updated });
    res.json({ agent: updated });
  });

  app.patch('/api/agents/:id/name', (req, res) => {
    const parsed = renameAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
      return;
    }
    const agent = getAgent(opts.db, req.params.id);
    if (!agent) { res.status(404).json({ error: 'agent not found' }); return; }
    renameAgent(opts.db, agent.id, parsed.data.name);
    const updated = getAgent(opts.db, agent.id);
    if (updated) opts.sse.broadcast({ type: 'agent-updated', agent: updated });
    res.json({ agent: updated });
  });

  app.post('/api/send', async (req, res) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
      return;
    }
    const agent = getAgent(opts.db, parsed.data.agent_id);
    if (!agent) { res.status(404).json({ error: 'agent not found' }); return; }
    if (agent.status === 'gone') { res.status(410).json({ error: 'agent is gone' }); return; }
    try {
      await sendKeysFn(agent.tmuxTarget, parsed.data.text, { enter: parsed.data.enter });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/send-key', async (req, res) => {
    const parsed = sendKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
      return;
    }
    const agent = getAgent(opts.db, parsed.data.agent_id);
    if (!agent) { res.status(404).json({ error: 'agent not found' }); return; }
    if (agent.status === 'gone') { res.status(410).json({ error: 'agent is gone' }); return; }
    try {
      await sendRawKey(agent.tmuxTarget, parsed.data.key);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/topics', (req, res) => {
    const parsed = createTopicSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
      return;
    }
    const group = getGroup(opts.db, parsed.data.group_id);
    if (!group) { res.status(404).json({ error: 'group not found' }); return; }
    const topic = createTopic(opts.db, { groupId: group.id, title: parsed.data.title });
    opts.sse.broadcast({ type: 'topic-created', topic });
    res.json({ topic });
  });

  app.post('/api/topics/:id/resolve', (req, res) => {
    const topic = resolveTopic(opts.db, req.params.id);
    if (!topic) { res.status(404).json({ error: 'topic not found' }); return; }
    opts.sse.broadcast({ type: 'topic-updated', topic });
    res.json({ topic });
  });

  // ── M3:调度 endpoints ─────────────────────────────

  app.post('/api/agents', async (req, res) => {
    const parsed = spawnSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
      return;
    }
    try {
      const result = await spawnWorker(opts.db, loadConfig(), {
        command: parsed.data.command,
        cwd: parsed.data.cwd,
        name: parsed.data.name,
        groupId: parsed.data.group_id ?? null,
        role: parsed.data.role ?? null,
        waitTimeoutMs: parsed.data.wait_timeout_ms,
      }, opts.sse.broadcast);
      res.json({ agent: result.agent });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.delete('/api/agents/:id', async (req, res) => {
    const force = req.query.force === '1' || req.query.force === 'true';
    try {
      const r = await killWorker(opts.db, { agentId: req.params.id, force });
      res.json(r);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // ── M3:worker profiles ────────────────────────────

  app.get('/api/worker-profiles', (_req, res) => {
    res.json({ profiles: listWorkerProfiles(opts.db) });
  });

  app.post('/api/worker-profiles', (req, res) => {
    const parsed = workerProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
      return;
    }
    try {
      const profile = createWorkerProfile(opts.db, {
        name: parsed.data.name,
        command: parsed.data.command,
        cwd: parsed.data.cwd,
        role: parsed.data.role ?? null,
        groupId: parsed.data.group_id ?? null,
        description: parsed.data.description ?? null,
      });
      res.json({ profile });
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  });

  app.delete('/api/worker-profiles/:id', (req, res) => {
    deleteWorkerProfile(opts.db, req.params.id);
    res.json({ ok: true });
  });

  // ── M3:配置查询 ─────────────────────────────────

  app.get('/api/config', (_req, res) => {
    res.json({ config: loadConfig() });
  });

  // ── M4:UI 用的 escalations 只读视图(不需要 master token)─────
  app.get('/api/escalations', async (_req, res) => {
    const { listEscalations } = await import('../master/escalations.js');
    res.json({ escalations: listEscalations(opts.db, { limit: 100 }) });
  });

  // M4:UI 用的 master token 显示 endpoint(本地 only,无 auth 也 OK)
  app.get('/api/master-token', (_req, res) => {
    res.json({ token: masterToken });
  });

  // ── M6:CC hooks endpoint(任何 CC 实例都可推送)─────
  app.post('/api/hook-event', (req, res) => {
    const parsed = hookEventSchema.safeParse(req.body);
    if (!parsed.success) {
      // hook 失败不该阻塞 CC —— 即使 payload 校验失败也返 200
      res.status(200).json({ ok: false, ignored: true });
      return;
    }
    try { handleHookEvent(opts.db, opts.sse.broadcast, parsed.data); }
    catch { /* swallow,不阻塞 CC */ }
    res.status(200).json({ ok: true });
  });

  // ── M4:Master API(/api/master/*,Bearer token 鉴权)─────

  const masterToken = opts.masterToken ?? ensureMasterToken();
  app.use('/api/master', buildMasterRouter({
    db: opts.db,
    token: masterToken,
    loadConfig,
    broadcast: opts.sse.broadcast,
  }));

  app.get('/api/events', (req, res) => {
    opts.sse.handler(req, res);
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(opts.port, '127.0.0.1', () => resolve());
  });

  return {
    stop: () => new Promise<void>((resolve) => {
      opts.sse.close();
      server.close(() => resolve());
    }),
    address: () => server.address(),
  };
}
