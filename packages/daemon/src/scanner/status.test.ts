import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStatus, transition, newHistory } from './status.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.join(__dirname, '__samples__');

function loadSample(name: string): string {
  return fs.readFileSync(path.join(SAMPLES, name), 'utf-8');
}

describe('detectStatus · 用真实 tmux 样本', () => {
  it('pane-3:waiting-approval(Press Ctrl-C again)', () => {
    const r = detectStatus(loadSample('pane-3.txt'));
    expect(r.status).toBe('waiting-approval');
  });

  it('pane-4:waiting-approval(buffer 里有 Press Ctrl-C,即使前面有 Twisting)', () => {
    // pane-4 buffer 里 active 标记(Twisting)在前,但末尾出现了 Press Ctrl-C,
    // 表示 CC 在等用户决定是否退出 → approval 应胜
    const r = detectStatus(loadSample('pane-4.txt'));
    expect(r.status).toBe('waiting-approval');
  });

  it('pane-5:waiting-approval(Press Ctrl-C again)', () => {
    const r = detectStatus(loadSample('pane-5.txt'));
    expect(r.status).toBe('waiting-approval');
  });

  it('pane-0:waiting-approval(Enter to select 菜单)', () => {
    const r = detectStatus(loadSample('pane-0.txt'));
    expect(r.status).toBe('waiting-approval');
  });

  it('pane-6:status bar 信息能解析出来', () => {
    const r = detectStatus(loadSample('pane-6.txt'));
    expect(r.meta).toBeTruthy();
    expect(r.meta?.contextPct).toBe(7);
    expect(r.meta?.usagePct).toBe(18);
    expect(r.meta?.usageResetsIn).toBe('3h 51m');
    expect(r.meta?.weeklyPct).toBe(70);
    expect(r.meta?.weeklyResetsIn).toBe('1d 13h');
  });
});

describe('detectStatus · 单元 case', () => {
  it('空字符串 → idle', () => {
    expect(detectStatus('').status).toBe('idle');
  });

  it('Worked for 35s → active', () => {
    expect(detectStatus('foo\n✻ Worked for 35s\nbar').status).toBe('active');
  });

  it('· Twisting… (running stop hooks…) → active', () => {
    expect(detectStatus('· Twisting… (running stop hooks… 0/5 · 6s · ↓ 95 tokens)').status).toBe('active');
  });

  it('Codex rate limit hint → rate-limited', () => {
    expect(detectStatus('rate limit reached at 9:00 PM').status).toBe('rate-limited');
  });

  it('Try again at … → rate-limited', () => {
    expect(detectStatus('You hit the rate limit. Try again at 3pm.').status).toBe('rate-limited');
  });

  it('CC permission prompt → waiting-approval', () => {
    expect(detectStatus('Do you want to proceed?').status).toBe('waiting-approval');
  });

  it('CC menu → waiting-approval', () => {
    expect(detectStatus('Enter to select · ↑/↓ to navigate · Esc to cancel').status).toBe('waiting-approval');
  });

  it('Resume hint(CC 已退出)→ idle', () => {
    expect(detectStatus('Resume this session with:\nclaude --resume abc').status).toBe('idle');
  });

  it('rate-limited 优先级高于 active', () => {
    const text = '✻ Working…\nrate limit reached, try again later';
    expect(detectStatus(text).status).toBe('rate-limited');
  });

  it('approval 优先级高于 active', () => {
    const text = '✻ Working…\nDo you want to proceed?';
    expect(detectStatus(text).status).toBe('waiting-approval');
  });
});

describe('transition · debounce + 迟滞', () => {
  it('idle → active 立即切', () => {
    const h = newHistory('idle');
    const r = transition(h, { status: 'active', meta: null });
    expect(r.emit?.status).toBe('active');
    expect(r.next.current).toBe('active');
  });

  it('active → idle 需要连续 2 tick(默认)', () => {
    let h = newHistory('active');
    let r = transition(h, { status: 'idle', meta: null });
    expect(r.emit).toBeNull();
    expect(r.next.current).toBe('active'); // 还没切
    h = r.next;
    r = transition(h, { status: 'idle', meta: null });
    expect(r.emit?.status).toBe('idle'); // 第二次确认 → 切
    expect(r.next.current).toBe('idle');
  });

  it('active → idle 中间又见 active,迟滞被打断', () => {
    let h = newHistory('active');
    let r = transition(h, { status: 'idle', meta: null });
    expect(r.emit).toBeNull();
    h = r.next;
    expect(h.pendingChange?.to).toBe('idle');
    // 又看到 active
    r = transition(h, { status: 'active', meta: null });
    expect(r.next.pendingChange).toBeNull();
    expect(r.next.current).toBe('active');
  });

  it('active → waiting-approval 立即切(高优先级)', () => {
    const h = newHistory('active');
    const r = transition(h, { status: 'waiting-approval', meta: null });
    expect(r.emit?.status).toBe('waiting-approval');
  });

  it('idle → rate-limited 立即切', () => {
    const h = newHistory('idle');
    const r = transition(h, { status: 'rate-limited', meta: { resetIn: '3h' } });
    expect(r.emit?.status).toBe('rate-limited');
    expect(r.emit?.meta?.resetIn).toBe('3h');
  });

  it('状态没变 → 不 emit', () => {
    const h = newHistory('idle');
    const r = transition(h, { status: 'idle', meta: null });
    expect(r.emit).toBeNull();
  });

  it('迟滞窗口可调', () => {
    let h = newHistory('active');
    for (let i = 0; i < 4; i++) {
      const r = transition(h, { status: 'idle', meta: null }, { activeToIdleTicks: 5 });
      h = r.next;
      expect(r.emit).toBeNull();
    }
    const final = transition(h, { status: 'idle', meta: null }, { activeToIdleTicks: 5 });
    expect(final.emit?.status).toBe('idle');
  });
});
