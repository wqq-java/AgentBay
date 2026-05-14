// tmux 接口封装:list-panes 解析 + send-keys 调用。
// 所有 child_process exec 都通过这里走,便于单元测试 mock。

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentTool } from '@agent-bay/shared';

const pexec = promisify(exec);

export interface TmuxPane {
  paneId: string;        // tmux 唯一 pane id,如 '%5' —— 用作 agent.id(稳定)
  target: string;        // session:window.pane —— 给用户看(可能在 pane 删除后漂移)
  pid: number;
  command: string;       // pane_current_command(短名,如 'claude' / 'codex' / 'zsh')
  title: string;         // pane_title
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
}

/**
 * tmux 是不是装了 + 用户当前是不是有 tmux server 在跑。
 * - tmux 没装 → 返回 'not-installed'
 * - 装了但没 server → 返回 'no-server'
 * - 都有 → 'ok'
 */
export type TmuxAvailability = 'ok' | 'no-server' | 'not-installed';

export async function probeTmux(): Promise<TmuxAvailability> {
  try {
    const { stdout } = await pexec('tmux -V');
    if (!stdout.trim().startsWith('tmux ')) return 'not-installed';
  } catch {
    return 'not-installed';
  }
  try {
    await pexec('tmux list-sessions 2>/dev/null');
    return 'ok';
  } catch {
    return 'no-server';
  }
}

/**
 * 列出当前 tmux server 里所有 pane。
 * 没有 tmux server 时返回 [](不抛错)。
 */
export async function listPanes(): Promise<TmuxPane[]> {
  // pane_id 是 `%N` 格式,在 tmux server 生命周期内单调递增不复用,是最稳的 key
  const fmt = '#{pane_id}\t#{session_name}\t#{window_index}\t#{pane_index}\t#{pane_pid}\t#{pane_current_command}\t#{pane_title}';
  let stdout = '';
  try {
    const r = await pexec(`tmux list-panes -a -F '${fmt}'`);
    stdout = r.stdout;
  } catch {
    return [];
  }
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    const [paneId, sess, win, pane, pid, command, ...titleParts] = line.split('\t');
    const title = titleParts.join('\t');
    return {
      paneId: paneId ?? '',
      target: `${sess}:${win}.${pane}`,
      pid: Number(pid),
      command: command ?? '',
      title: title ?? '',
      sessionName: sess ?? '',
      windowIndex: Number(win),
      paneIndex: Number(pane),
    };
  });
}

/**
 * 推断 pane 里跑的是什么 agent 工具(根据当前命令 + title)。
 * 注意:`claude` 进程的 pane_current_command 通常是 'node'(因为是 node CLI),
 * 所以也得看 title 和 cmdline。M1 用粗略启发,后续可扩展。
 */
// CC 工作中给 pane title 设置的小图标(同时也是 status 检测用的)
const CC_TITLE_MARKERS = /^[\s]*[✻✶✽✳·*][\s]/;

// CC 实际跑的进程是 node,pane_current_command 看到的常常是版本号(如 "2.1.140")
// 或 'node'。靠 title 更准。Codex 类似。
export function inferTool(pane: { command: string; title: string }): AgentTool {
  const titleHay = pane.title.toLowerCase();
  const commandHay = pane.command.toLowerCase();

  // 强信号:title 里有 "claude"/"codex" 字样
  if (titleHay.includes('claude')) return 'claude-code';
  if (titleHay.includes('codex')) return 'codex';
  if (commandHay.includes('claude')) return 'claude-code';
  if (commandHay.includes('codex')) return 'codex';

  // 弱信号:title 以 CC 工作标记开头(✳ ✻ ✶ 等)
  if (CC_TITLE_MARKERS.test(pane.title)) return 'claude-code';

  // command 是 X.Y.Z 形式 + title 非空 → 很可能是 CC(它把 process title 设成版本号)
  if (/^\d+\.\d+\.\d+$/.test(pane.command) && pane.title.trim().length > 0) {
    return 'claude-code';
  }

  return 'unknown';
}

/**
 * 给 pane 送一段文本。
 * - `enter`: 是否在末尾发送回车提交(默认 false——只塞到 pane buffer,不触发 submit)
 * - 文本会经过 tmux send-keys 的 literal 模式("-l"),不被解析成快捷键
 */
