// 找 agent 对应的 jsonl 文件路径。
//
// 策略:
//   1. 如果 agent.statusMeta.cwd 已知 + agent.statusMeta.sessionId 已知 → 直接拼路径
//   2. 否则用 agent.statusMeta.cwd 扫 ~/.claude/projects/<encoded-cwd>/*.jsonl,
//      取最近 mtime 的(假定就是该 agent 的当前 session)
//   3. 都不行 → null

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Agent } from '@agent-bay/shared';

export function getClaudeProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

export function encodeCwdAsProjectDirName(cwd: string): string {
  return cwd.replace(/[/]/g, '-');
}

/** 推测 agent 的 cwd。来源:statusMeta.cwd → null */
export function getAgentCwd(agent: Agent): string | null {
  const cwd = agent.statusMeta?.cwd;
  return typeof cwd === 'string' ? cwd : null;
}

/** 推测 agent 的 sessionId */
export function getAgentSessionId(agent: Agent): string | null {
  const id = agent.statusMeta?.sessionId;
  return typeof id === 'string' ? id : null;
}

/**
 * 找 agent 当前 session 的 jsonl 路径。
 * 找不到返回 null。
 */
export async function findAgentJsonl(agent: Agent): Promise<string | null> {
  const cwd = getAgentCwd(agent);
  if (!cwd) return null;
  const projectDir = path.join(getClaudeProjectsDir(), encodeCwdAsProjectDirName(cwd));

  const sessionId = getAgentSessionId(agent);
  if (sessionId) {
    const exact = path.join(projectDir, `${sessionId}.jsonl`);
    try { await fs.access(exact); return exact; } catch { /* fall through */ }
  }

  // 兜底:扫该 cwd 目录下所有 jsonl,选 mtime 最新
  let entries: string[];
  try { entries = await fs.readdir(projectDir); } catch { return null; }
  const jsonls = entries.filter(e => e.endsWith('.jsonl'));
  if (jsonls.length === 0) return null;

  let bestPath = '';
  let bestMtime = -1;
  for (const f of jsonls) {
    const p = path.join(projectDir, f);
    try {
      const st = await fs.stat(p);
      if (st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs;
        bestPath = p;
      }
    } catch { /* ignore */ }
  }
  return bestPath || null;
}

/**
 * spawn 后用:在 cwd 项目目录里等到出现一个新 jsonl(mtime > sinceMs),返回它的 sessionId。
 * 用于把 spawn 出的 pane 跟它的 jsonl 关联。
 */
export async function waitForNewJsonl(
  cwd: string,
  sinceMs: number,
  timeoutMs = 8000,
): Promise<{ sessionId: string; jsonlPath: string } | null> {
  const projectDir = path.join(getClaudeProjectsDir(), encodeCwdAsProjectDirName(cwd));
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let entries: string[] = [];
    try { entries = await fs.readdir(projectDir); } catch { /* may not exist yet */ }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(projectDir, f);
      try {
        const st = await fs.stat(p);
        if (st.mtimeMs >= sinceMs) {
          return { sessionId: f.replace(/\.jsonl$/, ''), jsonlPath: p };
        }
      } catch { /* ignore */ }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}
