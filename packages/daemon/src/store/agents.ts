import type Database from 'better-sqlite3';
import type { Agent, AgentTool, AgentStatus } from '@agent-bay/shared';

interface Row {
  id: string;
  name: string;
  role: string | null;
  tmux_target: string;
  pid: number | null;
  tool: AgentTool;
  status: AgentStatus;
  status_meta: string | null;
  group_id: string | null;
  last_seen_at: number;
  created_at: number;
}

function rowToAgent(r: Row): Agent {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    tmuxTarget: r.tmux_target,
    pid: r.pid,
    tool: r.tool,
    status: r.status,
    statusMeta: r.status_meta ? JSON.parse(r.status_meta) : null,
    groupId: r.group_id,
    lastSeenAt: r.last_seen_at,
    createdAt: r.created_at,
  };
}

export function upsertAgent(db: Database.Database, a: Agent): void {
  db.prepare(`
    INSERT INTO agents (id, name, role, tmux_target, pid, tool, status, status_meta, group_id, last_seen_at, created_at)
    VALUES (@id, @name, @role, @tmux_target, @pid, @tool, @status, @status_meta, @group_id, @last_seen_at, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      tmux_target = excluded.tmux_target,
      pid = excluded.pid,
      tool = excluded.tool,
      status = excluded.status,
      status_meta = excluded.status_meta,
      group_id = excluded.group_id,
      last_seen_at = excluded.last_seen_at
  `).run({
    id: a.id,
    name: a.name,
    role: a.role,
    tmux_target: a.tmuxTarget,
    pid: a.pid,
    tool: a.tool,
    status: a.status,
    status_meta: a.statusMeta ? JSON.stringify(a.statusMeta) : null,
    group_id: a.groupId,
    last_seen_at: a.lastSeenAt,
    created_at: a.createdAt,
  });
}

export function listAgents(db: Database.Database): Agent[] {
  return db.prepare<[], Row>(`SELECT * FROM agents ORDER BY created_at ASC`).all().map(rowToAgent);
}

export function listAgentsByGroup(db: Database.Database, groupId: string): Agent[] {
  return db.prepare<[string], Row>(
    `SELECT * FROM agents WHERE group_id = ? ORDER BY name`
  ).all(groupId).map(rowToAgent);
}

export function listOnlineAgents(db: Database.Database): Agent[] {
  return db.prepare<[], Row>(
    `SELECT * FROM agents WHERE status != 'gone' ORDER BY name`
  ).all().map(rowToAgent);
}

export function getAgent(db: Database.Database, id: string): Agent | null {
  const r = db.prepare<[string], Row>(`SELECT * FROM agents WHERE id = ?`).get(id);
  return r ? rowToAgent(r) : null;
}

export function getAgentByTmuxTarget(db: Database.Database, tmuxTarget: string): Agent | null {
  const r = db.prepare<[string], Row>(`SELECT * FROM agents WHERE tmux_target = ?`).get(tmuxTarget);
  return r ? rowToAgent(r) : null;
}

export function markAgentGone(db: Database.Database, id: string): void {
  db.prepare(`UPDATE agents SET status = 'gone', last_seen_at = ? WHERE id = ?`).run(Date.now(), id);
}

export function updateAgentStatus(
  db: Database.Database,
  id: string,
  status: AgentStatus,
  statusMeta: Record<string, unknown> | null = null,
): void {
  db.prepare(`UPDATE agents SET status = ?, status_meta = ?, last_seen_at = ? WHERE id = ?`).run(
    status,
    statusMeta ? JSON.stringify(statusMeta) : null,
    Date.now(),
    id,
  );
}

export function updateAgentGroup(db: Database.Database, id: string, groupId: string | null): void {
  db.prepare(`UPDATE agents SET group_id = ? WHERE id = ?`).run(groupId, id);
}

export function renameAgent(db: Database.Database, id: string, name: string): void {
  db.prepare(`UPDATE agents SET name = ? WHERE id = ?`).run(name, id);
}
