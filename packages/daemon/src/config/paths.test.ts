import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { getDataDir, getDbPath, getLogsDir, getClaudeProjectsDir } from './paths.js';

describe('paths', () => {
  it('getDataDir returns ~/.claude-teams', () => {
    expect(getDataDir()).toBe(path.join(os.homedir(), '.claude-teams'));
  });
  it('getDbPath returns ~/.claude-teams/state.db', () => {
    expect(getDbPath()).toBe(path.join(os.homedir(), '.claude-teams', 'state.db'));
  });
  it('getLogsDir returns ~/.claude-teams/logs', () => {
    expect(getLogsDir()).toBe(path.join(os.homedir(), '.claude-teams', 'logs'));
  });
  it('getClaudeProjectsDir returns ~/.claude/projects', () => {
    expect(getClaudeProjectsDir()).toBe(path.join(os.homedir(), '.claude', 'projects'));
  });
});
