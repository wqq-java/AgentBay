import type Database from 'better-sqlite3';
import type { Agent, AgentState } from '@claude-teams/shared';

interface Row {
  id: string;
  session_id: string;
  name: string;
  role: string | null;
  state: AgentState;
  token_count: number;
  context_pct: number;
  last_activity_at: number | null;
}

function rowToAgent(r: Row): Agent {
  return {
    id: r.id,
    sessionId: r.session_id,
    name: r.name,
    role: r.role,
    state: r.state,
    tokenCount: r.token_count,
    contextPct: r.context_pct,
    lastActivityAt: r.last_activity_at,
  };
}

export function upsertAgent(db: Database.Database, a: Agent): void {
  db.prepare(`
    INSERT INTO agents (id, session_id, name, role, state, token_count, context_pct, last_activity_at)
    VALUES (@id, @session_id, @name, @role, @state, @token_count, @context_pct, @last_activity_at)
    ON CONFLICT(id) DO UPDATE SET
      role = excluded.role,
      state = excluded.state,
      token_count = excluded.token_count,
      context_pct = excluded.context_pct,
      last_activity_at = excluded.last_activity_at
  `).run({
    id: a.id,
    session_id: a.sessionId,
    name: a.name,
    role: a.role,
    state: a.state,
    token_count: a.tokenCount,
    context_pct: a.contextPct,
    last_activity_at: a.lastActivityAt,
  });
}

export function listAgentsBySession(db: Database.Database, sessionId: string): Agent[] {
  return db.prepare<[string], Row>(`SELECT * FROM agents WHERE session_id = ? ORDER BY name`).all(sessionId).map(rowToAgent);
}

export function listAllAgents(db: Database.Database): Agent[] {
  return db.prepare<[], Row>(`SELECT * FROM agents ORDER BY session_id, name`).all().map(rowToAgent);
}

export function getAgent(db: Database.Database, id: string): Agent | null {
  const r = db.prepare<[string], Row>(`SELECT * FROM agents WHERE id = ?`).get(id);
  return r ? rowToAgent(r) : null;
}

export function updateAgentState(db: Database.Database, id: string, state: AgentState): void {
  db.prepare(`UPDATE agents SET state = ?, last_activity_at = ? WHERE id = ?`).run(state, Date.now(), id);
}

export function updateAgentTokens(db: Database.Database, id: string, tokenCount: number, contextPct: number): void {
  db.prepare(`UPDATE agents SET token_count = ?, context_pct = ? WHERE id = ?`).run(tokenCount, contextPct, id);
}
