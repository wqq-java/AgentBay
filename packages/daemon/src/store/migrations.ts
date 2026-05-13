import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  // v1 已废弃(扫 jsonl 模型)
  { version: 1, sql: `-- v1 placeholder (deprecated jsonl-discovery model)` },

  {
    version: 2,
    sql: `
      -- 清除 v1 遗留(如果用户从老 db 升上来)
      DROP TABLE IF EXISTS workspaces;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS message_events;
      DROP TABLE IF EXISTS dispatch_queue;
      DROP TABLE IF EXISTS agents;

      CREATE TABLE groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        is_dm INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT,
        tmux_target TEXT NOT NULL,
        pid INTEGER,
        tool TEXT NOT NULL CHECK(tool IN ('claude-code','codex','unknown')),
        status TEXT NOT NULL CHECK(status IN ('online','idle','active','waiting-approval','waiting-input','rate-limited','gone')),
        status_meta TEXT,
        group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
        last_seen_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_agents_group ON agents(group_id);
      CREATE INDEX idx_agents_status ON agents(status);

      CREATE TABLE topics (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('open','resolved')),
        resolved_at INTEGER,
        created_at INTEGER NOT NULL,
        created_by TEXT REFERENCES agents(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_topics_group ON topics(group_id);

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        from_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        image_path TEXT,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('text','ack','system','image'))
      );
      CREATE INDEX idx_messages_topic_ts ON messages(topic_id, ts);

      CREATE TABLE read_marks (
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        last_message_id INTEGER NOT NULL,
        PRIMARY KEY (agent_id, topic_id)
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
