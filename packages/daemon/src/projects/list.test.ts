import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { listProjectsUnder, expandPath } from './list.js';

let root: string;

beforeEach(() => {
  root = path.join(os.tmpdir(), `pl-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(root, { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('listProjectsUnder', () => {
  it('returns subdirs', async () => {
    fs.mkdirSync(path.join(root, 'a'));
    fs.mkdirSync(path.join(root, 'b'));
    fs.writeFileSync(path.join(root, 'file.txt'), 'x');
    const r = await listProjectsUnder(root);
    expect(r.map(p => p.name).sort()).toEqual(['a', 'b']);
  });

  it('hides dotdirs by default', async () => {
    fs.mkdirSync(path.join(root, 'visible'));
    fs.mkdirSync(path.join(root, '.hidden'));
    const r = await listProjectsUnder(root);
    expect(r.map(p => p.name)).toEqual(['visible']);
  });

  it('detects PROJECT_MARKERS', async () => {
    fs.mkdirSync(path.join(root, 'p1'));
    fs.writeFileSync(path.join(root, 'p1', 'package.json'), '{}');
    fs.mkdirSync(path.join(root, 'p1', '.git'));
    fs.mkdirSync(path.join(root, 'p2'));
    const r = await listProjectsUnder(root);
    const p1 = r.find(p => p.name === 'p1')!;
    expect(p1.markers.sort()).toEqual(['.git', 'package.json']);
    expect(r.find(p => p.name === 'p2')!.markers).toEqual([]);
  });

  it('sorts marked first then by mtime', async () => {
    fs.mkdirSync(path.join(root, 'plain'));
    fs.mkdirSync(path.join(root, 'with-marker'));
    fs.writeFileSync(path.join(root, 'with-marker', 'CLAUDE.md'), '');
    const r = await listProjectsUnder(root);
    expect(r[0].name).toBe('with-marker');
  });

  it('throws on missing root', async () => {
    await expect(listProjectsUnder(path.join(root, 'no-such'))).rejects.toThrow(/无法列出/);
  });

  it('expands ~/ path', () => {
    expect(expandPath('~')).toBe(os.homedir());
    expect(expandPath('~/foo')).toBe(path.join(os.homedir(), 'foo'));
    expect(expandPath('/abs')).toBe('/abs');
  });
});
