import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { WorkerProfile } from '@agent-bay/shared';

interface Row {
  id: string;
  name: string;
  role: string | null;
  command: string;
  cwd: string;
  group_id: string | null;
  description: string | null;
  created_at: number;
}

function rowToProfile(r: Row): WorkerProfile {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    command: r.command,
    cwd: r.cwd,
    groupId: r.group_id,
    description: r.description,
    createdAt: r.created_at,
  };
}

export function createWorkerProfile(
  db: Database.Database,
  opts: { name: string; command: string; cwd: string; role?: string | null; groupId?: string | null; description?: string | null },
): WorkerProfile {
  const p: WorkerProfile = {
    id: randomUUID(),
    name: opts.name,
    role: opts.role ?? null,
    command: opts.command,
    cwd: opts.cwd,
    groupId: opts.groupId ?? null,
    description: opts.description ?? null,
    createdAt: Date.now(),
  };
  db.prepare(`
    INSERT INTO worker_profiles (id, name, role, command, cwd, group_id, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(p.id, p.name, p.role, p.command, p.cwd, p.groupId, p.description, p.createdAt);
  return p;
}

export function listWorkerProfiles(db: Database.Database): WorkerProfile[] {
  return db.prepare<[], Row>(`SELECT * FROM worker_profiles ORDER BY created_at ASC`).all().map(rowToProfile);
}

export function getWorkerProfile(db: Database.Database, id: string): WorkerProfile | null {
  const r = db.prepare<[string], Row>(`SELECT * FROM worker_profiles WHERE id = ?`).get(id);
  return r ? rowToProfile(r) : null;
}

export function getWorkerProfileByName(db: Database.Database, name: string): WorkerProfile | null {
  const r = db.prepare<[string], Row>(`SELECT * FROM worker_profiles WHERE name = ?`).get(name);
  return r ? rowToProfile(r) : null;
}

export function deleteWorkerProfile(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM worker_profiles WHERE id = ?`).run(id);
}
