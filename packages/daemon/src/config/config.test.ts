import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { configSchema, loadConfig, saveConfig, checkSpawnAllowed } from './config.js';

let tmpFile: string;

beforeEach(() => {
  tmpFile = path.join(os.tmpdir(), `cfg-${Date.now()}-${Math.random()}.json`);
});
afterEach(() => {
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
});

describe('config schema', () => {
  it('parses empty object with defaults', () => {
    const c = configSchema.parse({});
    expect(c.spawn.commands).toEqual(['claude', 'codex']);
    expect(c.spawn.cwds).toEqual([]);
    expect(c.spawn.maxConcurrent).toBe(20);
    expect(c.defaultTmuxSession).toBe('agent-bay');
  });

  it('overrides commands', () => {
    const c = configSchema.parse({ spawn: { commands: ['python repl'] } });
    expect(c.spawn.commands).toEqual(['python repl']);
  });
});

describe('loadConfig / saveConfig', () => {
  it('loadConfig returns defaults when file missing', () => {
    const c = loadConfig(tmpFile);
    expect(c.spawn.commands).toEqual(['claude', 'codex']);
  });

  it('saveConfig + loadConfig roundtrip', () => {
    saveConfig({
      spawn: { commands: ['go run main.go'], cwds: ['/tmp'], maxConcurrent: 5 },
      defaultTmuxSession: 'work',
    } as any, tmpFile); // eslint-disable-line @typescript-eslint/no-explicit-any
    const c = loadConfig(tmpFile);
    expect(c.spawn.commands).toEqual(['go run main.go']);
    expect(c.spawn.cwds).toEqual(['/tmp']);
    expect(c.defaultTmuxSession).toBe('work');
  });

  it('loadConfig falls back to defaults on bad JSON', () => {
    fs.writeFileSync(tmpFile, '{bad json');
    const c = loadConfig(tmpFile);
    expect(c.spawn.commands).toEqual(['claude', 'codex']);
  });
});

describe('checkSpawnAllowed', () => {
  const cfg = configSchema.parse({
    spawn: {
      commands: ['claude', 'codex'],
      cwds: ['/Users/eoi/EOI'],
      maxConcurrent: 3,
    },
  });

  it('allows whitelisted command + cwd', () => {
    expect(checkSpawnAllowed(cfg, 'claude', '/Users/eoi/EOI/aimeter', 0)).toBeNull();
  });

  it('rejects command not in allowlist', () => {
    expect(checkSpawnAllowed(cfg, 'rm -rf', '/Users/eoi/EOI', 0)).toMatch(/not in spawn allowlist/);
  });

  it('rejects cwd not in allowlist', () => {
    expect(checkSpawnAllowed(cfg, 'claude', '/etc', 0)).toMatch(/not in spawn allowlist/);
  });

  it('allows cwd as prefix match', () => {
    expect(checkSpawnAllowed(cfg, 'claude', '/Users/eoi/EOI/anything/deeper', 0)).toBeNull();
  });

  it('rejects when concurrent limit reached', () => {
    expect(checkSpawnAllowed(cfg, 'claude', '/Users/eoi/EOI', 3)).toMatch(/concurrent worker limit/);
  });

  it('empty cwds = unrestricted', () => {
    const cfg2 = configSchema.parse({ spawn: { cwds: [] } });
    expect(checkSpawnAllowed(cfg2, 'claude', '/anywhere', 0)).toBeNull();
  });

  it('command with args:claude --resume xyz allowed if "claude" in list', () => {
    expect(checkSpawnAllowed(cfg, 'claude --resume abc', '/Users/eoi/EOI', 0)).toBeNull();
  });
});
