# @teamsuzie/hosted-demo

Reusable OAuth sign-in and per-account token-allowance helpers for a publicly hosted demo build of a Team Suzie vertical app — the pattern of "sign in with Google/Microsoft, get a metered token budget, get cut off when it's spent." Use it for a public demo deployment; a real multi-tenant/production deployment should use its own auth (e.g. `@teamsuzie/shared-auth`) instead.

```ts
import express from 'express';
import session from 'cookie-session';
import { openDb } from '@teamsuzie/db-sqlite';
import {
  HOSTED_DEMO_MIGRATIONS,
  TokenBudgetStore,
  TokenLimitExceededError,
  createTokenMeteredFetch,
  parseTokenLimit,
  buildOAuthProvidersFromEnv,
  createOAuthRouter,
  createCsrfMiddleware,
} from '@teamsuzie/hosted-demo';

const db = openDb({ path: './data/app.db', migrations: HOSTED_DEMO_MIGRATIONS });
const budget = new TokenBudgetStore(db, parseTokenLimit(process.env.DEMO_TOKEN_LIMIT, 200_000));

const app = express();
app.use(session({ keys: [process.env.SESSION_SECRET!] }));
app.use(createCsrfMiddleware());
app.use(
  '/api',
  createOAuthRouter({
    providers: buildOAuthProvidersFromEnv({ env: process.env, publicUrl: 'https://demo.example.com' }),
    budget,
    successRedirectPath: '/app',
  }),
);

// Meter a provider call against the signed-in user's remaining allowance.
const meteredFetch = createTokenMeteredFetch({
  budget,
  ownerEmail: 'user@example.com',
  source: 'chat',
  model: 'claude-sonnet-5',
  enabled: true,
  fallbackTokens: 500,
});

try {
  budget.assertCanSpend('user@example.com');
} catch (err) {
  if (err instanceof TokenLimitExceededError) {
    // show the demo's "allowance used" message
  }
}
```

Client-side (browser bundle only, from `@teamsuzie/hosted-demo/client`):

```ts
import { installCsrfFetch } from '@teamsuzie/hosted-demo/client';

const uninstall = installCsrfFetch(); // patches global fetch to add X-CSRF-Token
```

## Main exports

- `TokenBudgetStore` — `upsertAccount`, `getSummary`, `assertCanSpend` (throws `TokenLimitExceededError`), `recordUsage`.
- `createTokenMeteredFetch` — wraps `fetch` so a provider call's token usage (from the JSON body or an SSE stream's `usage`/`stream_options.include_usage`) is recorded against the account automatically, with a `fallbackTokens` charge if the provider never reports usage.
- `createOAuthRouter` — mounts `GET /auth/providers`, `GET /auth/:provider/start`, `GET /auth/:provider/callback` for Google/Microsoft OAuth; calls `budget.upsertAccount` and sets `session.user` on success, with an optional `onSignIn` hook to bridge into a richer user store.
- `buildOAuthProvidersFromEnv` — builds `OAuthProviderConfig[]` from `{PREFIX}GOOGLE_CLIENT_ID`/`_SECRET`/`_REDIRECT_URI` and `{PREFIX}MICROSOFT_CLIENT_ID`/`_SECRET`/`_TENANT`/`_REDIRECT_URI` env vars.
- `createCsrfMiddleware` — synchronizer-token CSRF middleware paired with `cookie-session`; mirrors the session's CSRF token to a non-HttpOnly cookie and requires it back as the `X-CSRF-Token` header on unsafe methods.
- `HOSTED_DEMO_MIGRATIONS` — the `hosted_demo_accounts` and `hosted_demo_token_usage` table migrations.
- From `@teamsuzie/hosted-demo/client`: `readCsrfToken`, `csrfFetch`, `installCsrfFetch` — browser-only helpers with no `node:*` imports, meant to be bundled into client code.

## Configuration

- `buildOAuthProvidersFromEnv({ env, publicUrl, prefix? })` reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT`, `MICROSOFT_REDIRECT_URI` (each optionally namespaced by `prefix`); a provider with no client id/secret is simply omitted from the list.
- `parseTokenLimit(value, fallback)` parses a token-limit env var (e.g. `DEMO_TOKEN_LIMIT`) into a non-negative integer, falling back when unset or invalid.
- `createCsrfMiddleware({ cookieName?, secure?, skipPaths? })` — `secure` defaults to `process.env.NODE_ENV === 'production'`.

## Notable behaviour

- `createOAuthRouter` and `createCsrfMiddleware` both require `req.session` to already be initialized (e.g. by `cookie-session`); they 500 with `session_not_initialized` otherwise.
- A `tokenLimit` of `0` means unlimited — `assertCanSpend` never throws and `tokensRemaining` reads as `Number.MAX_SAFE_INTEGER`.
- `recordUsage` calls `assertCanSpend` itself before writing, so usage can't push an account past its limit from inside the metering path.
- `installCsrfFetch`'s patched `fetch` and the exported `csrfFetch` are written to avoid infinite recursion with each other — don't call `globalThis.fetch` directly from code that also calls `csrfFetch` after installing.
