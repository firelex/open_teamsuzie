# admin

OSS admin control plane for the Team Suzie stack. **Port 3008** (backend) / **5175** (Vite dev).

This is the thicker successor to the original "chat-only" admin. It ships phase-by-phase — Phase 0 (this one) wires the foundations that every subsequent phase plugs into.

## What's live

**Phase 0 — foundations**

- Routed React shell: Overview, Chat, and placeholder pages for Skills / Approvals / Artifacts / Tokens / Config / Activity
- Session-based auth via `@teamsuzie/shared-auth` (login, logout, `/api/session`)
- Postgres + Redis backed by `SequelizeService` + `SessionService`
- Dev-only seed: admin + demo users shown on the login page
- The original OpenClaw chat proxy (HTTP + WebSocket streaming) lives under the **Chat** tab

**Phase 1 — agent registry**

- CRUD endpoints at `/api/agents` (session-auth, org-scoped)
- `/api/agent-profiles` lists seeded profile templates (Assistant, Researcher)
- Agents page: list, create, edit, delete with profile/runtime/behaviour form
- Chat proxy is DB-aware: active agents are unioned with `CHAT_AGENTS` env entries, with a `source=db|env` marker on each row

**Phase 2 — skills**

- `/api/skill-templates` (list + detail) discovers SKILL.md manifests under `packages/skills/templates/`
- Required context for each skill is derived from `{{TOKEN}}` placeholders in the manifest body
- Skills page: grid of installed skills with name, description, and required-context badges
- Agent edit: comma-separated skills input replaced with a checkbox picker sourced from `/api/skill-templates`
- Ships 5 skills: `file-access`, `hello-world`, `documents`, `presentations`, `spreadsheets`

**Phase 3 — approvals**

- `/api/approvals` surfaces a human-in-the-loop queue backed by `@teamsuzie/approvals` (in-memory store for v1)
- `GET /api/approvals?status=pending|approved|rejected|dispatched|failed` (list) + `GET /:id` (detail) + `POST /` (propose) + `POST /:id/review` + `GET /action-types`
- Approve flow auto-dispatches when a handler is registered for the item's `action_type`; otherwise the item stays in `approved` for manual follow-up (future phases will register specific dispatchers)
- Every propose + review writes an `AuditLog` row — actor, action_type, verdict, outcome — so the trail survives even though the queue itself is in-memory
- Approvals page: tab filter by status, DataTable with approve/reject actions on pending rows, click-row dialog showing payload / metadata / review / dispatch detail

**Phase 4 — artifacts**

- `/api/workspace/files` surfaces agent-written workspace files backed by `AgentWorkspaceFile`
- `GET /api/workspace/files` (list, `?agent_id=<uuid>` or `?agent_id=null` for unattached) + `GET /:id` (detail with content) + `POST /` (upsert — 201 on create, 200 on overwrite) + `DELETE /:id`
- Paths are validated: must be relative, no `..` traversal. `content_type` limited to `markdown | json | yaml | text`; unknown agent ids are rejected up-front with 404
- Artifacts page: filter by agent, DataTable with path / agent / content-type / size / created, row-click dialog with monospace content preview, Download (generates a browser Blob) and Delete
- **v1 scope note**: this phase handles text artifacts only. Binary outputs (pptx, xlsx, docx) need either a blob column on `AgentWorkspaceFile` or a separate object-storage service — tracked for a follow-on phase

**Phase 5 — tokens**

- `/api/agent-keys` issues named, scope-tagged bearer keys per agent (prefix `dtk_`, shown plaintext once on create, `last_used_at` tracked on use, revoke flips `is_active` + `revoked_at`)
- User access tokens (prefix `tsu_`) reuse shared-auth's existing `/api/auth/tokens` CRUD — no admin-specific route needed
- `requireSession` now accepts either a session cookie **or** a `tsu_` user bearer — laptop CLIs and mobile clients can hit the admin API directly
- `POST /api/approvals` accepts either a session **or** a `dtk_` agent bearer, so agents can propose approvals on their own key. Actor attribution flows through `getRequestActor` → logs and audit entries show `actor=agent:user_id` with `org_id` populated from the agent's org
- Every create and revoke writes an `AuditLog` row (`api_key.create` / `api_key.revoke`)
- Agent delete now cascades to its `AgentApiKey` + `AgentWorkspaceFile` rows — no more FK-constraint failures
- Tokens page: two sections (agent keys + user access tokens), create dialog with scope picker and expiry, one-time plaintext reveal with copy-to-clipboard, revoke with confirm

