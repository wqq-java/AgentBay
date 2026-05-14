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
  // M2 加:CC 实际命令叫版本号(如 2.1.140),title 设成 ✳ ... 的真实情况
  it('detects CC from version-string command + non-empty title', () => {
    expect(inferTool({ command: '2.1.140', title: '✳ general-purpose' })).toBe('claude-code');
  });
  it('detects CC from title leading sparkle marker', () => {
    expect(inferTool({ command: 'node', title: '✻ Working...' })).toBe('claude-code');
  });
  it('does NOT mis-detect plain version-string command without title', () => {
    expect(inferTool({ command: '1.2.3', title: '' })).toBe('unknown');
  });
});
