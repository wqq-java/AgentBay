import type { Workspace, Session, Agent, WsEvent } from '@agent-bay/shared';

export interface Snapshot {
  workspaces: Workspace[];
  sessions: Session[];
  agents: Agent[];
}

export async function fetchSnapshot(): Promise<Snapshot> {
  const r = await fetch('/api/snapshot');
  if (!r.ok) throw new Error(`snapshot ${r.status}`);
  return await r.json();
}

export interface WsClient {
  close: () => void;
}

/**
 * 连 WS,带指数退避重连;每次连上(含重连)先调 fetchSnapshot 同步全量,然后订阅增量。
 */
export function connectWs(
  onSnapshot: (s: Snapshot) => void,
  onEvent: (e: WsEvent) => void,
  onConnected: (connected: boolean) => void,
): WsClient {
  let ws: WebSocket | null = null;
  let retryMs = 500;
  let closed = false;

  async function connect(): Promise<void> {
    if (closed) return;
    try {
      const snap = await fetchSnapshot();
      onSnapshot(snap);
    } catch (e) {
      console.warn('snapshot failed, will retry', e);
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 8000);
      return;
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onopen = () => {
      retryMs = 500;
      onConnected(true);
    };
    ws.onmessage = (m) => {
      try { onEvent(JSON.parse(m.data)); } catch (e) { console.warn('bad ws msg', e); }
    };
    ws.onclose = () => {
      onConnected(false);
      if (!closed) setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 8000);
    };
    ws.onerror = () => { /* onclose 接管 */ };
  }

  void connect();

  return {
    close() {
      closed = true;
      ws?.close();
    },
  };
}
