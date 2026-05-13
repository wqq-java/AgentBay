import type { WebSocketServer, WebSocket } from 'ws';
import type { WsEvent } from '@agent-bay/shared';

export interface Hub {
  broadcast: (event: WsEvent) => void;
  close: () => void;
}

export function createHub(wss: WebSocketServer): Hub {
  const clients = new Set<WebSocket>();

  const onConnect = (ws: WebSocket) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  };
  wss.on('connection', onConnect);

  return {
    broadcast(event: WsEvent) {
      const msg = JSON.stringify(event);
      for (const c of clients) {
        if (c.readyState === c.OPEN) {
          try { c.send(msg); } catch { /* 单个 client 失败不影响其他 */ }
        }
      }
    },
    close() {
      wss.off('connection', onConnect);
      for (const c of clients) {
        try { c.close(); } catch { /* ignore */ }
      }
      clients.clear();
    },
  };
}
