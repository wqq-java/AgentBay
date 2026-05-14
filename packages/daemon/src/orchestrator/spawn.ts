// 启停 worker 的业务逻辑。
//
// spawn 流程:
//   1. 校验 config 白名单(命令 + cwd + 并发上限)
//   2. ensureTmuxSession 保证宿主 session 存在
//   3. tmux new-window 起新 pane 跑命令
//   4. 等 scanner 下一轮 tick 收到这个 pane(轮询 db 至多 N ms)
//   5. markAgentSpawned 标记
//   6. 如果给了 group_id,加入该 group
//   7. 返回 agent
//
// kill 流程:
//   1. 取 agent
//   2. 必须 isSpawned=true(防误杀手起的 CC 会话)
//   3. tmux kill-pane
//   4. scanner 下一轮会标 gone

import type Database from 'better-sqlite3';
import type { Agent, ServerEvent } from '@agent-bay/shared';
import type { Config } from '../config/config.js';
import { checkSpawnAllowed } from '../config/config.js';
import { ensureTmuxSession, newWindowWithCommand, killPane } from '../scanner/tmux.js';
import { getAgent, markAgentSpawned, listOnlineAgents, updateAgentGroup } from '../store/agents.js';

export interface SpawnOpts {
  command: string;
  cwd: string;
  /** 可选 worker 名称 → 作为 tmux window name + agent name 默认 */
  name?: string;
  /** spawn 后自动加入的 group(必须已存在) */
  groupId?: string | null;
  /** spawn 后赋的 role(角色画像) */
  role?: string | null;
  /** 等多久 scanner 看到新 pane,默认 8000ms */
  waitTimeoutMs?: number;
  /** 实现注入(测试用) */
  ensureSession?: typeof ensureTmuxSession;
  newWindow?: typeof newWindowWithCommand;
}

export interface SpawnResult {
  agent: Agent;
}

export async function spawnWorker(
  db: Database.Database,
  config: Config,
  opts: SpawnOpts,
  emitEvent?: (e: ServerEvent) => void,
): Promise<SpawnResult> {
  const ensureSession = opts.ensureSession ?? ensureTmuxSession;
  const newWindow = opts.newWindow ?? newWindowWithCommand;

  // 当前 worker 数(用于并发检查)
  const currentWorkers = listOnlineAgents(db).filter(a => a.isSpawned).length;
  const reason = checkSpawnAllowed(config, opts.command, opts.cwd, currentWorkers);
  if (reason) throw new Error(`spawn rejected: ${reason}`);

  await ensureSession(config.defaultTmuxSession);

  const { paneId } = await newWindow({
    sessionName: config.defaultTmuxSession,
    windowName: opts.name ?? 'worker',
    cwd: opts.cwd,
    command: opts.command,
  });

  // 等 scanner 看到这个 pane;最多等 waitTimeoutMs
  const timeout = opts.waitTimeoutMs ?? 8000;
  const start = Date.now();
  let agent: Agent | null = null;
  while (Date.now() - start < timeout) {
    agent = getAgent(db, paneId);
    if (agent) break;
    await new Promise(r => setTimeout(r, 200));
  }
  if (!agent) {
    // 超时也别 throw —— scanner 慢了一拍也是合理的;但用户得知道发生了什么
    throw new Error(`spawned tmux pane ${paneId} but scanner did not pick it up within ${timeout}ms`);
  }

  // 标 isSpawned
  markAgentSpawned(db, agent.id);

  // 加入指定 group
  if (opts.groupId !== undefined && opts.groupId !== null) {
    updateAgentGroup(db, agent.id, opts.groupId);
  }

  // 重新读一遍取最新
  const fresh = getAgent(db, agent.id);
  if (!fresh) throw new Error('spawned agent disappeared');

  if (emitEvent) emitEvent({ type: 'agent-updated', agent: fresh });

  return { agent: fresh };
}

export interface KillOpts {
  agentId: string;
  /** 实现注入(测试用) */
  killImpl?: typeof killPane;
  /** 允许 kill 非 isSpawned 的 agent(默认 false) */
  force?: boolean;
}

export async function killWorker(
  db: Database.Database,
  opts: KillOpts,
): Promise<{ killedTarget: string }> {
  const agent = getAgent(db, opts.agentId);
  if (!agent) throw new Error(`agent ${opts.agentId} not found`);
  if (!opts.force && !agent.isSpawned) {
    throw new Error(`agent ${opts.agentId} was not spawned by AgentBay (use force=true to override)`);
  }
  if (agent.status === 'gone') throw new Error('agent is already gone');

  const killImpl = opts.killImpl ?? killPane;
  await killImpl(agent.tmuxTarget);
  // scanner 下一轮 tick 会发现 pane 没了 → 标 gone + 广播 agent-gone
  return { killedTarget: agent.tmuxTarget };
}

export interface WaitOpts {
  /** 等到指定 agent 出现(by pane id),或者 by name */
  agentId?: string;
  agentName?: string;
  timeoutMs?: number;
}

export async function waitForAgent(
  db: Database.Database,
  opts: WaitOpts,
): Promise<Agent> {
  const timeout = opts.timeoutMs ?? 10000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (opts.agentId) {
      const a = getAgent(db, opts.agentId);
      if (a && a.status !== 'gone') return a;
    } else if (opts.agentName) {
      const all = listOnlineAgents(db).filter(a => a.name === opts.agentName);
      if (all.length > 0) return all[0];
    } else {
      throw new Error('waitForAgent requires either agentId or agentName');
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`waitForAgent timed out after ${timeout}ms`);
}
