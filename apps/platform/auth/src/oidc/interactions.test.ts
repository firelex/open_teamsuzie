import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type Provider from 'oidc-provider';
import { buildInteractionsRouter, type InteractionsOptions, type VerifyPassword } from './interactions.js';
import { AttemptLimiter } from '../security/attempt-limiter.js';

// A stand-in for oidc-provider: every interaction is a login prompt, and finishing one redirects.
function fakeProvider() {
  return {
    interactionDetails: vi.fn(async (req: express.Request) => ({
      uid: String(req.params.uid ?? req.path.split('/')[3]),
      prompt: { name: 'login' },
      params: {},
      session: {},
    })),
    interactionFinished: vi.fn(async (_req: express.Request, res: express.Response) => {
      res.redirect(303, '/done');
    }),
  };
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function start(verify: VerifyPassword, options?: InteractionsOptions) {
  const provider = fakeProvider();
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(buildInteractionsRouter(provider as unknown as Provider, verify, options));
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, provider };
}

function postLogin(base: string, uid: string, email: string, password: string) {
  return fetch(`${base}/oauth/interaction/${uid}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password }).toString(),
    redirect: 'manual',
  });
}

const verifyAlice: VerifyPassword = async (email, password) =>
  email === 'alice@example.com' && password === 'correct-password' ? { id: 'u-alice' } : null;

describe('sign-in page', () => {
  it('says accounts come from an administrator when registration is closed (the default)', async () => {
    const { base } = await start(verifyAlice);
    const html = await (await fetch(`${base}/oauth/interaction/abc`)).text();
    expect(html).toContain('Accounts are created by an administrator');
    expect(html).not.toContain('{{note}}');
  });

  it('shows no such note when registration is open', async () => {
    const { base } = await start(verifyAlice, { registration: 'open' });
    const html = await (await fetch(`${base}/oauth/interaction/abc`)).text();
    expect(html).not.toContain('Accounts are created by an administrator');
    expect(html).not.toContain('{{note}}');
  });

  it('escapes the interaction id it echoes back into the page', async () => {
    const { base } = await start(verifyAlice);
    const res = await postLogin(base, encodeURIComponent('"><img src=x onerror=alert(1)>'), 'x@example.com', 'wrong');
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('signs in with the right password and refuses a wrong one', async () => {
    const { base, provider } = await start(verifyAlice);
    expect((await postLogin(base, 'abc', 'alice@example.com', 'wrong')).status).toBe(401);
    const ok = await postLogin(base, 'abc', 'alice@example.com', 'correct-password');
    expect(ok.status).toBe(303);
    expect(provider.interactionFinished).toHaveBeenCalledTimes(1);
  });
});

describe('sign-in attempt limit', () => {
  it('refuses with 429 after too many wrong passwords for an account, without checking the password', async () => {
    const verify = vi.fn(verifyAlice);
    const limiter = new AttemptLimiter({ windowMs: 60_000, maxPerIp: 100, maxPerAccount: 3 });
    const { base, provider } = await start(verify, { limiter });
    for (let i = 0; i < 3; i++) expect((await postLogin(base, 'abc', 'alice@example.com', 'wrong')).status).toBe(401);

    const refused = await postLogin(base, 'abc', 'alice@example.com', 'correct-password');
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await refused.text()).toContain('Too many sign-in attempts');
    expect(verify).toHaveBeenCalledTimes(3);
    expect(provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('refuses with 429 after too many attempts from one address, across accounts', async () => {
    const limiter = new AttemptLimiter({ windowMs: 60_000, maxPerIp: 2, maxPerAccount: 100 });
    const { base } = await start(verifyAlice, { limiter });
    expect((await postLogin(base, 'abc', 'x@example.com', 'wrong')).status).toBe(401);
    expect((await postLogin(base, 'abc', 'y@example.com', 'wrong')).status).toBe(401);
    expect((await postLogin(base, 'abc', 'z@example.com', 'wrong')).status).toBe(429);
  });

  it('does not count successful sign-ins', async () => {
    const limiter = new AttemptLimiter({ windowMs: 60_000, maxPerIp: 2, maxPerAccount: 2 });
    const { base } = await start(verifyAlice, { limiter });
    for (let i = 0; i < 5; i++) {
      expect((await postLogin(base, 'abc', 'alice@example.com', 'correct-password')).status).toBe(303);
    }
  });
});
