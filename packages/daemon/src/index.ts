#!/usr/bin/env node
import fs from 'node:fs';
import { startDaemon } from './main.js';
import { getDbPath, getDataDir } from './config/paths.js';

async function main(): Promise<void> {
  const port = Number(process.env.CLAUDE_TEAMS_PORT ?? 7777);
  fs.mkdirSync(getDataDir(), { recursive: true });

  const daemon = await startDaemon({ port, dbPath: getDbPath() });
  console.log(`claude-teams daemon listening on http://127.0.0.1:${daemon.port}`);
  console.log(`db: ${getDbPath()}`);

  const shutdown = async (): Promise<void> => {
    console.log('\nshutting down...');
    await daemon.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e: unknown) => {
  console.error('fatal:', e);
  process.exit(1);
});
