# legal-research (reference extension)

> **This is a reference copy** — the live working copy ships with the
> new-suzielaw build at
> `apps/suziecode/apps/suziecode/builds/suzielaw-clone/extensions/legal-research/`.
> This copy exists in `docs/examples/` as a stable artifact SuzieCode
> users (and other agents) can read to understand the per-build
> extension pattern.

Per-build extension that adds multi-jurisdiction legal research tools to
the agent. **Tier 3** per [`../../COMPOSITION.md`](../../COMPOSITION.md) —
code that's specific to a single build, sitting on top of the upstream
agent-runtime menu.

## What it registers

Three tools, all stateless and session-agnostic:

| Tool | Purpose |
|---|---|
| `legal_search` | Search by jurisdiction + free-text query. Returns hits with `source_id` + `doc_id`. |
| `legal_get_document` | Fetch full text for a `source_id` + `doc_id` returned by `legal_search`. |
| `legal_find_in_document` | Keyword-filter the articles inside a long legislation document. Codes-only. |

The model is expected to chain them: `legal_search → legal_get_document
(→ optionally legal_find_in_document)`.

## Coverage

Jurisdictions covered by at least one provider (subject to API-key
availability — see Configuration below):

AR, AT, AU, BE, BR, CA, CH, COE (Council of Europe / ECtHR), DE, EU,
ES, FR, IE, IN, IT, JP, MX, NL, UK, US.

The exact list at boot is whittled down by which providers have credentials
configured. The tool description includes an auto-generated coverage line so
the model knows what it can search.

## Configuration

All optional. Providers without credentials either degrade gracefully
(US/CourtListener falls back to the public unauth tier) or drop out
silently (FR/Legifrance, FR/Judilibre, IN/IndianKanoon).

| Env var | Used by | Notes |
|---|---|---|
| `COURTLISTENER_TOKEN` | US case law | Optional. Without it, public rate-limited tier. |
| `COURTLISTENER_BASE_URL` | US case law | Override for testing. Default `https://www.courtlistener.com/api/rest/v3`. |
| `PISTE_CLIENT_ID` + `PISTE_CLIENT_SECRET` | FR legislation | Both required; otherwise FR legislation is not registered. |
| `JUDILIBRE_API_KEY` | FR case law | Without it, FR case law is not registered. |
| `INDIAN_KANOON_API_KEY` | IN | Without it, IN provider is not registered. |

Set these in the dev environment before `pnpm dev:redline` to enable the
gated providers.

## File layout

```
extensions/legal-research/
  index.ts                ← Extension default export (the entry point)
  legal-research-tools.ts ← buildLegalResearchTools + buildProviders
  types.ts                ← LegalProvider interface
  util.ts                 ← shared fetch helpers (fetchJson, stripHtml, …)
  providers/
    us-courtlistener.ts
    us-ecfr.ts
    fr-legifrance.ts
    …                     ← one per (jurisdiction × source)
```

To add a new jurisdiction or source:

1. Drop a provider into `providers/` implementing `LegalProvider` from
   `./types.ts`.
2. Import it at the top of `legal-research-tools.ts` and add it to the
   `providers` array in `buildProviders`.
3. Restart the dev server. The new provider's coverage is auto-included
   in the tool's description string the model sees.

## Why an extension and not upstream?

This is vertical-specific code (legal-domain only). The COMPOSITION model
keeps the upstream menu narrow to what every vertical can use, and pushes
domain-specific behavior to per-build extensions. If similar
research-style tools start showing up across non-legal verticals (medical
literature, regulatory filings, etc.), it'd be a candidate for promotion
into upstream as a generic "knowledge source" abstraction — but that's
Team Suzie's call, driven by repetition, not by any one build's request.

For the mechanism of how the runtime loads this extension, see
[`../../../packages/agent-runtime/EXTENSIONS.md`](../../../packages/agent-runtime/EXTENSIONS.md).
