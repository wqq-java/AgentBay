import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from './db.js';
import type Database from 'better-sqlite3';

let dbPath: string;
let db: Database.Database;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `claude-teams-test-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
});

afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

describe('db', () => {
  it('creates all 5 tables on first open', () => {
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as Array<{ name: string }>;
    const tableNames = rows.map(r => r.name);
    expect(tableNames).toContain('workspaces');
    expect(tableNames).toContain('sessions');
    expect(tableNames).toContain('agents');
    expect(tableNames).toContain('message_events');
    expect(tableNames).toContain('dispatch_queue');
  });

  it('is idempotent: reopen same db does not error', () => {
    closeDb(db);
    const reopened = openDb(dbPath);
    expect(reopened).toBeDefined();
    closeDb(reopened);
    db = openDb(dbPath); // for afterEach
  });
});
