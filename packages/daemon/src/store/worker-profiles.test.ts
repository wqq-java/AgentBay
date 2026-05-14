import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from './db.js';
import {
  createWorkerProfile, listWorkerProfiles, getWorkerProfile,
  getWorkerProfileByName, deleteWorkerProfile,
} from './worker-profiles.js';

let dbPath: string;
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `wp-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
});
afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

describe('worker_profiles', () => {
  it('create + get roundtrip', () => {
    const p = createWorkerProfile(db, {
      name: 'frontend-worker',
      command: 'claude',
      cwd: '/Users/eoi/EOI/aimeter-fe',
      role: 'frontend',
    });
    expect(p.name).toBe('frontend-worker');
    expect(p.role).toBe('frontend');
    expect(getWorkerProfile(db, p.id)).toEqual(p);
  });

  it('list ordered by createdAt', () => {
    const a = createWorkerProfile(db, { name: 'a', command: 'claude', cwd: '/' });
    const b = createWorkerProfile(db, { name: 'b', command: 'codex', cwd: '/' });
    expect(listWorkerProfiles(db).map(p => p.id)).toEqual([a.id, b.id]);
  });

  it('UNIQUE constraint on name', () => {
    createWorkerProfile(db, { name: 'dup', command: 'x', cwd: '/' });
    expect(() => createWorkerProfile(db, { name: 'dup', command: 'y', cwd: '/' })).toThrow();
  });

  it('getWorkerProfileByName', () => {
    const p = createWorkerProfile(db, { name: 'unique', command: 'claude', cwd: '/' });
    expect(getWorkerProfileByName(db, 'unique')?.id).toBe(p.id);
    expect(getWorkerProfileByName(db, 'nope')).toBeNull();
  });

  it('delete', () => {
    const p = createWorkerProfile(db, { name: 'x', command: 'claude', cwd: '/' });
    deleteWorkerProfile(db, p.id);
    expect(getWorkerProfile(db, p.id)).toBeNull();
  });
});
