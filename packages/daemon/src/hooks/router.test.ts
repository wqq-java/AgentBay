import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from '../store/db.js';
import { listSessions } from '../store/sessions.js';
import { listWorkspaces } from '../store/workspaces.js';
import { handleHookEvent } from './router.js';

let dbPath: string;
let db: ReturnType<typeof openDb>;
const broadcast = vi.fn();

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `hr-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
  broadcast.mockReset();
});
afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

describe('hook router', () => {
  it('SessionStart creates Workspace + Session(observed) and broadcasts', () => {
    handleHookEvent(db, broadcast, {
      hook_event_name: 'SessionStart',
      session_id: 'new-sess',
      cwd: '/Users/eoi/EOI/foo',
    });
    expect(listWorkspaces(db)).toHaveLength(1);
    expect(listSessions(db)).toHaveLength(1);
    const s = listSessions(db)[0];
    expect(s.id).toBe('new-sess');
    expect(s.mode).toBe('observed');
    expect(s.state).toBe('running');
    expect(broadcast).toHaveBeenCalled();
    expect(broadcast.mock.calls.some(c => (c[0] as { type?: string })?.type === 'session-created')).toBe(true);
  });

  it('SessionStart for existing session is idempotent (does not duplicate)', () => {
    handleHookEvent(db, broadcast, { hook_event_name: 'SessionStart', session_id: 'x', cwd: '/a' });
    handleHookEvent(db, broadcast, { hook_event_name: 'SessionStart', session_id: 'x', cwd: '/a' });
    expect(listSessions(db)).toHaveLength(1);
  });

  it('unknown event types are accepted but ignored (no throw)', () => {
    expect(() => handleHookEvent(db, broadcast, { hook_event_name: 'FutureEventX', session_id: 'x' })).not.toThrow();
  });
});
