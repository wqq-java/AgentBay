import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from '../store/db.js';
import { listSessions } from '../store/sessions.js';
import { listWorkspaces } from '../store/workspaces.js';
import { discoverObservedSessions } from './scan.js';

let dbPath: string;
let projectsDir: string;
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  const stamp = `${Date.now()}-${Math.random()}`;
  dbPath = path.join(os.tmpdir(), `disc-${stamp}.db`);
  projectsDir = path.join(os.tmpdir(), `disc-projects-${stamp}`);
  fs.mkdirSync(projectsDir, { recursive: true });
  db = openDb(dbPath);
});
afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  fs.rmSync(projectsDir, { recursive: true, force: true });
});

function fixture(encodedCwd: string, sessionId: string, content: string = '') {
  const dir = path.join(projectsDir, encodedCwd);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), content);
}

describe('discovery', () => {
  it('scans empty projects dir without error', async () => {
    await discoverObservedSessions(db, projectsDir);
    expect(listSessions(db)).toEqual([]);
  });

  it('creates a Workspace and Session for each jsonl file', async () => {
    fixture('-Users-eoi-EOI-aimeter', 'sess-1', '{"type":"last-prompt","sessionId":"sess-1"}\n');
    fixture('-Users-eoi-EOI-eoi-mc', 'sess-2', '');
    await discoverObservedSessions(db, projectsDir);
    expect(listWorkspaces(db)).toHaveLength(2);
    expect(listSessions(db)).toHaveLength(2);
    const sessions = listSessions(db);
    expect(sessions.every(s => s.mode === 'observed')).toBe(true);
    expect(sessions.every(s => s.state === 'idle')).toBe(true);
    expect(sessions.find(s => s.id === 'sess-1')?.jsonlPath).toBe(
      path.join(projectsDir, '-Users-eoi-EOI-aimeter', 'sess-1.jsonl')
    );
  });

  it('is idempotent — second scan does not duplicate', async () => {
    fixture('-Users-eoi-EOI', 'sess-X', '');
    await discoverObservedSessions(db, projectsDir);
    await discoverObservedSessions(db, projectsDir);
    expect(listSessions(db)).toHaveLength(1);
    expect(listWorkspaces(db)).toHaveLength(1);
  });

  it('extracts real cwd from jsonl cwd field when present', async () => {
    fixture(
      '-some-encoded-name',
      'sess-real',
      '{"type":"user","sessionId":"sess-real","cwd":"/Users/eoi/EOI/real-cwd"}\n'
    );
    await discoverObservedSessions(db, projectsDir);
    const ws = listWorkspaces(db);
    expect(ws[0].cwd).toBe('/Users/eoi/EOI/real-cwd');
    expect(ws[0].label).toBe('real-cwd');
  });
});
