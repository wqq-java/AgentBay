import type Database from 'better-sqlite3';
import type { Session, SessionMode, SessionState } from '@claude-teams/shared';

interface Row {
  id: string;
  workspace_id: string;
  mode: SessionMode;
  pid: number | null;
  state: SessionState;
  jsonl_path: string;
  jsonl_offset: number;
  started_at: number;
  ended_at: number | null;
}

function rowToSession(r: Row): Session {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    mode: r.mode,
    pid: r.pid,
    state: r.state,
    jsonlPath: r.jsonl_path,
    jsonlOffset: r.jsonl_offset,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

export function upsertSession(db: Database.Database, s: Session): void {
  db.prepare(`
    INSERT INTO sessions (id, workspace_id, mode, pid, state, jsonl_path, jsonl_offset, started_at, ended_at)
    VALUES (@id, @workspace_id, @mode, @pid, @state, @jsonl_path, @jsonl_offset, @started_at, @ended_at)
    ON CONFLICT(id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      mode = excluded.mode,
      pid = excluded.pid,
      state = excluded.state,
      jsonl_path = excluded.jsonl_path,
      jsonl_offset = excluded.jsonl_offset,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at
  `).run({
    id: s.id,
    workspace_id: s.workspaceId,
    mode: s.mode,
    pid: s.pid,
    state: s.state,
    jsonl_path: s.jsonlPath,
    jsonl_offset: s.jsonlOffset,
    started_at: s.startedAt,
    ended_at: s.endedAt,
  });
}

export function listSessions(db: Database.Database): Session[] {
  return db.prepare<[], Row>(`SELECT * FROM sessions ORDER BY started_at ASC`).all().map(rowToSession);
}

export function listSessionsByWorkspace(db: Database.Database, workspaceId: string): Session[] {
  return db.prepare<[string], Row>(
    `SELECT * FROM sessions WHERE workspace_id = ? ORDER BY started_at ASC`
  ).all(workspaceId).map(rowToSession);
}

export function getSession(db: Database.Database, id: string): Session | null {
  const r = db.prepare<[string], Row>(`SELECT * FROM sessions WHERE id = ?`).get(id);
  return r ? rowToSession(r) : null;
}

export function updateSessionState(db: Database.Database, id: string, state: SessionState): void {
  db.prepare(`UPDATE sessions SET state = ? WHERE id = ?`).run(state, id);
}

export function updateSessionJsonlOffset(db: Database.Database, id: string, offset: number): void {
  db.prepare(`UPDATE sessions SET jsonl_offset = ? WHERE id = ?`).run(offset, id);
}
