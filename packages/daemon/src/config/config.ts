// AgentBay 配置(~/.agent-bay/config.json)。
//
// 关键:spawn 白名单。worker MCP 调用 spawn_agent 时,daemon 必须校验请求的命令
// 和 cwd 都在 allowlist 里——否则 agent 可以自动起任意进程,这是不安全的。

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getDataDir } from './paths.js';

export const configSchema = z.object({
  spawn: z.object({
    /**
     * 允许 spawn 的命令(完整或前缀匹配)。
     * 例:["claude", "codex"] 表示只允许这两个命令。
     * 空数组 = 不允许 spawn 任何命令。
     */
    commands: z.array(z.string()).default(['claude', 'codex']),
    /**
     * 允许 spawn 的 cwd(必须以这些路径之一为前缀)。
     * 空数组 = 不限制 cwd。
     */
    cwds: z.array(z.string()).default([]),
    /** 同时允许 spawn 的 worker 上限,防失控 */
    maxConcurrent: z.number().int().positive().default(20),
  }).default({}),
  /** 默认 tmux session 名(spawn 时如果没指定,新 window 开在哪) */
  defaultTmuxSession: z.string().default('agent-bay'),
  /** ntfy 移动推送(M4 加) */
  ntfy: z.object({
    enabled: z.boolean().default(false),
    topicUrl: z.string().optional(),
  }).default({}),
  /** 项目根目录列表 —— 给"+ 新建团队"挑 cwd 时遍历这些根的子目录(P+ 加) */
  projectRoots: z.array(z.string()).default([]),
}).default({});

export type Config = z.infer<typeof configSchema>;

export function getConfigPath(): string {
  return path.join(getDataDir(), 'config.json');
}

export function loadConfig(configPath?: string): Config {
  const file = configPath ?? getConfigPath();
  if (!fs.existsSync(file)) {
    return configSchema.parse({});
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return configSchema.parse(raw);
  } catch (e) {
    console.warn(`[config] failed to load ${file}, using defaults:`, e);
    return configSchema.parse({});
  }
}

export function saveConfig(config: Config, configPath?: string): void {
  const file = configPath ?? getConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
}

/**
 * 检查 spawn 请求是否在白名单内。返回 reason 字符串(失败原因)或 null(通过)。
 */
export function checkSpawnAllowed(
  config: Config,
  command: string,
  cwd: string,
  currentWorkerCount: number,
): string | null {
  // 命令前缀匹配(防止精确匹配过严)
  const cmdAllowed = config.spawn.commands.some(allowed =>
    command === allowed || command.startsWith(`${allowed} `),
  );
  if (!cmdAllowed) {
    return `command "${command}" not in spawn allowlist (allowed: ${config.spawn.commands.join(', ')})`;
  }
  if (config.spawn.cwds.length > 0) {
    const cwdAllowed = config.spawn.cwds.some(prefix => cwd.startsWith(prefix));
    if (!cwdAllowed) {
      return `cwd "${cwd}" not in spawn allowlist (must start with one of: ${config.spawn.cwds.join(', ')})`;
    }
  }
  if (currentWorkerCount >= config.spawn.maxConcurrent) {
    return `concurrent worker limit ${config.spawn.maxConcurrent} reached`;
  }
  return null;
}
