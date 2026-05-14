// 解析 tmux capture-pane 输出,推断 agent 状态。
//
// 5 档(对照设计 §1):
//   active             — 正在产出/工作
//   idle               — 待命,无活动
//   waiting-approval   — 等待用户做选择(菜单 / 二次确认)
//   waiting-input      — 等用户输入(M2 暂时合并到 idle,真正区分留 M3)
//   rate-limited       — 真正阻塞性限流(达到不能继续的程度)
//
// 也提取附加 meta:
//   - usagePct / contextPct(从 status bar 解析,用户额度信息)
//   - rateLimitResetsIn(剩余时间字符串,如 "3h 51m")
//
// 真实样本见 __samples__/pane-*.txt。

import type { AgentStatus } from '@agent-bay/shared';

export interface DetectedStatus {
  status: AgentStatus;
  meta: Record<string, unknown> | null;
}

// ─── Working markers ────────────────────────────────────
// CC 工作中的小动画:✻ ✶ ✽ ✳ · · · 后跟 gerund + …
// 例:`✻ Worked for 35s`、`· Twisting… (...)`、`✽ Wandering… (running stop hooks…)`
//
// 注意 `Worked for` 是已完成型(动作过去时),不算 active;但跟随的 gerund 才是当前进行
// 实际匹配宽松一点 —— 凡是这些 marker 后跟 ing-form 词都算 active

// 用 [^\S\n] 而不是 \s,避免吞换行
const WORKING_MARKER_LINE = /(?:^|\n)\s*[✻✶✽✳·*][^\S\n]+(?:[A-Z][a-z]+ing|Worked for|Running|Walking|Simmering|Lollygagging|Twisting|Crystallizing|Infusing|Wandering|Perusing|Clauding|Brewing|Composing|Cooking|Cogitating|Contemplating|Considering|Computing|Distilling|Examining|Forging|Generating|Hatching|Imagining|Inventing|Mulling|Noodling|Percolating|Pondering|Processing|Reasoning|Reflecting|Ruminating|Scheming|Spinning|Synthesizing|Thinking|Working|Mixing|Pulsating|Marinating|Manifesting|Sizzling|Stewing|Steeping|Smoldering|Fermenting|Resonating|Hatching|Hibernating)\b/i;

// 也包含 token/elapsed 信息时更确认 active
const WORKING_DETAIL = /\(\s*(?:running stop hooks|↓|↑)/;

// ─── Approval markers ───────────────────────────────────
// 用户必须选择才能继续:菜单 / Ctrl-C 二次确认 / 权限请求
const APPROVAL_MENU = /Enter to select\s*·\s*↑\/↓ to navigate/;
const APPROVAL_CTRL_C = /Press Ctrl-C again to (?:exit|quit)/;
const APPROVAL_PERMISSION = /Do you want to (?:proceed|continue|run|allow)/i;
const APPROVAL_DANGER = /(?:Run anyway\?|Allow this command\?|Approve this action\?)/i;

// ─── Rate limit ─────────────────────────────────────────
// 真正阻塞:看到 "rate limit" + "Try again at" / "wait until" 之类
// "重置剩余" 只是配额信息,不一定阻塞 —— 不直接判 rate-limited
const RATE_LIMIT_BLOCK = /(?:rate.?limit(?:ed)?|too many requests|exceeded.*?quota).{0,80}(?:try again|retry|wait until|reset)/i;
// Codex 限流提示
const CODEX_RATE_LIMIT = /(?:rate limit reached|reset(?:s)?\s+(?:at|in))\s+(\S+\s+\S+)/i;

// ─── Status bar 信息(CC 的 footer)─────────────────────
// 例:`上下文 █░░░░░░░░░ 7% │ 用量 ██░░░░░░░░ 18% (重置剩余 3h 51m) | 本周 ███████░░░ 70% (重置剩余 1d 13h)`
const CONTEXT_PCT = /上下文\s+[█░\s]+\s*(\d+)%/;
const USAGE_PCT = /用量\s+[█░\s]+\s*(\d+)%(?:\s*\(重置剩余\s+([^)]+)\))?/;
const WEEKLY_PCT = /本周\s+[█░\s]+\s*(\d+)%(?:\s*\(重置剩余\s+([^)]+)\))?/;

// ─── Shell 提示(说明 CC 已退出)─────────────────────
// starship prompt 出现 = CC 已经 exit,pane 现在跑 shell
// 这种本应被 scanner 标 gone(因为 pane_current_command 不再是 'claude');
// 但万一 scanner 还没刷,这里可以提早识别
const RESUME_HINT = /Resume this session with:\s*\nclaude --resume/;

// ─── 主入口 ─────────────────────────────────────────────