**Phase 6 — config**

- `/api/config/definitions` + `/api/config/values` (list) + `/api/config/values/:key` (get/put/delete) backed by `ConfigDefinition` / `ConfigValue`; values AES-256-GCM encrypted at rest with a secret derived from `CONFIG_SECRET` (falls back to `COOKIE_SECRET` in dev)
- Scope hierarchy: `agent` → `user` → `org` → `global` → definition `default_value`. Most-specific wins. Per-agent and per-org overrides fully supported by the API; UI edits the system (`global`) scope only in v1
- Secrets (`is_sensitive=true`) are never returned in plaintext over HTTP — lists/gets redact to `null`, UI renders `[REDACTED]` with "Replace" as the action
- Value-type coercion on `PUT`: numbers match `/^-?\d+(\.\d+)?$/`, booleans must be `"true"` or `"false"`, JSON is parsed, `validation_schema.enum`/`minLength`/`maxLength` respected
- Every `create` / `update` / `delete` writes an `AuditLog` row (`config.*`)
- `ChatProxyService` reads `chat.default_model` in-process (agent-scope → global → definition default → `"default"`) — proves the runtime-consumer path
- Ships four seeded definitions: `admin.title`, `chat.default_model`, `approvals.require_by_default`, `integrations.webhook_secret`
- Config page: category-grouped cards (platform / ai / service / infrastructure / oauth), per-row status badge (`default` / `system` / `agent`…), `requires-restart` flag, inline Edit or Replace (for secrets), Reset to revert to the definition's default

**Phase 7 — activity**

- `/api/activity` surfaces the cross-phase `audit_log` as a paginated event feed with `action_prefix` / `resource_type` / `actor_type` / `actor_id` / `since` / `until` filters and `limit`+`offset` pagination; each row is enriched with the actor's email (for user rows) or agent name (for agent rows)
- `/api/activity/recent-agents` returns the top-N agents by `last_active_at`
- `ChatProxyService` bumps `Agent.last_active_at` (fire-and-forget) on every DB-managed agent's chat turn, so "recently active" is a live signal without a separate telemetry channel
- Overview page grows two live cards: **Recent activity** (latest 8 audit events) and **Recently active agents** (top 5 by `last_active_at`)
- Activity page: preset filter tabs (All / Agents / Approvals / Tokens / Config), DataTable with time + actor + action + resource, row-click drawer with full `details` JSON
- **Scope note**: token counts and tool-call timelines aren't captured by admin today — that surface belongs to the llm-proxy's `usage_events` pipeline and will arrive as a follow-on integration

## Tests

Integration suite lives at `apps/platform/admin/src/__tests__/` — one file per phase, supertest against the real Express app and a throwaway Postgres schema. **52 tests, ~3 seconds.**

```bash
pnpm docker:up                          # postgres + redis
pnpm --filter @teamsuzie/admin test     # or: pnpm -r test
```

The harness (`src/__tests__/setup.ts`) auto-creates the `teamsuzie_test` database on first run, drops & recreates schema on each invocation, and routes Redis sessions under a process-scoped prefix so test runs don't trample each other. Override `TEST_POSTGRES_BASE_URI` / `TEST_POSTGRES_DB` / `TEST_REDIS_URI` if your local infra differs from the defaults.

## Run (local)

```bash
# From the repo root, bring up postgres + redis.
pnpm docker:up

# First time only.
cp apps/platform/admin/.env.example apps/platform/admin/.env

pnpm --filter @teamsuzie/admin dev
```

Then open <http://localhost:5175> and sign in with the demo credentials shown on the login page.

## Configuring chat agents

The Chat page reads from `CHAT_AGENTS` in `apps/platform/admin/.env`. Each agent needs `id`, `name`, and `baseUrl`; optional `apiKey` and `openclawAgentId`:

```bash
CHAT_AGENTS=[{"id":"suzie","name":"Suzie","baseUrl":"http://localhost:18789","apiKey":"your-token","openclawAgentId":"main"}]
```

Once Phase 1 lands, DB-managed agents will take precedence over this env fallback.

## Stack

- Express + `@teamsuzie/shared-auth` on the backend (Sequelize + Redis + session)
- React + Vite + `@teamsuzie/ui` (Tailwind) on the client
- WebSocket transport for chat streaming
