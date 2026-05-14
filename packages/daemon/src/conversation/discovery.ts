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
 *
 * 关键:fallback 用 **birthtime**(文件创建时间)而不是 mtime —— mtime 会被
 * "正在写"的老 jsonl 推后,导致 discovery 误把老 session 的 jsonl 当成新 agent
 * 的。birthtime 只取 spawn 之后新建的 jsonl。
 */
export async function findAgentJsonl(agent: Agent): Promise<string | null> {
  const cwd = getAgentCwd(agent);
  if (!cwd) return null;
  const projectDir = path.join(getClaudeProjectsDir(), encodeCwdAsProjectDirName(cwd));

  // 1. 精确匹配 sessionId
  const sessionId = getAgentSessionId(agent);
  if (sessionId) {
    const exact = path.join(projectDir, `${sessionId}.jsonl`);
    try { await fs.access(exact); return exact; } catch { /* fall through */ }
  }

  // 2. 兜底:只考虑 birthtime >= agent.createdAt - 5s 的 jsonl(spawn 之后新建的);
  //    其中选最大 mtime(刚被写过 = 当前活跃)
  let entries: string[];
  try { entries = await fs.readdir(projectDir); } catch { return null; }
  const jsonls = entries.filter(e => e.endsWith('.jsonl'));
  if (jsonls.length === 0) return null;

  const cutoffMs = agent.createdAt - 5000;
  let bestPath = '';
  let bestMtime = -1;
  for (const f of jsonls) {
    const p = path.join(projectDir, f);
    try {
      const st = await fs.stat(p);
      const birthMs = st.birthtimeMs || st.ctimeMs;
      if (birthMs < cutoffMs) continue;  // 老 session,跳过
      if (st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs;
        bestPath = p;
      }
    } catch { /* ignore */ }
  }
  return bestPath || null;
}

/**
 * spawn 后用:在 cwd 项目目录里等到出现一个新 jsonl(birthtime > sinceMs),
 * 返回它的 sessionId。用于把 spawn 出的 pane 跟它的 jsonl 关联。
 *
 * birthtime 优于 mtime —— mtime 会被现有 jsonl 的写入推后,误判。
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
        const birthMs = st.birthtimeMs || st.ctimeMs;
        if (birthMs >= sinceMs) {
          return { sessionId: f.replace(/\.jsonl$/, ''), jsonlPath: p };
        }
      } catch { /* ignore */ }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}
