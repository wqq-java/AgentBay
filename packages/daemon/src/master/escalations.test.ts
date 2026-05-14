import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from '../store/db.js';
import { insertEscalation, listEscalations, resolveEscalation, getEscalation } from './escalations.js';

let dbPath: string;
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `esc-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
});
afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

describe('escalations', () => {
  it('insert + get roundtrip', () => {
    const e = insertEscalation(db, { severity: 'warn', message: 'foo' });
    expect(e.severity).toBe('warn');
    expect(e.message).toBe('foo');
    expect(e.resolved).toBe(false);
    expect(getEscalation(db, e.id)).toEqual(e);
  });

  it('list ordered by ts DESC', async () => {
    const a = insertEscalation(db, { severity: 'info', message: 'a' });
    await new Promise(r => setTimeout(r, 10));
    const b = insertEscalation(db, { severity: 'info', message: 'b' });
    expect(listEscalations(db).map(x => x.id)).toEqual([b.id, a.id]);
  });

  it('onlyOpen filter', () => {
    const a = insertEscalation(db, { severity: 'warn', message: 'a' });
    const b = insertEscalation(db, { severity: 'warn', message: 'b' });
    resolveEscalation(db, a.id);
    expect(listEscalations(db, { onlyOpen: true }).map(x => x.id)).toEqual([b.id]);
  });

  it('resolveEscalation idempotent', () => {
    const e = insertEscalation(db, { severity: 'blocker', message: 'x' });
    const r1 = resolveEscalation(db, e.id);
    const ts1 = r1?.resolvedAt;
    expect(r1?.resolved).toBe(true);
    const r2 = resolveEscalation(db, e.id);
    expect(r2?.resolvedAt).toBe(ts1);
  });

  it('resolveEscalation on missing id returns null', () => {
    expect(resolveEscalation(db, 999)).toBeNull();
  });

  it('limit option', () => {
    for (let i = 0; i < 10; i++) insertEscalation(db, { severity: 'info', message: `${i}` });
    expect(listEscalations(db, { limit: 3 })).toHaveLength(3);
  });
});
