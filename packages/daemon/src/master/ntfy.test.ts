import { describe, it, expect, vi } from 'vitest';
import { pushNtfy } from './ntfy.js';
import { configSchema } from '../config/config.js';

describe('pushNtfy', () => {
  it('skips when ntfy disabled', async () => {
    const r = await pushNtfy({
      config: configSchema.parse({}),
      severity: 'warn',
      message: 'x',
    });
    expect(r.skipped).toBe(true);
  });

  it('skips when topicUrl missing', async () => {
    const cfg = configSchema.parse({ ntfy: { enabled: true } });
    const r = await pushNtfy({
      config: cfg, severity: 'info', message: 'x',
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/topicUrl not set/);
  });

  it('POSTs to topicUrl with severity headers', async () => {
    const cfg = configSchema.parse({ ntfy: { enabled: true, topicUrl: 'https://ntfy.sh/test-topic' } });
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['Priority']).toBe('5');
      expect(headers['Tags']).toMatch(/light/);
      expect(init?.body).toBe('blocker text');
      return new Response('ok', { status: 200 });
    });
    const r = await pushNtfy({
      config: cfg, severity: 'blocker', message: 'blocker text', fetchImpl: fetchImpl as typeof fetch,
    });
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('non-ASCII title sanitized', async () => {
    const cfg = configSchema.parse({ ntfy: { enabled: true, topicUrl: 'https://x' } });
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Title).not.toMatch(/[一-鿿]/);
      return new Response('ok', { status: 200 });
    });
    await pushNtfy({
      config: cfg, severity: 'info', message: 'x', title: 'AgentBay 通知',
      fetchImpl: fetchImpl as typeof fetch,
    });
  });

  it('returns ok=false when network fails', async () => {
    const cfg = configSchema.parse({ ntfy: { enabled: true, topicUrl: 'https://x' } });
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const r = await pushNtfy({
      config: cfg, severity: 'warn', message: 'x', fetchImpl: fetchImpl as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ECONNREFUSED/);
  });
});
