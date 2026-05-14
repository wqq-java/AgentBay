import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb } from './db.js';
import {
  createGroup, listGroups, getGroup, getGroupByName, deleteGroup,
  getOrCreateDmGroup, listDmGroups, listNonDmGroups,
} from './groups.js';

let dbPath: string;
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `gr-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbPath);
});
afterEach(() => {
  closeDb(db);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

describe('groups catalog', () => {
  it('createGroup with defaults', () => {
    const g = createGroup(db, { name: 'team-a' });
    expect(g.name).toBe('team-a');
    expect(g.isDm).toBe(false);
    expect(g.description).toBeNull();
    expect(g.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('isDm flag stored and read back', () => {
    const g = createGroup(db, { name: 'dm:a:b', isDm: true });
    const got = getGroup(db, g.id);
    expect(got?.isDm).toBe(true);
  });

  it('UNIQUE constraint on name', () => {
    createGroup(db, { name: 'team-a' });
    expect(() => createGroup(db, { name: 'team-a' })).toThrow();
  });

  it('listGroups returns in creation order', () => {
    const g1 = createGroup(db, { name: 'a' });
    const g2 = createGroup(db, { name: 'b' });
    expect(listGroups(db).map(g => g.id)).toEqual([g1.id, g2.id]);
  });

  it('getGroupByName lookup', () => {
    createGroup(db, { name: 'unique-name', description: 'hi' });
    const got = getGroupByName(db, 'unique-name');
    expect(got?.description).toBe('hi');
    expect(getGroupByName(db, 'nope')).toBeNull();
  });

  it('deleteGroup removes row', () => {
    const g = createGroup(db, { name: 'x' });
    deleteGroup(db, g.id);
    expect(getGroup(db, g.id)).toBeNull();
  });
});

describe('DM groups', () => {
  it('getOrCreateDmGroup creates first time', () => {
    const dm = getOrCreateDmGroup(db, '%1', '%0');
    expect(dm.isDm).toBe(true);
    expect(dm.name).toBe('dm:%0:%1'); // sorted
  });

  it('getOrCreateDmGroup is idempotent regardless of arg order', () => {
    const a = getOrCreateDmGroup(db, '%1', '%0');
    const b = getOrCreateDmGroup(db, '%0', '%1');
    expect(b.id).toBe(a.id);
  });

  it('listDmGroups vs listNonDmGroups separate', () => {
    createGroup(db, { name: 'team' });
    getOrCreateDmGroup(db, '%0', '%1');
    expect(listNonDmGroups(db).map(g => g.name)).toEqual(['team']);
    expect(listDmGroups(db).map(g => g.name)).toEqual(['dm:%0:%1']);
  });
});
