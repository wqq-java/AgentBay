// 周期性扫 tmux pane,diff 到 db 的 agent 表,broadcast 变化。
//
// 在 M1 阶段只做 online / gone 两态,M2 状态机会基于 capture-pane 加细颗粒度。

import type Database from 'better-sqlite3';
import type { Agent, ServerEvent } from '@agent-bay/shared';
import { listPanes, capturePane, inferTool, type TmuxPane } from './tmux.js';
import {
  upsertAgent, getAgent, listOnlineAgents, markAgentGone, updateAgentStatus,
} from '../store/agents.js';
import { detectStatus, transition, newHistory, type StatusHistory } from './status.js';

type BroadcastFn = (event: ServerEvent) => void;

export interface ScannerOpts {
  db: Database.Database;
  broadcast: BroadcastFn;
  intervalMs?: number;                              // 默认 5000
  paneSource?: () => Promise<TmuxPane[]>;           // 可注入,测试用
  captureSource?: (target: string) => Promise<string>; // 可注入,测试用
  /** 关闭状态识别(只做 online/gone,M1 兼容模式;默认 false) */
  noStatusDetection?: boolean;
}

export interface ScannerHandle {
  /** 执行一次 scan + diff(返回变化的 agent ids;测试用) */
  tick: () => Promise<{ created: string[]; gone: string[]; statusChanged: string[] }>;
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
  // 关键:status / statusMeta 不被 scanner 覆盖,保留 status 状态机最近写的值
  // 新 pane 首次入库时给 'online',然后状态机会立刻 detect 出真实 status
  // gone 回归的 pane 也给 'online' 重置
  const status = (!existing || existing.status === 'gone') ? 'online' : existing.status;
  return {
    id: p.paneId,                      // %N 作为稳定 id
    name,
    role: existing?.role ?? null,
    tmuxTarget: p.paneId,              // tmux send-keys 也接受 %N
    pid: p.pid,
    tool,
    status,
    statusMeta: existing?.statusMeta ?? null,
    groupId: existing?.groupId ?? null,
    lastSeenAt: now,
    createdAt: existing?.createdAt ?? now,
  };
}

export function createScanner(opts: ScannerOpts): ScannerHandle {
  const paneSource = opts.paneSource ?? listPanes;
  const captureSource = opts.captureSource ?? capturePane;

  // 每个 agent 独立的状态历史(用于 transition 的 debounce/迟滞)
  const histories = new Map<string, StatusHistory>();

  async function tick(): Promise<{ created: string[]; gone: string[]; statusChanged: string[] }> {
    const now = Date.now();
    const panes = await paneSource();
    const seen = new Set<string>();
    const created: string[] = [];
    const statusChanged: string[] = [];

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
      }

      // 状态识别(只对识别到 tool 的 pane 做 ——
      // shell pane 没意义,跑也是浪费)
      if (!opts.noStatusDetection && agent.tool !== 'unknown') {
        try {
          const captured = await captureSource(p.paneId);
          const detected = detectStatus(captured);
          const hist = histories.get(p.paneId) ?? newHistory(agent.status);
          const { next, emit } = transition(hist, detected);
          histories.set(p.paneId, next);
          if (emit) {
            updateAgentStatus(opts.db, p.paneId, emit.status, emit.meta);
            const updated = getAgent(opts.db, p.paneId);
            if (updated) {
              opts.broadcast({ type: 'agent-updated', agent: updated });
              statusChanged.push(p.paneId);
            }
          }
        } catch {
          // capture 失败(pane 已死等)→ 忽略,下一轮 scan 会标 gone
        }
      }
    }

    // 死了的 agent
    const gone: string[] = [];
    for (const a of listOnlineAgents(opts.db)) {
      if (!seen.has(a.id)) {
        markAgentGone(opts.db, a.id);
        histories.delete(a.id);
        gone.push(a.id);
        opts.broadcast({ type: 'agent-gone', agentId: a.id });
      }
    }

    return { created, gone, statusChanged };
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
