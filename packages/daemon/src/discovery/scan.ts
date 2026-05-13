import fs from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createOrGetWorkspaceByCwd } from '../store/workspaces.js';
import { upsertSession, getSession } from '../store/sessions.js';
import { decodeProjectDirNameAsCwd } from '../config/paths.js';
import type { Session } from '@claude-teams/shared';

/**
 * 扫 projectsDir 下所有 <encoded-cwd>/<sessionId>.jsonl,反向构建出 Observed sessions。
 * - cwd 优先从 jsonl 第一行的 cwd 字段取(精确);取不到则用目录名反向编码(best-effort)
 * - 已存在的 session 不覆盖(idempotent)
 */
export async function discoverObservedSessions(db: Database.Database, projectsDir: string): Promise<void> {
  let projectDirs: string[];
  try {
    projectDirs = await fs.readdir(projectsDir);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }

  for (const encodedCwd of projectDirs) {
    const projectPath = path.join(projectsDir, encodedCwd);
    let stat;
    try { stat = await fs.stat(projectPath); } catch { continue; }
    if (!stat.isDirectory()) continue;

    let jsonlFiles: string[];
    try { jsonlFiles = await fs.readdir(projectPath); } catch { continue; }

    for (const file of jsonlFiles) {
      if (!file.endsWith('.jsonl')) continue;
      const sessionId = file.replace(/\.jsonl$/, '');
      if (getSession(db, sessionId)) continue; // 已存在,跳过

      const jsonlPath = path.join(projectPath, file);
      const fileStat = await fs.stat(jsonlPath);

      // 优先从 jsonl 取 cwd
      const realCwd = await extractCwdFromJsonl(jsonlPath) ?? decodeProjectDirNameAsCwd(encodedCwd);
      const ws = createOrGetWorkspaceByCwd(db, realCwd);

      const session: Session = {
        id: sessionId,
        workspaceId: ws.id,
        mode: 'observed',
        pid: null,
        state: 'idle',
        jsonlPath,
        jsonlOffset: 0,
        startedAt: fileStat.birthtimeMs || fileStat.mtimeMs,
        endedAt: null,
      };
      upsertSession(db, session);
    }
  }
}

async function extractCwdFromJsonl(jsonlPath: string): Promise<string | null> {
  try {
    const fh = await fs.open(jsonlPath, 'r');
    try {
      const buf = Buffer.alloc(8192);
      const { bytesRead } = await fh.read(buf, 0, 8192, 0);
      const text = buf.subarray(0, bytesRead).toString('utf-8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (typeof obj.cwd === 'string') return obj.cwd;
        } catch { /* 行残缺,继续下一行 */ }
      }
    } finally {
      await fh.close();
    }
  } catch { /* 文件读不开,忽略 */ }
  return null;
}
