// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { createCsrfMiddleware } from './csrf.js';

function run(method: string, cookie: string | undefined, header?: string) {
  const req = { method, path: '/x', headers: { cookie, ...(header ? { 'x-csrf-token': header } : {}) } } as unknown as Request;
  const out: { status?: number; setCookie?: string; next: boolean; session?: unknown } = { next: false };
  const res = {
    cookie: (_n: string, v: string) => {
      out.setCookie = v;
    },
    status: (c: number) => {
      out.status = c;
      return { json: () => undefined };
    },
  } as unknown as Response;
  createCsrfMiddleware({ cookieName: 't', storage: 'cookie' })(req, res, () => {
    out.next = true;
  });
  out.session = (req as unknown as { session?: unknown }).session;
  return out;
}

const TOKEN = 'a'.repeat(64);

describe("createCsrfMiddleware storage: 'cookie'", () => {
  it('issues a token cookie on a first GET without touching any session', () => {
    const out = run('GET', undefined);
    expect(out.next).toBe(true);
    expect(out.setCookie).toMatch(/^[0-9a-f]{64}$/);
    expect(out.session).toBeUndefined();
  });

  it('accepts an unsafe request whose header matches the cookie', () => {
    expect(run('POST', `t=${TOKEN}`, TOKEN).next).toBe(true);
  });

  it('refuses a missing or different header, and a request with no cookie', () => {
    expect(run('POST', `t=${TOKEN}`).status).toBe(403);
    expect(run('POST', `t=${TOKEN}`, 'b'.repeat(64)).status).toBe(403);
    expect(run('POST', undefined, TOKEN).status).toBe(403);
  });
});