export function detectStatus(captured: string): DetectedStatus {
  const meta: Record<string, unknown> = {};

  // 提取 status bar 信息(无论什么状态都附上)
  const ctx = CONTEXT_PCT.exec(captured);
  if (ctx) meta.contextPct = Number(ctx[1]);

  const usage = USAGE_PCT.exec(captured);
  if (usage) {
    meta.usagePct = Number(usage[1]);
    if (usage[2]) meta.usageResetsIn = usage[2].trim();
  }

  const weekly = WEEKLY_PCT.exec(captured);
  if (weekly) {
    meta.weeklyPct = Number(weekly[1]);
    if (weekly[2]) meta.weeklyResetsIn = weekly[2].trim();
  }

  // 优先级(高 → 低)。各检查间互斥,先匹配先返回。

  // 1. 真正阻塞性 rate limit(完全无法继续)
  if (RATE_LIMIT_BLOCK.test(captured)) {
    return { status: 'rate-limited', meta: nonEmpty(meta) };
  }
  const codex = CODEX_RATE_LIMIT.exec(captured);
  if (codex) {
    meta.rateLimitHint = codex[1];
    return { status: 'rate-limited', meta: nonEmpty(meta) };
  }

  // 2. 等待用户输入选择(approval 在 resume hint 前——
  //    因为 "Press Ctrl-C again to exit" 时,CC 仍在 running 等用户回应,
  //    Resume hint 仅是它印的辅助文本)
  if (APPROVAL_MENU.test(captured)
      || APPROVAL_CTRL_C.test(captured)
      || APPROVAL_PERMISSION.test(captured)
      || APPROVAL_DANGER.test(captured)) {
    return { status: 'waiting-approval', meta: nonEmpty(meta) };
  }

  // 3. 工作中
  if (WORKING_MARKER_LINE.test(captured) || WORKING_DETAIL.test(captured)) {
    return { status: 'active', meta: nonEmpty(meta) };
  }

  // 4. CC 已彻底退出(只剩 resume hint,无 approval 也无 active)→ idle
  //    (scanner 通常会先把它标 gone,这里只是兜底)
  if (RESUME_HINT.test(captured)) {
    return { status: 'idle', meta: nonEmpty(meta) };
  }

  // 5. 默认 idle
  return { status: 'idle', meta: nonEmpty(meta) };
}

function nonEmpty(o: Record<string, unknown>): Record<string, unknown> | null {
  return Object.keys(o).length === 0 ? null : o;
}

// ─── 状态机:加 debounce + 迟滞 ────────────────────────
// 单次 detectStatus 是 stateless,但实际状态推送应该 debounce:
// - active → idle 至少要看 2 次连续 idle 检测才切(避免 CC 中间停顿误判)
// - idle → active 立即切(用户更想知道刚开始干活)
// - waiting-approval / rate-limited 立即切(高优先级)

export interface StatusHistory {
  current: AgentStatus;
  pendingChange: { to: AgentStatus; sinceTick: number; meta: Record<string, unknown> | null } | null;
  tick: number;
}

export function transition(
  history: StatusHistory,
  detected: DetectedStatus,
  hysteresis: { activeToIdleTicks?: number } = {},
): { next: StatusHistory; emit: { status: AgentStatus; meta: Record<string, unknown> | null } | null } {
  const newTick = history.tick + 1;
  const activeToIdleTicks = hysteresis.activeToIdleTicks ?? 2;

  // 高优先级状态立即切(approval / rate-limited / gone)
  const HIGH_PRIORITY: AgentStatus[] = ['waiting-approval', 'rate-limited', 'gone'];
  if (HIGH_PRIORITY.includes(detected.status) && detected.status !== history.current) {
    return {
      next: { current: detected.status, pendingChange: null, tick: newTick },
      emit: detected,
    };
  }

  // active → idle 走迟滞
  if (history.current === 'active' && detected.status === 'idle') {
    if (!history.pendingChange || history.pendingChange.to !== 'idle') {
      return {
        next: {
          current: history.current,
          pendingChange: { to: 'idle', sinceTick: newTick, meta: detected.meta },
          tick: newTick,
        },
        emit: null,
      };
    }
    if (newTick - history.pendingChange.sinceTick + 1 >= activeToIdleTicks) {
      return {
        next: { current: 'idle', pendingChange: null, tick: newTick },
        emit: detected,
      };
    }
    return {
      next: { ...history, tick: newTick },
      emit: null,
    };
  }

  // 重新见到 active(本来要切 idle 的中断)
  if (detected.status !== 'idle' && history.pendingChange?.to === 'idle') {
    return {
      next: { current: history.current, pendingChange: null, tick: newTick },
      emit: detected.status === history.current ? null : detected,
    };
  }

  // idle → 别的非 idle 状态 / 别的转换
  if (detected.status !== history.current) {
    return {
      next: { current: detected.status, pendingChange: null, tick: newTick },
      emit: detected,
    };
  }

  // 状态没变,但 meta 可能变了 —— 不 emit(避免 SSE 风暴)
  return {
    next: { ...history, tick: newTick },
    emit: null,
  };
}

export function newHistory(initial: AgentStatus = 'online'): StatusHistory {
  return { current: initial, pendingChange: null, tick: 0 };
}