export async function sendKeys(target: string, text: string, opts: { enter?: boolean } = {}): Promise<void> {
  const escaped = text.replace(/'/g, `'"'"'`);
  if (text.length > 0) {
    await pexec(`tmux send-keys -t '${target}' -l '${escaped}'`);
  }
  if (opts.enter) {
    await pexec(`tmux send-keys -t '${target}' Enter`);
  }
}

/**
 * 送一个具名按键(Enter / Escape / C-c / C-d / Tab / Up / Down / 等)。
 * 不带 -l,所以 tmux 把它当 key name 解析。
 *
 * 安全 list:只允许已知的按键名;防止用户从 UI 输入任意字符串导致命令注入。
 */
const ALLOWED_KEYS = new Set([
  'Enter', 'Escape', 'Tab', 'BSpace', 'BTab', 'Space',
  'Up', 'Down', 'Left', 'Right', 'PgUp', 'PgDn', 'Home', 'End',
  'C-a', 'C-b', 'C-c', 'C-d', 'C-e', 'C-f', 'C-g', 'C-h', 'C-i', 'C-j',
  'C-k', 'C-l', 'C-m', 'C-n', 'C-o', 'C-p', 'C-q', 'C-r', 'C-s', 'C-t',
  'C-u', 'C-v', 'C-w', 'C-x', 'C-y', 'C-z',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

export async function sendRawKey(target: string, key: string): Promise<void> {
  if (!ALLOWED_KEYS.has(key)) {
    throw new Error(`key "${key}" not allowed (must be one of: ${[...ALLOWED_KEYS].slice(0, 10).join(', ')}, ...)`);
  }
  // key 已经在白名单里,不会含 shell 特殊字符;但 target 来自 db 里的 paneId
  // (例如 %5),正常不会含特殊字符。仍然加引号以防万一
  await pexec(`tmux send-keys -t '${target}' ${key}`);
}

/**
 * 捕获 pane 最近 N 行输出(用于 M2 状态识别;M1 暂不用,但导出方便测试)
 */
export async function capturePane(target: string, lines = 50): Promise<string> {
  try {
    const { stdout } = await pexec(`tmux capture-pane -p -t '${target}' -S -${lines}`);
    return stdout;
  } catch {
    return '';
  }
}

// ─── M3:spawn / kill 用的 tmux wrappers ──────────────

/**
 * 新建 tmux session(如果不存在),供 spawn 时用作宿主。
 * 已存在则 no-op。
 */
export async function ensureTmuxSession(sessionName: string): Promise<void> {
  try {
    await pexec(`tmux has-session -t '${sessionName}'`);
  } catch {
    // session 不存在,新建一个 detached
    await pexec(`tmux new-session -d -s '${sessionName}'`);
  }
}

/**
 * 在指定 session 里开一个新 window 跑指定命令,返回新 pane 的 %N id。
 * - cwd 决定窗口的初始工作目录
 * - command 是 shell 字符串(可以带参数)
 * - 返回的 pane id 形如 '%7'
 *
 * 关键:命令通过 `<SHELL> -ic '<cmd>'` 包装,这样:
 *   - 新 pane 加载用户 .zshrc / .bashrc / .bash_profile,继承 ANTHROPIC_BASE_URL /
 *     HTTPS_PROXY 等用户环境(否则 tmux server 是 daemon 起的,env 是 daemon 当时的
 *     env,跟用户当前 shell env 可能不一致)
 *   - claude 拿到正确 auth env(否则会 403 "Please run /login")
 */
export async function newWindowWithCommand(opts: {
  sessionName: string;
  windowName?: string;
  cwd: string;
  command: string;
}): Promise<{ paneId: string; windowIndex: number }> {
  const escWindow = (opts.windowName ?? 'worker').replace(/'/g, `'"'"'`);
  const escCwd = opts.cwd.replace(/'/g, `'"'"'`);
  // 包一层 interactive shell;命令里的单引号转义两次
  const shell = process.env.SHELL ?? '/bin/zsh';
  // 命令内部的单引号需要 shell 转义("'" → '\''),然后整个再被 tmux 的单引号包起来
  const innerEsc = opts.command.replace(/'/g, `'\\''`);
  const wrapped = `${shell} -ic '${innerEsc}'`;
  const escWrapped = wrapped.replace(/'/g, `'"'"'`);

  const { stdout } = await pexec(
    `tmux new-window -t '${opts.sessionName}:' -n '${escWindow}' -c '${escCwd}' -P -F '#{pane_id}|#{window_index}' '${escWrapped}'`,
  );
  const trimmed = stdout.trim();
  const [paneId, winIdx] = trimmed.split('|');
  if (!paneId || !paneId.startsWith('%')) {
    throw new Error(`tmux new-window unexpected output: ${trimmed}`);
  }
  return { paneId, windowIndex: Number(winIdx) };
}

/**
 * 杀掉指定 pane(默认情况会同时关闭它所在 window 如果 window 只有一个 pane)。
 */
export async function killPane(target: string): Promise<void> {
  await pexec(`tmux kill-pane -t '${target}'`);
}
