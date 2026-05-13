import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Workspace } from '@agent-bay/shared';

interface Row {
  id: string;
  cwd: string;
  label: string;
  created_at: number;
}

function rowToWorkspace(row: Row): Workspace {
  return {
    id: row.id,
    cwd: row.cwd,
    label: row.label,
    createdAt: row.created_at,
  };
}

export function createOrGetWorkspaceByCwd(db: Database.Database, cwd: string): Workspace {
  const existing = db.prepare<[string], Row>(`SELECT * FROM workspaces WHERE cwd = ?`).get(cwd);
  if (existing) return rowToWorkspace(existing);

  const ws: Workspace = {
    id: randomUUID(),
    cwd,
    label: path.basename(cwd) || cwd,
    createdAt: Date.now(),
  };
  db.prepare(`INSERT INTO workspaces (id, cwd, label, created_at) VALUES (?, ?, ?, ?)`)
    .run(ws.id, ws.cwd, ws.label, ws.createdAt);
  return ws;
}

export function listWorkspaces(db: Database.Database): Workspace[] {
  const rows = db.prepare<[], Row>(`SELECT * FROM workspaces ORDER BY created_at ASC`).all();
  return rows.map(rowToWorkspace);
}

export function getWorkspace(db: Database.Database, id: string): Workspace | null {
  const row = db.prepare<[string], Row>(`SELECT * FROM workspaces WHERE id = ?`).get(id);
  return row ? rowToWorkspace(row) : null;
}
