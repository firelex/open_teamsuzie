# Extension model

Team Suzie is designed to be extended, not forked. This doc lists the seams you can hook into without modifying core packages.

> **v0.1 note:** some of these extension points are documented ahead of the code. Check the corresponding package's README for implementation status.

## 1. Skills

A skill is a directory with a `SKILL.md` (the instructions the agent reads when the skill is installed) and optional support files. To publish a skill:

1. Create a directory under `packages/skills/templates/<your-skill>`.
2. Write `SKILL.md`. It's plain Markdown with `{{variable}}` placeholders that the runtime fills at install time from agent-scoped config.
3. Add a `skill.json` manifest describing name, version, required config keys, and dependencies on other skills.

Skills do not execute code at install time; they only inject files. If your skill needs network access or side effects, those happen through the agent's tool surface at runtime, not through the skill installer.

**Out of scope:** pricing, entitlement checks, paid access. Those are hosted-product concerns; the OSS runtime treats all installable skills as equally available.

## 2. Approval dispatchers

The approval queue is generic: an agent proposes an action, a human approves, a dispatcher carries it out. To add a new action type:

1. Implement the `ApprovalDispatcher<T>` interface from `@teamsuzie/approvals`.
2. Register it by action type in your app's startup code.
3. The queue UI automatically surfaces any registered action type.

The ships-by-default email dispatcher (SendGrid) is a reference implementation.

## 3. LLM providers

Providers live in `apps/platform/llm-proxy/src/config.ts`. Each one is a `{ apiBase, apiKeyEnv }` entry in the `PROVIDERS` record, and the `resolveModel()` function routes an incoming model string to a provider — either via an explicit `provider/model-name` prefix or a heuristic branch on the bare model name.

To add a new OpenAI-compatible provider:

1. Add an entry to `PROVIDERS`:

   ```typescript
   export const PROVIDERS: Record<string, ProviderConfig> = {
     // …existing entries…
     myprovider: {
       apiBase: 'https://api.myprovider.example/v1',
       apiKeyEnv: 'MYPROVIDER_API_KEY',
     },
   };
   ```

2. Add a heuristic branch to `resolveModel()` so callers can pass bare model names:

   ```typescript
   if (lower.startsWith('myprovider-')) return { provider: 'myprovider', model };
   ```

3. Document `MYPROVIDER_API_KEY` in `.env.example`.

Callers can always bypass the heuristic by sending the explicit prefix form — e.g. `model: "myprovider/some-model"` — so the heuristic branch is a convenience, not a requirement.

Providers are assumed to speak the OpenAI Chat Completions wire format (`POST /chat/completions`, `POST /embeddings`, etc.). Non-OpenAI-compatible providers need a dedicated route handler; that's a larger change and out of scope for a simple provider addition.

Usage tracking is automatic — `completions.ts`, `responses.ts`, and `embeddings.ts` extract `usage` from the upstream response and publish it to Redis via `publishUsage()` regardless of which provider served the request.

## 4. Vector and graph backends

Both `apps/platform/vector-db` and `apps/platform/graph-db` wrap a concrete backend behind an HTTP API. To swap the backend:

1. Fork the corresponding app.
2. Replace the Milvus / Neo4j driver usage with your backend of choice.
3. Preserve the public HTTP contract (scope-aware search, insert, delete).

The db-client package doesn't care which backend you run — it only sees the HTTP API.

## 5. Auth providers

The `apps/platform/auth` service is session + email-based out of the box. For SSO, OAuth, or SAML:

1. Add a new route handler alongside the existing `/login` and `/signup`.
2. On successful external auth, create or find the user via the existing `UserService`.
3. Issue a session the same way the local-password flow does.

The cookie / CSRF layer is agnostic to how the user proved identity.

## What you cannot extend

- **Scope semantics.** `global / org / agent` is load-bearing across packages. Adding a new scope level is a breaking change, not a plugin.
- **Agent identity.** One agent = one org + one API key. Multi-org agents are a different data model.
- **The approval state machine.** States are deliberately few. If you need fine-grained workflow states, build them on top.

These are the axioms the rest of the system rests on. If you feel pressure to change them, that's usually a sign the feature belongs in a different system, not Team Suzie.
