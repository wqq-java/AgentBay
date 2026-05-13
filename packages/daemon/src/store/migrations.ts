import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK(mode IN ('owned','observed')),
        pid INTEGER,
        state TEXT NOT NULL CHECK(state IN ('running','idle','crashed','ended')),
        jsonl_path TEXT NOT NULL,
        jsonl_offset INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT,
        state TEXT NOT NULL CHECK(state IN ('idle','thinking','tool-running','blocked','errored')),
        token_count INTEGER NOT NULL DEFAULT 0,
        context_pct REAL NOT NULL DEFAULT 0,
        last_activity_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);

      CREATE TABLE IF NOT EXISTS message_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        from_agent TEXT,
        to_agent TEXT,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_msg_session_ts ON message_events(session_id, ts);

      CREATE TABLE IF NOT EXISTS dispatch_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        flushed_at INTEGER
      );
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`);
  const appliedRow = db.prepare(`SELECT MAX(version) AS v FROM _migrations`).get() as { v: number | null };
  const applied = appliedRow.v ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version > applied) {
      db.exec(m.sql);
      db.prepare(`INSERT INTO _migrations(version, applied_at) VALUES (?, ?)`).run(m.version, Date.now());
    }
  }
}
