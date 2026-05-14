// AgentBay daemon 主入口(start 子命令调用):装配 db / scanner / sse / http。

import type { AddressInfo } from 'node:net';
import { openDb, closeDb } from './store/db.js';
import { startHttpServer } from './http/server.js';
import { createSseHub } from './http/sse.js';
import { createScanner } from './scanner/scanner.js';
import { startConversationWatchers } from './conversation/watcher.js';

export interface DaemonOpts {
  port: number;
  dbPath: string;
  /** scanner 轮询间隔(ms),默认 5000;测试可设 0 关闭周期 */
  scanIntervalMs?: number;
  /** 关闭 scanner 自启(测试用) */
  noScanner?: boolean;
}

export interface DaemonHandle {
  port: number;
  stop: () => Promise<void>;
}

export async function startDaemon(opts: DaemonOpts): Promise<DaemonHandle> {
  const db = openDb(opts.dbPath);
  const sse = createSseHub();

  const http = await startHttpServer({ db, port: opts.port, sse });

  let stopScanner: (() => void) | null = null;
  if (!opts.noScanner) {
    const scanner = createScanner({
      db,
      broadcast: sse.broadcast,
      intervalMs: opts.scanIntervalMs ?? 5000,
    });
    stopScanner = scanner.start();
  }

  // Conversation watchers:监 jsonl 变化 → SSE 推到聊天界面
  const convWatchers = opts.noScanner ? null : startConversationWatchers(db, sse.broadcast);

  const addr = http.address() as AddressInfo;

  return {
    port: addr.port,
    async stop() {
      stopScanner?.();
      convWatchers?.stop();
      await http.stop();
      closeDb(db);
    },
  };
}
