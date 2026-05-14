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
  is_spawned: number;
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
    isSpawned: r.is_spawned === 1,
    lastSeenAt: r.last_seen_at,
    createdAt: r.created_at,
  };
}

export function upsertAgent(db: Database.Database, a: Agent): void {
  db.prepare(`
    INSERT INTO agents (id, name, role, tmux_target, pid, tool, status, status_meta, group_id, is_spawned, last_seen_at, created_at)
    VALUES (@id, @name, @role, @tmux_target, @pid, @tool, @status, @status_meta, @group_id, @is_spawned, @last_seen_at, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      tmux_target = excluded.tmux_target,
      pid = excluded.pid,
      tool = excluded.tool,
      status = excluded.status,
      status_meta = excluded.status_meta,
      group_id = excluded.group_id,
      is_spawned = MAX(agents.is_spawned, excluded.is_spawned),
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
    is_spawned: a.isSpawned ? 1 : 0,
    last_seen_at: a.lastSeenAt,
    created_at: a.createdAt,
  });
}

export function markAgentSpawned(db: Database.Database, id: string): void {
  db.prepare(`UPDATE agents SET is_spawned = 1 WHERE id = ?`).run(id);
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

/**
 * 更新 agent 的 status + statusMeta。
 *
 * **重要:meta 是 MERGE 语义,不是 REPLACE。**
 * 传入字段覆盖同名旧字段,其余旧字段保留。这样:
 *   - spawn 时存的 cwd / sessionId 不会被状态机轮询覆写
 *   - 状态机只更新它关心的 contextPct / usagePct / rateLimitHint 等
 */
export function updateAgentStatus(
  db: Database.Database,
  id: string,
  status: AgentStatus,
  statusMeta: Record<string, unknown> | null = null,
): void {
  const row = db.prepare<[string], { status_meta: string | null }>(
    `SELECT status_meta FROM agents WHERE id = ?`,
  ).get(id);
  const cur = row?.status_meta ? JSON.parse(row.status_meta) as Record<string, unknown> : {};
  const merged: Record<string, unknown> = statusMeta ? { ...cur, ...statusMeta } : cur;
  const metaStr = Object.keys(merged).length > 0 ? JSON.stringify(merged) : null;
  db.prepare(`UPDATE agents SET status = ?, status_meta = ?, last_seen_at = ? WHERE id = ?`).run(
    status, metaStr, Date.now(), id,
  );
}

/** 强制覆写 statusMeta(测试 / 修数据用) */
export function replaceAgentStatusMeta(
  db: Database.Database,
  id: string,
  statusMeta: Record<string, unknown> | null,
): void {
  db.prepare(`UPDATE agents SET status_meta = ? WHERE id = ?`).run(
    statusMeta ? JSON.stringify(statusMeta) : null,
    id,
  );
}

export function updateAgentGroup(db: Database.Database, id: string, groupId: string | null): void {
  db.prepare(`UPDATE agents SET group_id = ? WHERE id = ?`).run(groupId, id);
}

export function renameAgent(db: Database.Database, id: string, name: string): void {
  db.prepare(`UPDATE agents SET name = ? WHERE id = ?`).run(name, id);
}
