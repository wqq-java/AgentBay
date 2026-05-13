import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar.js';
import { useAppStore } from '../store/state.js';
import type { Workspace, Session, Agent } from '@agent-bay/shared';

describe('Sidebar', () => {
  beforeEach(() => {
    useAppStore.setState({ workspaces: {}, sessions: {}, agents: {}, connected: false });
  });

  it('renders empty state when no workspaces', () => {
    render(<Sidebar />);
    expect(screen.getByText(/没有发现 workspace/)).toBeTruthy();
  });

  it('renders workspaces with their sessions and agents', () => {
    const ws: Workspace = { id: 'w1', cwd: '/foo/bar', label: 'bar', createdAt: 1 };
    const s: Session = { id: 's1-long-uuid-foo', workspaceId: 'w1', mode: 'observed', pid: null, state: 'running', jsonlPath: '/x', jsonlOffset: 0, startedAt: 2, endedAt: null };
    const a: Agent = { id: 's1-long-uuid-foo:main', sessionId: 's1-long-uuid-foo', name: 'main', role: null, state: 'idle', tokenCount: 0, contextPct: 0, lastActivityAt: null };

    useAppStore.setState({
      workspaces: { w1: ws },
      sessions: { 's1-long-uuid-foo': s },
      agents: { 's1-long-uuid-foo:main': a },
    });

    const { container } = render(<Sidebar />);
    expect(container.textContent).toContain('bar');
    expect(container.textContent).toContain('main');
  });

  it('shows Observed badge for observed sessions', () => {
    const ws: Workspace = { id: 'w1', cwd: '/x', label: 'x', createdAt: 1 };
    const s: Session = { id: 's1', workspaceId: 'w1', mode: 'observed', pid: null, state: 'running', jsonlPath: '/x', jsonlOffset: 0, startedAt: 2, endedAt: null };
    useAppStore.setState({ workspaces: { w1: ws }, sessions: { s1: s } });
    render(<Sidebar />);
    // badge 文字精确匹配,不被父元素冒泡污染
    const badges = screen.getAllByText('Observed');
    expect(badges.some(el => el.className.includes('badge-observed'))).toBe(true);
  });
});
