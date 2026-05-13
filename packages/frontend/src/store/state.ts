import { create } from 'zustand';
import type { Workspace, Session, Agent, WsEvent } from '@agent-bay/shared';

type Dict<T> = Record<string, T>;

interface State {
  workspaces: Dict<Workspace>;
  sessions: Dict<Session>;
  agents: Dict<Agent>;
  connected: boolean;
  applySnapshot: (snap: { workspaces: Workspace[]; sessions: Session[]; agents: Agent[] }) => void;
  applyWsEvent: (event: WsEvent) => void;
  setConnected: (connected: boolean) => void;
}

function indexBy<T extends { id: string }>(items: T[]): Dict<T> {
  const out: Dict<T> = {};
  for (const it of items) out[it.id] = it;
  return out;
}

export const useAppStore = create<State>((set) => ({
  workspaces: {},
  sessions: {},
  agents: {},
  connected: false,
  applySnapshot: (snap) => set({
    workspaces: indexBy(snap.workspaces),
    sessions: indexBy(snap.sessions),
    agents: indexBy(snap.agents),
  }),
  applyWsEvent: (event) => set((state) => {
    switch (event.type) {
      case 'workspace-created':
      case 'workspace-updated':
        return { workspaces: { ...state.workspaces, [event.workspace.id]: event.workspace } };
      case 'session-created':
      case 'session-updated':
        return { sessions: { ...state.sessions, [event.session.id]: event.session } };
      case 'session-ended': {
        const next = { ...state.sessions };
        delete next[event.sessionId];
        return { sessions: next };
      }
      case 'agent-created':
      case 'agent-updated':
        return { agents: { ...state.agents, [event.agent.id]: event.agent } };
      case 'message-event':
        return {}; // M2 处理
      case 'snapshot':
        return {
          workspaces: indexBy(event.workspaces),
          sessions: indexBy(event.sessions),
          agents: indexBy(event.agents),
        };
      default:
        return {};
    }
  }),
  setConnected: (connected) => set({ connected }),
}));
