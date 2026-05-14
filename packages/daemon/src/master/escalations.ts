// Escalation:agent / master 跟 human 的规范化通讯通道。
// 升级后写入 SQLite + 推 ntfy。

import type Database from 'better-sqlite3';

export type Severity = 'info' | 'warn' | 'blocker';

export interface Escalation {
  id: number;
  ts: number;
  severity: Severity;
  message: string;
  fromAgentId: string | null;
  resolved: boolean;
  resolvedAt: number | null;
}

interface Row {
  id: number;
  ts: number;
  severity: Severity;
  message: string;
  from_agent_id: string | null;
  resolved: number;
  resolved_at: number | null;
}

function rowToEsc(r: Row): Escalation {
  return {
    id: r.id,
    ts: r.ts,
    severity: r.severity,
    message: r.message,
    fromAgentId: r.from_agent_id,
    resolved: r.resolved === 1,
    resolvedAt: r.resolved_at,
  };
}

export function insertEscalation(
  db: Database.Database,
  opts: { severity: Severity; message: string; fromAgentId?: string | null },
): Escalation {
  const ts = Date.now();
  const info = db.prepare(`
    INSERT INTO escalations (ts, severity, message, from_agent_id, resolved)
    VALUES (?, ?, ?, ?, 0)
  `).run(ts, opts.severity, opts.message, opts.fromAgentId ?? null);
  return {
    id: Number(info.lastInsertRowid),
    ts,
    severity: opts.severity,
    message: opts.message,
    fromAgentId: opts.fromAgentId ?? null,
    resolved: false,
    resolvedAt: null,
  };
}

export function listEscalations(
  db: Database.Database,
  opts: { onlyOpen?: boolean; limit?: number } = {},
): Escalation[] {
  const limit = opts.limit ?? 50;
  const sql = opts.onlyOpen
    ? `SELECT * FROM escalations WHERE resolved = 0 ORDER BY ts DESC LIMIT ?`
    : `SELECT * FROM escalations ORDER BY ts DESC LIMIT ?`;
  return db.prepare<[number], Row>(sql).all(limit).map(rowToEsc);
}

export function resolveEscalation(db: Database.Database, id: number): Escalation | null {
  db.prepare(`UPDATE escalations SET resolved = 1, resolved_at = ? WHERE id = ? AND resolved = 0`)
    .run(Date.now(), id);
  const r = db.prepare<[number], Row>(`SELECT * FROM escalations WHERE id = ?`).get(id);
  return r ? rowToEsc(r) : null;
}

export function getEscalation(db: Database.Database, id: number): Escalation | null {
  const r = db.prepare<[number], Row>(`SELECT * FROM escalations WHERE id = ?`).get(id);
  return r ? rowToEsc(r) : null;
}
