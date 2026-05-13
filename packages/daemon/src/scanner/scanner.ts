// 周期性扫 tmux pane,diff 到 db 的 agent 表,broadcast 变化。
//
// 在 M1 阶段只做 online / gone 两态,M2 状态机会基于 capture-pane 加细颗粒度。

import type Database from 'better-sqlite3';
import type { Agent, ServerEvent } from '@agent-bay/shared';
import { listPanes, inferTool, type TmuxPane } from './tmux.js';
import {
  upsertAgent, getAgent, listOnlineAgents, markAgentGone,
} from '../store/agents.js';

type BroadcastFn = (event: ServerEvent) => void;

export interface ScannerOpts {
  db: Database.Database;
  broadcast: BroadcastFn;
  intervalMs?: number;          // 默认 5000
  paneSource?: () => Promise<TmuxPane[]>; // 可注入,测试用
}

export interface ScannerHandle {
  /** 执行一次 scan + diff(返回变化的 agent ids;测试用) */
  tick: () => Promise<{ created: string[]; gone: string[] }>;
  /** 启动周期 tick,返回停止函数 */
  start: () => () => void;
}

/**
 * 命名规则:
 * - agent.id = tmux target (例 'main:0.1')
 * - 显示名优先用 pane title,降级用 sessionName + index
 */
function paneToAgent(p: TmuxPane, now: number, existing: Agent | null): Agent {
  const tool = inferTool(p);
  const name = existing?.name ?? (p.title && p.title !== p.command ? p.title : `${p.sessionName}:${p.paneIndex}`);
  return {
    id: p.paneId,                      // %N 作为稳定 id
    name,
    role: existing?.role ?? null,
    tmuxTarget: p.paneId,              // tmux send-keys 也接受 %N
    pid: p.pid,
    tool,
    status: 'online',
    statusMeta: existing?.statusMeta ?? null,
    groupId: existing?.groupId ?? null,
    lastSeenAt: now,
    createdAt: existing?.createdAt ?? now,
  };
}

export function createScanner(opts: ScannerOpts): ScannerHandle {
  const paneSource = opts.paneSource ?? listPanes;

  async function tick(): Promise<{ created: string[]; gone: string[] }> {
    const now = Date.now();
    const panes = await paneSource();
    const seen = new Set<string>();
    const created: string[] = [];

    for (const p of panes) {
      seen.add(p.paneId);
      const existing = getAgent(opts.db, p.paneId);
      const agent = paneToAgent(p, now, existing);
      upsertAgent(opts.db, agent);

      if (!existing) {
        created.push(agent.id);
        opts.broadcast({ type: 'agent-created', agent });
      } else if (existing.status === 'gone') {
        // 回归
        opts.broadcast({ type: 'agent-updated', agent });
      } else {
        // 只更新 last_seen,不广播(避免噪音)
      }
    }

    // 死了的 agent
    const gone: string[] = [];
    for (const a of listOnlineAgents(opts.db)) {
      if (!seen.has(a.id)) {
        markAgentGone(opts.db, a.id);
        gone.push(a.id);
        opts.broadcast({ type: 'agent-gone', agentId: a.id });
      }
    }

    return { created, gone };
  }

  function start(): () => void {
    const interval = opts.intervalMs ?? 5000;
    let stopped = false;
    const loop = async () => {
      if (stopped) return;
      try {
        await tick();
      } catch (e) {
        console.error('[scanner] tick failed:', e);
      }
      if (!stopped) setTimeout(loop, interval);
    };
    // first tick immediately
    setImmediate(loop);
    return () => { stopped = true; };
  }

  return { tick, start };
}
