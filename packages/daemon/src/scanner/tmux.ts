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
export function inferTool(pane: { command: string; title: string }): AgentTool {
  const haystack = `${pane.command} ${pane.title}`.toLowerCase();
  if (haystack.includes('claude')) return 'claude-code';
  if (haystack.includes('codex')) return 'codex';
  return 'unknown';
}

/**
 * 给 pane 送一段文本。
 * - `enter`: 是否在末尾发送回车提交(默认 false——只塞到 pane buffer,不触发 submit)
 * - 文本会经过 tmux send-keys 的 literal 模式("-l"),不被解析成快捷键
 */
export async function sendKeys(target: string, text: string, opts: { enter?: boolean } = {}): Promise<void> {
  // tmux send-keys -t target -l "text"  会把字面文本作为输入
  // 然后再发一个 'Enter' 触发(如果需要)
  // 注意 shell escape:用单引号 + 处理内部单引号
  const escaped = text.replace(/'/g, `'"'"'`);
  await pexec(`tmux send-keys -t '${target}' -l '${escaped}'`);
  if (opts.enter) {
    await pexec(`tmux send-keys -t '${target}' Enter`);
  }
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
