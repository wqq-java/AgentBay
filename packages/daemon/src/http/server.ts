import express from 'express';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import type Database from 'better-sqlite3';
import { listWorkspaces } from '../store/workspaces.js';
import { listSessions } from '../store/sessions.js';
import { listAllAgents } from '../store/agents.js';
import { hookEventSchema } from '../hooks/schemas.js';
import { handleHookEvent } from '../hooks/router.js';
import type { WsEvent } from '@claude-teams/shared';

export interface StartOpts {
  db: Database.Database;
  port: number;       // 0 = 任意可用端口(测试用)
  broadcast: (event: WsEvent) => void;
}

export interface ServerHandle {
  stop: () => Promise<void>;
  address: () => ReturnType<http.Server['address']>;
  wss: WebSocketServer;
}

export async function startHttpServer(opts: StartOpts): Promise<ServerHandle> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/snapshot', (_req, res) => {
    res.json({
      workspaces: listWorkspaces(opts.db),
      sessions: listSessions(opts.db),
      agents: listAllAgents(opts.db),
    });
  });

  app.post('/api/hook-event', (req, res) => {
    const parsed = hookEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid payload', issues: parsed.error.issues });
      return;
    }
    try {
      handleHookEvent(opts.db, opts.broadcast, parsed.data);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  await new Promise<void>((resolve) => {
    server.listen(opts.port, '127.0.0.1', () => resolve());
  });

  return {
    stop: () => new Promise<void>((resolve) => {
      wss.close(() => server.close(() => resolve()));
    }),
    address: () => server.address(),
    wss,
  };
}
