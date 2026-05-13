import type { AddressInfo } from 'node:net';
import { openDb, closeDb } from './store/db.js';
import { discoverObservedSessions } from './discovery/scan.js';
import { startHttpServer } from './http/server.js';
import { createHub } from './ws/hub.js';
import { getClaudeProjectsDir } from './config/paths.js';
import type { WsEvent } from '@agent-bay/shared';

export interface DaemonOpts {
  port: number;
  dbPath: string;
  claudeProjectsDir?: string;
}

export interface DaemonHandle {
  port: number;
  stop: () => Promise<void>;
}

export async function startDaemon(opts: DaemonOpts): Promise<DaemonHandle> {
  const db = openDb(opts.dbPath);
  const projectsDir = opts.claudeProjectsDir ?? getClaudeProjectsDir();

  await discoverObservedSessions(db, projectsDir);

  // 先建一个 placeholder broadcast,等 http server 起来之后再换成真 hub
  let realBroadcast: ((e: WsEvent) => void) | null = null;
  const broadcast = (e: WsEvent) => {
    realBroadcast?.(e);
  };

  const http = await startHttpServer({ db, port: opts.port, broadcast });
  const hub = createHub(http.wss);
  realBroadcast = hub.broadcast;

  const addr = http.address() as AddressInfo;

  return {
    port: addr.port,
    async stop() {
      hub.close();
      await http.stop();
      closeDb(db);
    },
  };
}
