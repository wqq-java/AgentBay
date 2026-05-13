import { useEffect } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { useAppStore } from './store/state.js';
import { connectWs } from './api/client.js';

export function App() {
  const connected = useAppStore(s => s.connected);
  const applySnapshot = useAppStore(s => s.applySnapshot);
  const applyWsEvent = useAppStore(s => s.applyWsEvent);
  const setConnected = useAppStore(s => s.setConnected);

  useEffect(() => {
    const c = connectWs(applySnapshot, applyWsEvent, setConnected);
    return () => c.close();
  }, [applySnapshot, applyWsEvent, setConnected]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Sidebar />
      </aside>
      <main className="main">
        <div className={`status ${connected ? 'ok' : 'bad'}`}>
          {connected ? 'daemon connected' : 'daemon disconnected · 重连中...'}
        </div>
        <div className="grid-placeholder">Agent 网格(M2 实装卡片渲染)</div>
      </main>
      <footer className="drawer">
        <div className="drawer-placeholder">底部主控台(M4 实装派发)</div>
      </footer>
    </div>
  );
}
