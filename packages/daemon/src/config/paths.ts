import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();

export function getDataDir(): string {
  return path.join(HOME, '.agent-bay');
}

export function getDbPath(): string {
  return path.join(getDataDir(), 'state.db');
}

export function getLogsDir(): string {
  return path.join(getDataDir(), 'logs');
}

export function getMcpSocketPath(): string {
  return path.join(getDataDir(), 'mcp.sock');
}
