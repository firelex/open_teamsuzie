# Parity gaps: suzielaw → upstream-based "new suzielaw"

Snapshot inventory of what the original `apps/suzielaw/` app has that
the upstream-based clone (`apps/suziecode/.../builds/suzielaw-clone/`)
does not — taken after the redline + drafting + extension work landed.

Lives here (not under suziecode) because the gaps that matter are
upstream-shaped: Tier-2 capabilities we'd ship for every vertical, not
per-build user code. Tier-3 (extensions) and hosted-only items are
called out below but aren't action items in this list.

## Sidebar / nav items

| Suzielaw nav | New suzielaw | Status |
|---|---|---|
| Assistant | wired | ✓ |
| **Matters** | reserved (`modules.matters` exists, not wired) | **gap** |
| Library | wired (+ paginated) | ✓ |
| Personas | wired (+ paginated) | ✓ |
| **Knowledge Base** | reserved (`modules.knowledgeBase`, not wired) | **gap** |
| History | wired (+ paginated) | ✓ |
| **Admin** | reserved (`modules.admin`, not wired) | **gap** |
| Settings | wired | ✓ |
| **Billing** (footer) | reserved (`modules.billing`, not wired) | **gap — hosted-only**, per `ARCHITECTURE.md` |
| Login | dev-bypass (`AGENT_DEV_AUTH=true`) | **gap — hosted-only**, OSS ships auth interfaces only |

## Tools

| Suzielaw tool | Where it lives | New suzielaw status |
|---|---|---|
| `propose_document_edits` | `apps/suzielaw/src/tools/propose-edits.ts` | ✓ ported as upstream `buildProposeDocumentEditsTool` (gated by `modules.redline`) |
| `legal_search` / `legal_get_document` / `legal_find_in_document` | `apps/suzielaw/src/tools/legal-research/` | ✓ lifted as Tier-3 extension in the new suzielaw |
| `convert_to_markdown` + the markdown drafting suite (`create_document`, `set_outline`, `write_section`, `revise_section`, `append_section`, `delete_section`, `export_to_docx`) | `apps/suzielaw/src/document-tools.ts` + `@teamsuzie/markdown-document` | ✓ ported as upstream `buildDocumentTools` (gated by `modules.drafting`) |
| `compare_documents` / diff | `tools/diff.ts` + `diff-engine.ts` | ✓ ported as upstream `buildCompareDocumentsTool` + `runDocumentDiff` helper; in the `buildDocumentTools` bundle alongside `find_in_document` |
| `find_in_document` | `tools/find-in-document.ts` | ✓ ported as upstream `buildFindInDocumentTool`. Complements (does not replace) `search_document` — `find_in_document` reads DOCX directly without requiring conversion first, and its paragraph indices match the redline-view. |
| `generate_docx` (structured) | `tools/generate-docx.ts` | ✓ ported as upstream `buildGenerateDocxFromSpecTool` (registers as `generate_docx`); gated by `modules.drafting`. Pre-existing disk-writing tool in `@teamsuzie/document-conversion` renamed to `render_markdown_to_docx` to avoid name collision. |
| **`replicate_document`** | `tools/replicate-document.ts` | **gap** — clone an existing uploaded doc as a new editable draft. Small. Tier-3 extension candidate or upstream. |
| **`templates`** | `tools/templates.ts` | **gap** — load a template-based draft. Overlaps with the manifest `prompts[]` surface; may not deserve its own tool. |
| **Playbooks (stored ruleset)** | scattered through suzielaw | **gap** — explicitly out-of-scope. Would let `propose_document_edits` bias edits per playbook (e.g. "buyer NDA standard"). Tier-3 extension candidate, possibly upstream later if every vertical wants the same shape. |

## Server infrastructure / endpoints

| Suzielaw module | New suzielaw status |
|---|---|
| `chat-title.ts` (auto-titling) | ✓ already in upstream `chat-route` — first-line auto-title runs after each turn |
| `redline-export.ts` (special original-vs-redlined DOCX) | ✓ functionally covered by `/api/files/.../revisions/resolve` + the redline router |
| `auth.ts` (real login/signup/session) | **gap — hosted-only**. OSS exposes the interfaces; bring your own OAuth/SSO. |
| `cloud-providers.ts` (BYOK provider config UI) | **gap** — generic enough to be upstream as a settings surface. |
| `kb.ts` (Knowledge Base server) | **gap** — vector substrate already exists in OSS (`apps/platform/vector-db`); just not wired into `agent-runtime` yet. |
| `reviews-export.ts` (CSV/PDF/DOCX export of review tables) | **gap** — lands alongside `modules.reviews` when that surface matures. |
| `sharing.ts` (public chat links) | **gap — hosted-leaning**. Needs durable storage + auth to be safe in prod. |
| `workflow-overrides.ts` (per-workflow tool list overrides) | **gap** — clever pattern: lets a workflow inject extra tools or swap which export tool the model uses. Generalizable upstream. |

## Reading the gaps by layer (per `COMPOSITION.md`)

### Tier 2 (upstream) — things we'd ship for every vertical

In priority order:

1. **Matters** — module + matter-scoped file buckets + matter-bound chat. Every legal/PE/medical vertical wants a multi-document case/deal/project container. Probably the highest-leverage remaining port.
2. ~~`compare_documents` / diff~~ — ✓ done.
3. ~~`generate_docx` (structured)~~ — ✓ done.
4. ~~`find_in_document` audit~~ — ✓ done; ported because upstream `search_document` doesn't cover DOCX-direct or paragraph-index alignment with the redline-view.
5. **Knowledge Base** — wire `apps/platform/vector-db` into `agent-runtime` behind `modules.knowledgeBase`. Bigger because of the vector substrate dependency.
6. **`workflow-overrides`** — per-workflow tool overrides. Generalizable as a `manifest.workflows[].tools?` shape.
7. **`reviews-export`** — natural extension of `modules.reviews`.
8. **`cloud-providers` / BYOK settings** — small UI + endpoint.
9. **Admin** — generic admin page; lower urgency since the build owner is usually the only admin.

### Tier 3 (per-build extensions) — users build via SuzieCode

- **Playbooks-as-stored-ruleset** — vertical-specific; legal builds will want one shape, medical another. The legal-research extension is the closest existing exemplar.
- **`replicate_document`** — small enough to be either upstream or extension. Default to extension until repetition justifies promotion.
- **`templates`** — likely overlaps too much with `manifest.prompts` to deserve a separate tool; revisit only if a real divergence appears.

### Hosted-only / out of OSS scope (per `ARCHITECTURE.md`)

- **Real auth flow** (`apps/suzielaw/src/auth.ts`)
- **Billing surface** (`pages/billing.tsx`, `pages/billing-return.tsx`)
- **Sharing with public links** (`apps/suzielaw/src/sharing.ts`)

OSS ships interfaces and dev-bypass; production auth/billing/sharing lives in the commercial product.

## Suggested next move

Closing the **Tier-2 priority gaps 1–4** in that order yields a new suzielaw that's at functional parity with the original on the layer that actually matters (the legal-vertical capability surface). Knowledge Base (#5) is naturally a follow-on once the doc-handling surface is complete. Everything below #5 is incremental polish or hosted-product concerns.

See also:
- [`COMPOSITION.md`](COMPOSITION.md) — why we put things in Tier 1 / 2 / 3.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — what's explicitly hosted vs OSS.
- [`packages/agent-runtime/EXTENSIONS.md`](../packages/agent-runtime/EXTENSIONS.md) — how a Tier-3 extension is authored.
