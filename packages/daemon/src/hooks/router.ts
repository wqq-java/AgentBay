// 接收 CC 全局 hook 推送(M6)。
//
// 范围:作为已有 tmux scanner / status state machine 的**增强信号**,提供:
// 1. 精确的 token 累计(从 usage payload)
// 2. 精确的 tool 调用时间戳(PreToolUse / PostToolUse,比 capture-pane 解析准)
// 3. SubagentStart/Stop —— teammate 派发的精确锚点
// 4. (M6 backlog)Ghostty 跑的 CC 上报 SessionStart → AgentBay 显示成 external/read-only
//
// M6 当前实现:只接收 + 累加 token + 记录 tool 时间线到 statusMeta。
// agent 关联通过 cwd 反查(因为 hook payload 里没 tmux pane id)。

import type Database from 'better-sqlite3';
import type { HookEvent } from './schemas.js';
import type { ServerEvent } from '@agent-bay/shared';
import { listOnlineAgents, getAgent, updateAgentStatus } from '../store/agents.js';

type BroadcastFn = (event: ServerEvent) => void;

/**
 * 把 hook event 转给合适的处理函数。无法关联到 agent 时静默忽略
 * (AgentBay 接收 hook 不阻塞 CC,即使我们处理失败也不该抛错)。
 */
export function handleHookEvent(
  db: Database.Database,
  broadcast: BroadcastFn,
  ev: HookEvent,
): void {
  // 关联到具体 agent:
  //   1. 如果 hook 进程能拿到 TMUX_PANE env(由 hook 脚本附在 payload 里),用那个 → 最准
  //   2. 否则用 cwd 匹配 agent.statusMeta.cwd(scanner 没存这个,M6 backlog)
  //   3. 实在不行就广播一个 'unattached' 事件,前端可以显示"有 CC 活动但没绑定 agent"
  //
  // M6 当前实现:仅 token 累加(选 cwd 匹配,best-effort)
  switch (ev.hook_event_name) {
    case 'PostToolUse':
    case 'Stop':
      maybeUpdateTokens(db, broadcast, ev);
      break;
    default:
      // 其他 event 现在不处理(SessionStart/SubagentStart 等,M6 后续完善)
      break;
  }
}

function maybeUpdateTokens(
  db: Database.Database,
  broadcast: BroadcastFn,
  ev: HookEvent,
): void {
  if (!ev.usage) return;
  const total = (ev.usage.input_tokens ?? 0)
    + (ev.usage.output_tokens ?? 0)
    + (ev.usage.cache_read_input_tokens ?? 0)
    + (ev.usage.cache_creation_input_tokens ?? 0);
  if (total === 0) return;

  // 找匹配的 agent:用 cwd + sessionId 都不靠谱(scanner 没存),
  // 只能挨个 active agent 看 statusMeta.sessionId(我们之前没填这个字段)。
  // M6 临时:不匹配,只把这个 token 累加到所有 active CC pane 里 last 出现的
  // (这是 placeholder;真匹配在 M6.5,需要 hook 脚本附 TMUX_PANE)。
  const candidates = listOnlineAgents(db).filter(a => a.tool === 'claude-code');
  if (candidates.length === 0) return;

  // 找一个最近活动的 active CC(最简启发)
  const target = candidates.sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0];
  const prevTotal = (target.statusMeta?.hookTokens as number | undefined) ?? 0;
  updateAgentStatus(db, target.id, target.status, {
    ...(target.statusMeta ?? {}),
    hookTokens: prevTotal + total,
    lastHookEvent: ev.hook_event_name,
    lastHookTs: Date.now(),
  });
  const updated = getAgent(db, target.id);
  if (updated) broadcast({ type: 'agent-updated', agent: updated });
}
