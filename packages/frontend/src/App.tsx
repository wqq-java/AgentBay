import { useEffect } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { MainArea } from './components/MainArea.js';
import { useAppStore } from './store/state.js';
import { fetchSnapshot, subscribeEvents } from './api/client.js';

export function App() {
  const connected = useAppStore(s => s.connected);
  const applySnapshot = useAppStore(s => s.applySnapshot);
  const applyEvent = useAppStore(s => s.applyEvent);
  const setConnected = useAppStore(s => s.setConnected);

  useEffect(() => {
    let mounted = true;
    fetchSnapshot()
      .then(snap => { if (mounted) applySnapshot(snap); })
      .catch(e => console.warn('snapshot failed', e));
    const sub = subscribeEvents(applyEvent, setConnected);
    return () => { mounted = false; sub.close(); };
  }, [applySnapshot, applyEvent, setConnected]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Sidebar />
      </aside>
      <main className="main">
        <div className={`status ${connected ? 'ok' : 'bad'}`}>
          {connected ? 'daemon connected' : 'daemon disconnected · 重连中...'}
        </div>
        <MainArea />
      </main>
    </div>
  );
}
