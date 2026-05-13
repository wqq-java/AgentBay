import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { runMigrations } from './migrations.js';

export function openDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export function closeDb(db: Database.Database): void {
  db.close();
}
