// Master HTTP API —— 8 个 endpoint。
// 全部走 /api/master/*,Bearer token 鉴权,跟 worker MCP 完全隔离。
//
// 这是 AgentDeck 文章里的关键架构选择:worker 只看到基础通信工具(MCP),
// 管理动作只暴露给 master,且 master 是个独立的 CC 进程,所以用 HTTP + token 最自然。

import express, { type Router } from 'express';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { Config } from '../config/config.js';
import type { ServerEvent } from '@agent-bay/shared';
import { masterAuth } from './auth.js';
import { insertEscalation, listEscalations, resolveEscalation } from './escalations.js';
import { pushNtfy } from './ntfy.js';
import { getAgent, updateAgentGroup } from '../store/agents.js';
import { getGroup } from '../store/groups.js';
import { capturePane, sendKeys, sendRawKey } from '../scanner/tmux.js';

export interface MasterApiOpts {
  db: Database.Database;
  token: string;
  loadConfig: () => Config;
  broadcast: (e: ServerEvent) => void;
}

const escalateSchema = z.object({
  severity: z.enum(['info', 'warn', 'blocker']),
  message: z.string().min(1).max(2000),
  from_agent_id: z.string().nullable().optional(),
  title: z.string().max(80).optional(),
});

const sendKeysSchema = z.object({
  agent_id: z.string(),
  text: z.string().optional(),
  key: z.string().optional(),
  enter: z.boolean().optional(),
}).refine(d => (d.text != null) !== (d.key != null), {
  message: 'must specify exactly one of text or key',
});

export function buildMasterRouter(opts: MasterApiOpts): Router {
  const r = express.Router();
  r.use(express.json({ limit: '512kb' }));
  r.use(masterAuth(opts.token));

  // 1. master health(确认 token + daemon 都 ok)
  r.get('/health', (_req, res) => {
    res.json({ ok: true, role: 'master' });
  });

  // 2. capture agent pane
  r.get('/agents/:id/capture', async (req, res) => {
    const lines = req.query.lines ? Number(req.query.lines) : 100;
    const agent = getAgent(opts.db, req.params.id);
    if (!agent) { res.status(404).json({ error: 'agent not found' }); return; }
    try {
      const text = await capturePane(agent.tmuxTarget, lines);
      res.json({ agent_id: agent.id, lines, text });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // 3. full agent state(agent meta + 最近 30 行 capture)
  r.get('/agents/:id/full', async (req, res) => {
    const agent = getAgent(opts.db, req.params.id);
    if (!agent) { res.status(404).json({ error: 'agent not found' }); return; }
    let recent = '';
    try { recent = await capturePane(agent.tmuxTarget, 30); } catch { /* gone */ }
    res.json({ agent, recent_capture: recent });
  });

  // 4. create escalation + push ntfy
  r.post('/escalations', async (req, res) => {
    const parsed = escalateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
      return;
    }
    const esc = insertEscalation(opts.db, {
      severity: parsed.data.severity,
      message: parsed.data.message,
      fromAgentId: parsed.data.from_agent_id ?? null,
    });
    // ntfy push(异步 fire-and-forget,失败不阻塞)
    pushNtfy({
      config: opts.loadConfig(),
      severity: parsed.data.severity,
      message: parsed.data.message,
      title: parsed.data.title ?? `AgentBay ${parsed.data.severity}`,
    }).catch(() => { /* swallow */ });
    res.json({ escalation: esc });
  });

  // 5. list escalations
  r.get('/escalations', (req, res) => {
    const onlyOpen = req.query.only_open === '1' || req.query.only_open === 'true';
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
    res.json({ escalations: listEscalations(opts.db, { onlyOpen, limit }) });
  });

  // 6. resolve escalation
  r.post('/escalations/:id/resolve', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return; }
    const esc = resolveEscalation(opts.db, id);
    if (!esc) { res.status(404).json({ error: 'escalation not found' }); return; }
    res.json({ escalation: esc });
  });

  // 7. group membership(加成员)
  r.post('/groups/:id/members', (req, res) => {
    const group = getGroup(opts.db, req.params.id);
    if (!group) { res.status(404).json({ error: 'group not found' }); return; }
    const agentId = req.body?.agent_id;
    if (typeof agentId !== 'string') { res.status(400).json({ error: 'agent_id required' }); return; }
    const agent = getAgent(opts.db, agentId);
    if (!agent) { res.status(404).json({ error: 'agent not found' }); return; }
    updateAgentGroup(opts.db, agent.id, group.id);
    const updated = getAgent(opts.db, agent.id);
    if (updated) opts.broadcast({ type: 'agent-updated', agent: updated });
    res.json({ agent: updated });
  });

  // 8. group membership(移成员)
  r.delete('/groups/:id/members/:agentId', (req, res) => {
    const agent = getAgent(opts.db, req.params.agentId);
    if (!agent) { res.status(404).json({ error: 'agent not found' }); return; }
    if (agent.groupId !== req.params.id) { res.status(409).json({ error: 'agent not in this group' }); return; }
    updateAgentGroup(opts.db, agent.id, null);
    const updated = getAgent(opts.db, agent.id);
    if (updated) opts.broadcast({ type: 'agent-updated', agent: updated });
    res.json({ agent: updated });
  });

  // 9. send-keys(master 直接送字符或按键,跳过 MCP)
  r.post('/send-keys', async (req, res) => {
    const parsed = sendKeysSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
      return;
    }
    const agent = getAgent(opts.db, parsed.data.agent_id);
    if (!agent) { res.status(404).json({ error: 'agent not found' }); return; }
    if (agent.status === 'gone') { res.status(410).json({ error: 'agent is gone' }); return; }
    try {
      if (parsed.data.text != null) {
        await sendKeys(agent.tmuxTarget, parsed.data.text, { enter: parsed.data.enter });
      } else if (parsed.data.key) {
        await sendRawKey(agent.tmuxTarget, parsed.data.key);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  return r;
}
