// 列出项目根目录的子目录(供"+ 新建团队"作 cwd 选择)。
// 每个子目录顺手 detect 几个 marker(.git / package.json / Cargo.toml 等)告诉前端。

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface ProjectEntry {
  /** 完整绝对路径(用作 cwd) */
  path: string;
  /** 显示名(子目录名) */
  name: string;
  /** 检测到的项目标识 */
  markers: string[];
  /** 子目录数(粗略,用于判断是否还能 drill 进去) */
  childCount: number;
  /** mtime,前端可以排序 */
  mtimeMs: number;
}

const PROJECT_MARKERS = [
  '.git', 'package.json', 'pom.xml', 'build.gradle', 'Cargo.toml', 'go.mod',
  'pyproject.toml', 'requirements.txt', 'CLAUDE.md', 'AGENTS.md',
];

export function expandPath(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(p === '~' ? 1 : 2));
  }
  return p;
}

/**
 * 列出 root 目录下的所有子目录;
 * 对每个子目录跑 PROJECT_MARKERS 检测。
 * 隐藏目录(以 . 开头)默认排除。
 */
export async function listProjectsUnder(root: string, opts: { includeHidden?: boolean } = {}): Promise<ProjectEntry[]> {
  const expanded = expandPath(root);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(expanded, { withFileTypes: true });
  } catch (e) {
    throw new Error(`无法列出目录 ${expanded}: ${(e as Error).message}`);
  }

  const out: ProjectEntry[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!opts.includeHidden && e.name.startsWith('.')) continue;

    const fullPath = path.join(expanded, e.name);
    let mtimeMs = 0;
    try { mtimeMs = (await fs.stat(fullPath)).mtimeMs; } catch { /* ignore */ }

    const markers: string[] = [];
    let childCount = 0;
    try {
      const children = await fs.readdir(fullPath);
      childCount = children.length;
      for (const m of PROJECT_MARKERS) {
        if (children.includes(m)) markers.push(m);
      }
    } catch { /* perm denied 等,跳过 */ }

    out.push({
      path: fullPath,
      name: e.name,
      markers,
      childCount,
      mtimeMs,
    });
  }

  // 排序:有 marker 的优先,然后按 mtime DESC
  out.sort((a, b) => {
    const aHasMarker = a.markers.length > 0 ? 1 : 0;
    const bHasMarker = b.markers.length > 0 ? 1 : 0;
    if (aHasMarker !== bHasMarker) return bHasMarker - aHasMarker;
    return b.mtimeMs - a.mtimeMs;
  });

  return out;
}
