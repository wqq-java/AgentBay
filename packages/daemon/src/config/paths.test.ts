import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { getDataDir, getDbPath, getLogsDir, getMcpSocketPath } from './paths.js';

describe('paths', () => {
  it('getDataDir returns ~/.agent-bay', () => {
    expect(getDataDir()).toBe(path.join(os.homedir(), '.agent-bay'));
  });
  it('getDbPath returns ~/.agent-bay/state.db', () => {
    expect(getDbPath()).toBe(path.join(os.homedir(), '.agent-bay', 'state.db'));
  });
  it('getLogsDir returns ~/.agent-bay/logs', () => {
    expect(getLogsDir()).toBe(path.join(os.homedir(), '.agent-bay', 'logs'));
  });
  it('getMcpSocketPath returns ~/.agent-bay/mcp.sock', () => {
    expect(getMcpSocketPath()).toBe(path.join(os.homedir(), '.agent-bay', 'mcp.sock'));
  });
});
