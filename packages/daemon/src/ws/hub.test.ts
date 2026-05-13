import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { createHub } from './hub.js';
import type { WsEvent } from '@agent-bay/shared';

let wss: WebSocketServer;
let port: number;
let hub: ReturnType<typeof createHub>;

beforeEach(async () => {
  wss = new WebSocketServer({ port: 0 });
  await new Promise<void>(r => wss.once('listening', () => r()));
  const addr = wss.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
  hub = createHub(wss);
});

afterEach(async () => {
  hub.close();
  await new Promise<void>(r => wss.close(() => r()));
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('hub', () => {
  it('broadcasts to all connected clients', async () => {
    const c1 = await connect();
    const c2 = await connect();
    const received1: WsEvent[] = [];
    const received2: WsEvent[] = [];
    c1.on('message', m => received1.push(JSON.parse(m.toString())));
    c2.on('message', m => received2.push(JSON.parse(m.toString())));

    // give the hub time to register both clients
    await new Promise(r => setTimeout(r, 30));

    hub.broadcast({ type: 'session-ended', sessionId: 'abc' });
    await new Promise(r => setTimeout(r, 30));

    expect(received1).toEqual([{ type: 'session-ended', sessionId: 'abc' }]);
    expect(received2).toEqual([{ type: 'session-ended', sessionId: 'abc' }]);
    c1.close();
    c2.close();
  });

  it('does not throw when no clients are connected', () => {
    expect(() => hub.broadcast({ type: 'session-ended', sessionId: 'x' })).not.toThrow();
  });
});
