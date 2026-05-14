import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Group } from '@agent-bay/shared';

interface Row {
  id: string;
  name: string;
  description: string | null;
  is_dm: number;
  created_at: number;
}

function rowToGroup(r: Row): Group {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isDm: r.is_dm === 1,
    createdAt: r.created_at,
  };
}

export function createGroup(
  db: Database.Database,
  opts: { name: string; description?: string | null; isDm?: boolean } = { name: '' },
): Group {
  const g: Group = {
    id: randomUUID(),
    name: opts.name,
    description: opts.description ?? null,
    isDm: opts.isDm ?? false,
    createdAt: Date.now(),
  };
  db.prepare(`INSERT INTO groups (id, name, description, is_dm, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(g.id, g.name, g.description, g.isDm ? 1 : 0, g.createdAt);
  return g;
}

export function listGroups(db: Database.Database): Group[] {
  return db.prepare<[], Row>(`SELECT * FROM groups ORDER BY created_at ASC`).all().map(rowToGroup);
}

export function getGroup(db: Database.Database, id: string): Group | null {
  const r = db.prepare<[string], Row>(`SELECT * FROM groups WHERE id = ?`).get(id);
  return r ? rowToGroup(r) : null;
}

export function getGroupByName(db: Database.Database, name: string): Group | null {
  const r = db.prepare<[string], Row>(`SELECT * FROM groups WHERE name = ?`).get(name);
  return r ? rowToGroup(r) : null;
}

export function deleteGroup(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM groups WHERE id = ?`).run(id);
}

/**
 * 取或建一个两 agent 之间的 DM(隐藏 group)。
 * 命名规则:`dm:<sortedId1>:<sortedId2>`,保证幂等。
 */
export function getOrCreateDmGroup(
  db: Database.Database,
  agentIdA: string,
  agentIdB: string,
): Group {
  const [a, b] = [agentIdA, agentIdB].sort();
  const dmName = `dm:${a}:${b}`;
  const existing = getGroupByName(db, dmName);
  if (existing) return existing;
  return createGroup(db, { name: dmName, isDm: true, description: null });
}

export function listDmGroups(db: Database.Database): Group[] {
  return db.prepare<[], Row>(`SELECT * FROM groups WHERE is_dm = 1 ORDER BY created_at ASC`).all().map(rowToGroup);
}

export function listNonDmGroups(db: Database.Database): Group[] {
  return db.prepare<[], Row>(`SELECT * FROM groups WHERE is_dm = 0 ORDER BY created_at ASC`).all().map(rowToGroup);
}
