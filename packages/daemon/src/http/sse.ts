// SSE 实现 ——— 一向推,前端用 EventSource 订阅。
// 替代了 v1 的 WebSocket Hub。
//
// 用法:把 sseHandler 挂到 Express GET /api/events,然后用 broadcast(ev) 推。

import type { Response, Request } from 'express';
import type { ServerEvent } from '@agent-bay/shared';

export interface SseHub {
  broadcast: (event: ServerEvent) => void;
  handler: (req: Request, res: Response) => void;
  close: () => void;
  /** 连接数,测试用 */
  size: () => number;
}

export function createSseHub(): SseHub {
  const clients = new Set<Response>();
  let heartbeat: NodeJS.Timeout | null = null;

  function send(res: Response, data: string) {
    try { res.write(`data: ${data}\n\n`); }
    catch { clients.delete(res); }
  }

  function startHeartbeat() {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
      for (const c of clients) {
        try { c.write(': heartbeat\n\n'); } catch { clients.delete(c); }
      }
    }, 15000);
  }

  function handler(req: Request, res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(': connected\n\n');
    clients.add(res);
    startHeartbeat();
    req.on('close', () => { clients.delete(res); });
  }

  return {
    broadcast(event) {
      const payload = JSON.stringify(event);
      for (const c of clients) send(c, payload);
    },
    handler,
    close() {
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      for (const c of clients) {
        try { c.end(); } catch { /* ignore */ }
      }
      clients.clear();
    },
    size: () => clients.size,
  };
}
