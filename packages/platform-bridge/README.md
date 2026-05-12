# @teamsuzie/platform-bridge

Integration helpers for connecting an open-source Team Suzie agent (e.g. `suzielaw`) to a closed-source Team Suzie platform ("the mothership") as a marketplace agent.

The platform owns: org/user identity, agent installation, inter-agent comms routing, admin UI, deployment of internal agents.

The reference app owns: its own users/sessions, its own LLM calls, its own tool registry, its own persistence.

This package is the trust bridge between the two.

## Three Pieces

### 1. Marketplace registration

Call once on startup. Idempotent — the platform upserts by slug.

```ts
import { registerWithPlatform } from '@teamsuzie/platform-bridge';

await registerWithPlatform(
  {
    platformUrl: process.env.SUZIELAW_PLATFORM_URL!,           // mothership base
    registrationToken: process.env.SUZIELAW_PLATFORM_REG_TOKEN, // optional
  },
  {
    slug: 'suzielaw',
    name: 'Suzie Law',
    description: 'Open-source AI legal assistant',
    base_url: config.publicUrl,                                 // your public URL
    health_endpoint: '/api/health',                             // defaults to /api/health
    chat_endpoint: '/api/chat',                                 // defaults to /api/chat
    webhook_endpoint: '/api/webhook/mothership',                // defaults to this
    capabilities: { tools: ['legal_research'], features: ['sse_streaming'] },
    version: '0.1.0',
  }
);
```

The registration POST hits `${platformUrl}/api/marketplace/register`. The platform then catalogs your agent and starts polling your `health_endpoint` every 60s.

### 2. Platform-token middleware

Mount **before** your normal `requireAuth`. When the mothership proxies a user's chat to you, it sends `X-Platform-Token` plus a `context` block in the request body. The middleware validates the token and synthesizes a session.

```ts
import { createPlatformRequestMiddleware } from '@teamsuzie/platform-bridge';

const validatePlatformRequest = createPlatformRequestMiddleware({
  platformToken: process.env.SUZIELAW_PLATFORM_TOKEN, // must match mothership's INTERNAL_SERVICE_KEY
});

app.post('/api/chat', validatePlatformRequest, requireAuth, handler);
```

If `X-Platform-Token` matches, `req.session = { user: { email, name, role } }` is populated from `req.body.context.user_email` etc., so your `requireAuth` lets the request through.

If the header is missing or wrong, the middleware is a no-op — your normal cookie auth runs as usual.

### 3. Webhook router

Mount on a single path (default convention: `/api/webhook/mothership`). The router handles install/uninstall/dm/ping events and dispatches them to your handlers. **Requires** `X-Platform-Token` — wrong/missing → 401.

```ts
import { createWebhookRouter } from '@teamsuzie/platform-bridge';

app.use('/api/webhook/mothership', createWebhookRouter(
  { platformToken: process.env.SUZIELAW_PLATFORM_TOKEN },
  {
    onInstall: async (ctx) => {
      // ctx: { platform_api_key, platform_base_url, org_id, agent_id }
      // Persist platform_api_key per org if you want to call platform tools later.
    },
    onUninstall: async (ctx) => {
      // ctx: { org_id, agent_id }
    },
    onDirectMessage: async (ctx) => {
      // ctx: { from_agent: { id, name }, message, context? }
      // ctx.context.transcript is set when the call is a video-conference turn.
      const response = await runYourAgentLoop(ctx.message);
      return { response };
    },
  },
));
```

`ping` is handled automatically (returns 200 OK) — no handler needed.

## Trust Model

| Direction | Auth |
|-----------|------|
| Reference app → platform (registration) | `X-Registration-Token` header (optional but recorded) |
| Platform → reference app (chat proxy) | `X-Platform-Token` header → virtual session |
| Platform → reference app (webhooks) | `X-Platform-Token` header → required guard |
| End user → reference app | Reference app's own auth (cookies, OAuth, etc.) |

`platformToken` MUST equal the platform's `INTERNAL_SERVICE_KEY`. Anyone holding that token can act as the platform — keep it secret.

## What This Package Does NOT Do

- It does **not** wrap the platform's tool APIs. If you want your agent to call back into platform services (email queue, vector-db, etc.), build that on top of the `platform_api_key` + `platform_base_url` you receive in `onInstall`.
- It does **not** manage your agent's persistence, model selection, or tool registry. Those stay in your reference app.
- It does **not** bridge the platform's Matrix transport. End-user chat from the Flutter mobile app is handled by a separate handoff URL pattern (TBD).

## Reference Implementation

See `suzielaw/apps/suzielaw/src/index.ts` in the [suzielaw repo](https://github.com/teamsuzie/suzielaw) — search for `platformBridgeConfig`, `runInterAgentTurn`, and `registerWithPlatform`.
