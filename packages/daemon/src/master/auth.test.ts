import { describe, it, expect, vi } from 'vitest';
import { masterAuth } from './auth.js';
import type { Request, Response } from 'express';

function mkReq(authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  return { header: (n: string) => headers[n.toLowerCase()] } as unknown as Request;
}

function mkRes() {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  (res.status as unknown as { mockReturnValue: (v: Response) => void }).mockReturnValue(res);
  return res;
}

describe('masterAuth', () => {
  const TOKEN = 'secret-token-xyz';
  const mw = masterAuth(TOKEN);

  it('rejects when no Authorization header', () => {
    const res = mkRes();
    const next = vi.fn();
    mw(mkReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects when not Bearer', () => {
    const res = mkRes();
    const next = vi.fn();
    mw(mkReq('Basic xyz'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects when wrong token', () => {
    const res = mkRes();
    const next = vi.fn();
    mw(mkReq('Bearer wrong'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('passes when token correct', () => {
    const res = mkRes();
    const next = vi.fn();
    mw(mkReq(`Bearer ${TOKEN}`), res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
