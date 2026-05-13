import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './state.js';
import type { Workspace, Session, Agent } from '@claude-teams/shared';

const w1: Workspace = { id: 'w1', cwd: '/foo', label: 'foo', createdAt: 1 };
const s1: Session = {
  id: 's1', workspaceId: 'w1', mode: 'observed', pid: null, state: 'running',
  jsonlPath: '/x.jsonl', jsonlOffset: 0, startedAt: 2, endedAt: null,
};
const a1: Agent = {
  id: 's1:main', sessionId: 's1', name: 'main', role: null,
  state: 'idle', tokenCount: 0, contextPct: 0, lastActivityAt: null,
};

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({ workspaces: {}, sessions: {}, agents: {}, connected: false });
  });

  it('applySnapshot replaces state', () => {
    useAppStore.getState().applySnapshot({
      workspaces: [w1], sessions: [s1], agents: [a1],
    });
    const s = useAppStore.getState();
    expect(s.workspaces['w1']).toEqual(w1);
    expect(s.sessions['s1']).toEqual(s1);
    expect(s.agents['s1:main']).toEqual(a1);
  });

  it('applyWsEvent session-created adds session', () => {
    useAppStore.getState().applyWsEvent({ type: 'session-created', session: s1 });
    expect(useAppStore.getState().sessions['s1']).toEqual(s1);
  });

  it('applyWsEvent session-ended removes session', () => {
    useAppStore.setState({ sessions: { s1 } });
    useAppStore.getState().applyWsEvent({ type: 'session-ended', sessionId: 's1' });
    expect(useAppStore.getState().sessions['s1']).toBeUndefined();
  });

  it('applyWsEvent workspace-created adds workspace', () => {
    useAppStore.getState().applyWsEvent({ type: 'workspace-created', workspace: w1 });
    expect(useAppStore.getState().workspaces['w1']).toEqual(w1);
  });

  it('applyWsEvent agent-updated updates agent', () => {
    useAppStore.setState({ agents: { 's1:main': a1 } });
    useAppStore.getState().applyWsEvent({
      type: 'agent-updated',
      agent: { ...a1, state: 'thinking' },
    });
    expect(useAppStore.getState().agents['s1:main'].state).toBe('thinking');
  });
});
