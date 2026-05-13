import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Sidebar } from './Sidebar.js';
import { useAppStore } from '../store/state.js';
import type { Agent, Group } from '@agent-bay/shared';

function mkAgent(id: string, name: string, opts: Partial<Agent> = {}): Agent {
  return {
    id, name, role: null, tmuxTarget: id, pid: 1, tool: 'claude-code',
    status: 'online', statusMeta: null, groupId: null,
    lastSeenAt: Date.now(), createdAt: Date.now(), ...opts,
  };
}
function mkGroup(id: string, name: string): Group {
  return { id, name, description: null, isDm: false, createdAt: Date.now() };
}

describe('Sidebar', () => {
  beforeEach(() => {
    useAppStore.setState({
      agents: {}, groups: {}, topics: {}, messagesByTopic: {},
      connected: false, selectedAgentId: null, selectedGroupId: null, selectedTopicId: null,
    });
  });

  it('renders empty state', () => {
    const { container } = render(<Sidebar />);
    expect(container.textContent).toContain('AgentBay');
    expect(container.textContent).toMatch(/暂无 group/);
  });

  it('renders groups with agents', () => {
    useAppStore.setState({
      agents: {
        '%0': mkAgent('%0', 'alice', { groupId: 'g1' }),
        '%1': mkAgent('%1', 'bob', { groupId: 'g1' }),
        '%2': mkAgent('%2', 'charlie'), // ungrouped
      },
      groups: { g1: mkGroup('g1', 'team-a') },
    });
    const { container } = render(<Sidebar />);
    expect(container.textContent).toContain('team-a');
    expect(container.textContent).toContain('alice');
    expect(container.textContent).toContain('bob');
    expect(container.textContent).toContain('charlie');
    expect(container.textContent).toContain('未分配');
  });

  it('excludes gone agents', () => {
    useAppStore.setState({
      agents: { '%0': mkAgent('%0', 'dead', { status: 'gone' }) },
    });
    const { container } = render(<Sidebar />);
    expect(container.textContent).not.toContain('dead');
  });
});
