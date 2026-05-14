import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './state.js';
import type { Agent, Group, Topic, Message } from '@agent-bay/shared';

const a1: Agent = {
  id: '%0', name: 'alice', role: null, tmuxTarget: '%0', pid: 1,
  tool: 'claude-code', status: 'online', statusMeta: null, groupId: null,
  lastSeenAt: 1, createdAt: 1, isSpawned: false,
};
const g1: Group = { id: 'g1', name: 'team', description: null, isDm: false, createdAt: 1 };
const t1: Topic = { id: 't1', groupId: 'g1', title: 'plan', state: 'open', resolvedAt: null, createdAt: 1, createdBy: null };

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      agents: {}, groups: {}, topics: {}, messagesByTopic: {},
      connected: false, selectedAgentId: null, selectedGroupId: null, selectedTopicId: null,
    });
  });

  it('applySnapshot replaces all', () => {
    useAppStore.getState().applySnapshot({ agents: [a1], groups: [g1], topics: [t1] });
    const s = useAppStore.getState();
    expect(s.agents['%0']).toEqual(a1);
    expect(s.groups['g1']).toEqual(g1);
    expect(s.topics['t1']).toEqual(t1);
  });

  it('applyEvent agent-created', () => {
    useAppStore.getState().applyEvent({ type: 'agent-created', agent: a1 });
    expect(useAppStore.getState().agents['%0']).toEqual(a1);
  });

  it('applyEvent agent-gone marks status', () => {
    useAppStore.setState({ agents: { '%0': a1 } });
    useAppStore.getState().applyEvent({ type: 'agent-gone', agentId: '%0' });
    expect(useAppStore.getState().agents['%0'].status).toBe('gone');
  });

  it('applyEvent message-created appends to topic stream', () => {
    const m1: Message = { id: 1, topicId: 't1', fromAgentId: '%0', body: 'hi', imagePath: null, ts: 1, kind: 'text' };
    const m2: Message = { id: 2, topicId: 't1', fromAgentId: '%0', body: 'hi2', imagePath: null, ts: 2, kind: 'text' };
    useAppStore.getState().applyEvent({ type: 'message-created', message: m1 });
    useAppStore.getState().applyEvent({ type: 'message-created', message: m2 });
    expect(useAppStore.getState().messagesByTopic['t1']).toEqual([m1, m2]);
  });

  it('selectGroup also clears selectedTopic', () => {
    useAppStore.setState({ selectedTopicId: 't1' });
    useAppStore.getState().selectGroup('g2');
    expect(useAppStore.getState().selectedTopicId).toBeNull();
    expect(useAppStore.getState().selectedGroupId).toBe('g2');
  });
});
