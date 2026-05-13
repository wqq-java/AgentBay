import { describe, it, expect } from 'vitest';
import { inferTool } from './tmux.js';

describe('inferTool', () => {
  it('detects claude from command', () => {
    expect(inferTool({ command: 'claude', title: '' })).toBe('claude-code');
  });
  it('detects claude from title', () => {
    expect(inferTool({ command: 'node', title: 'Claude Code' })).toBe('claude-code');
  });
  it('detects codex', () => {
    expect(inferTool({ command: 'codex', title: '' })).toBe('codex');
  });
  it('returns unknown for unfamiliar pane', () => {
    expect(inferTool({ command: 'zsh', title: 'shell' })).toBe('unknown');
  });
  it('case insensitive', () => {
    expect(inferTool({ command: 'CLAUDE', title: '' })).toBe('claude-code');
  });
});
