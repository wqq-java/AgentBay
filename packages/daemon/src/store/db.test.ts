import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from './db.js';
import type Database from 'better-sqlite3';

let dbPath: string;
let db: Database.Database;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `agent-bay-test-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
});

afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

describe('db', () => {
  it('creates v2 tables on first open', () => {
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as Array<{ name: string }>;
    const names = rows.map(r => r.name);
    expect(names).toContain('agents');
    expect(names).toContain('groups');
    expect(names).toContain('topics');
    expect(names).toContain('messages');
    expect(names).toContain('read_marks');
    expect(names).not.toContain('workspaces');
    expect(names).not.toContain('sessions');
  });

  it('is idempotent: reopen same db does not error', () => {
    closeDb(db);
    const reopened = openDb(dbPath);
    expect(reopened).toBeDefined();
    closeDb(reopened);
    db = openDb(dbPath); // for afterEach
  });

  it('foreign key cascade: delete group cascades topics', () => {
    db.exec(`INSERT INTO groups (id, name, is_dm, created_at) VALUES ('g1', 'team', 0, ${Date.now()})`);
    db.exec(`INSERT INTO topics (id, group_id, title, state, created_at) VALUES ('t1', 'g1', 'hi', 'open', ${Date.now()})`);
    expect((db.prepare(`SELECT COUNT(*) as c FROM topics`).get() as { c: number }).c).toBe(1);
    db.exec(`DELETE FROM groups WHERE id = 'g1'`);
    expect((db.prepare(`SELECT COUNT(*) as c FROM topics`).get() as { c: number }).c).toBe(0);
  });
});
