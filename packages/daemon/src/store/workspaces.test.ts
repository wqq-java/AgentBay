import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from './db.js';
import { createOrGetWorkspaceByCwd, listWorkspaces, getWorkspace } from './workspaces.js';

let dbPath: string;
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `cw-test-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
});
afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

describe('workspaces catalog', () => {
  it('createOrGetWorkspaceByCwd creates new workspace with basename as label', () => {
    const ws = createOrGetWorkspaceByCwd(db, '/Users/eoi/EOI/aimeter');
    expect(ws.cwd).toBe('/Users/eoi/EOI/aimeter');
    expect(ws.label).toBe('aimeter');
    expect(ws.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ws.createdAt).toBeGreaterThan(0);
  });

  it('createOrGetWorkspaceByCwd is idempotent — same cwd returns same row', () => {
    const w1 = createOrGetWorkspaceByCwd(db, '/foo/bar');
    const w2 = createOrGetWorkspaceByCwd(db, '/foo/bar');
    expect(w2.id).toBe(w1.id);
    expect(listWorkspaces(db)).toHaveLength(1);
  });

  it('listWorkspaces returns all sorted by createdAt asc', () => {
    const a = createOrGetWorkspaceByCwd(db, '/a');
    const b = createOrGetWorkspaceByCwd(db, '/b');
    const list = listWorkspaces(db);
    expect(list.map(w => w.id)).toEqual([a.id, b.id]);
  });

  it('getWorkspace returns null for unknown id', () => {
    expect(getWorkspace(db, 'nonexistent')).toBeNull();
  });
});
