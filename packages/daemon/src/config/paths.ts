import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();

export function getDataDir(): string {
  return path.join(HOME, '.claude-teams');
}

export function getDbPath(): string {
  return path.join(getDataDir(), 'state.db');
}

export function getLogsDir(): string {
  return path.join(getDataDir(), 'logs');
}

export function getClaudeProjectsDir(): string {
  return path.join(HOME, '.claude', 'projects');
}

/**
 * 把 cwd 转成 Claude Code 项目目录的编码名。
 * 例:/Users/eoi/EOI → -Users-eoi-EOI
 */
export function encodeCwdAsProjectDirName(cwd: string): string {
  return cwd.replace(/[/]/g, '-');
}

/**
 * 反向:把项目目录名解码回 cwd。
 * 注:CC 实测会把首字符 `/` 也变成 `-`,且不处理路径里原本就有 `-` 的情况——
 * 我们只做 best-effort 还原,真正的 cwd 应该从 jsonl 里读 cwd 字段。
 */
export function decodeProjectDirNameAsCwd(name: string): string {
  return '/' + name.replace(/^-/, '').replace(/-/g, '/');
}
