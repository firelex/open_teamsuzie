# Composition: JSON, upstream code, and extensions

This doc frames how a Team Suzie agent is composed: what kind of thing belongs
where, who owns each kind, and how SuzieCode reads a project. Read this
**before** deciding to add a new capability anywhere.

For the *mechanism* of writing an extension, see
[`packages/agent-runtime/EXTENSIONS.md`](../packages/agent-runtime/EXTENSIONS.md).
This doc is about *where things live*.

## The three tiers

```
┌────────────────────────────────────────────────────────────────┐
│ Tier 3 — Per-build extensions                                  │
│   Owner: user (via SuzieCode)                                  │
│   Where: apps/<build>/extensions/<name>/                       │
│   Form:  executable code (TypeScript)                          │
│   Lifetime: this build only                                    │
└────────────────────────────────────────────────────────────────┘
                              ▲
                              │ "I need X this build needs"
                              │
┌────────────────────────────────────────────────────────────────┐
│ Tier 2 — Upstream code                                         │
│   Owner: Team Suzie (us)                                       │
│   Where: open_teamsuzie/packages/*                             │
│   Form:  always-on infrastructure OR gated capability          │
│   Lifetime: every build, all the time (subject to module flag) │
└────────────────────────────────────────────────────────────────┘
                              ▲
                              │ "what menu items did the user pick?"
                              │
┌────────────────────────────────────────────────────────────────┐
│ Tier 1 — JSON config                                           │
│   Owner: user (declares); Team Suzie (decides what's possible) │
│   Where: apps/<build>/agent.json                               │
│   Form:  pure data, no executable behavior                     │
│   Lifetime: editable at runtime; hot-reloads                   │
└────────────────────────────────────────────────────────────────┘
```

**One-sentence model:** we curate the menu of upstream capabilities, users
pick from that menu via JSON, and when a build needs something off-menu, the
user (via SuzieCode) builds an extension *for that build only*.

There is **no per-vertical tier**. Reference apps like `suzielaw` are just
builds that happen to demonstrate good patterns; their custom code lives in
their own `extensions/`, not in some shared vertical layer. If a pattern is
common enough to deserve sharing, we promote it into upstream code (Tier 2)
where every vertical can opt into it via a module flag.

## What lives in each tier today

### Tier 1 — JSON (`agent.json`)

- **Identity**: `name`, `description`, `theme` (color tokens, fonts), `persona`
  (default), `personas` (variants).
- **Module toggles** (turn upstream features on/off): `modules.history`,
  `modules.personas`, `modules.library`, `modules.reviews`, `modules.redline`,
  `modules.drafting`, etc. Pure booleans. Each one corresponds to upstream
  code that lights up when set.
- **Prompts / workflows**: `prompts[]` — reusable instruction templates with
  practice-area tags, optionally rendered as Assistant homepage tiles.
- **Tool enable/disable**: `tools[]` with `enabled: boolean` — gates whether
  the model sees a given upstream tool in its tool list this build.
- **AI model selection**: `ai.simpleModel` for AI-fill helpers.
- **Reviews template seeds**: `reviews.templates[]` — content seeded into the
  reviews store on first boot.
- **Build provenance**: `source.{builder, builderVersion, builderRunId}`.

Anything declarative goes here. The runtime hot-reloads `agent.json` on
change, so most config can be edited live without a restart.

### Tier 2 — Upstream code (we ship, users toggle)

**Always-on** (every build gets these unconditionally):

- Chat route + SSE streaming (`/api/chat`) — when `opts.agent` is configured.
- File store + uploads + promote (`/api/files`, `/api/files/promote`).
- Document export endpoint (`/api/documents/:sessionId/:docId/export`) — the
  user-driven counterpart to the `export_to_docx` tool. Returns 503 when
  markitdown-agent isn't configured; never 404s the route itself.
- Manifest store + `/api/manifest` + hot-reload.
- Personas avatars (`/api/personas/avatars`).
- AI-draft kind registry (`/api/ai/draft`).
- Tool registry + module registry + extension loader.
- Per-turn tool merge (`buildPerTurnTools(sessionId)`) — lets module-gated
  tools that need a live sessionId close over it cleanly.
- React shell: `AppShell`, `SidePanelProvider`, `ConfirmDialogProvider`,
  routing, persona-bound chat handling.

**Gated by `modules.X`** (every build can opt into these via JSON):

| Module flag | What it lights up |
|---|---|
| `modules.history` | Persisted chats + `/api/chats` |
| `modules.personas` | Personas page + `/api/personas` |
| `modules.library` | Workflows page + `/api/workflows` |
| `modules.reviews` | Reviews module + `/api/reviews` + manifest template seeds |
| `modules.redline` | `propose_document_edits` tool + `<TrackedChangesPanel>` + `/api/files/.../redline-view` + `/api/files/.../revisions/resolve` |
| `modules.drafting` | `create_document` / `set_outline` / `write_section` / `revise_section` / `append_section` / `delete_section` / `export_to_docx` + live `<ArtifactPanel>` rendering |
| `modules.matters`, `modules.admin`, `modules.billing`, `modules.knowledgeBase` | Reserved — UI wired, server routes not yet implemented |

Users **cannot add to Tier 2 directly**. They can request features; we ship
upstream and gate behind a new `modules.X` flag.

### Tier 3 — Per-build extensions (users build, via SuzieCode)

Anything a build needs that isn't on our upstream menu. Examples:

- A domain-specific tool: legal research, jurisdiction-specific filings,
  industry-specific calculators, custom HTTP integrations.
- A custom module/page: a build-specific admin surface, a custom inbox.
- A custom AI-draft kind: a system-prompt generator for a build-specific
  AI-fill affordance.

**Lifetime model:** an extension lives in *its build's* `extensions/`
directory forever by default. If the same pattern shows up across many
builds and we (Team Suzie) decide it deserves a place on the menu, we
promote it into Tier 2 — but that's our decision, driven by repetition we
observe in the wild, not by the user's request to "make this reusable."
Users don't reach across builds to share extensions; they either copy them
manually or wait for us to upstream the pattern.

For the file layout, contract, mounting rules, and packaging notes, see
[`packages/agent-runtime/EXTENSIONS.md`](../packages/agent-runtime/EXTENSIONS.md).

## The decision rule

When you (or SuzieCode) are about to add a new capability to a build, apply
this test in order:

1. **Is it pure data?** (a name, a string, a boolean, a system-prompt body,
   a workflow template, a selection from an upstream enum.)
   → **Tier 1.** Add it to `agent.json`. If the upstream schema doesn't yet
   have a field for it, we (Team Suzie) extend the schema; you don't.

2. **Is it executable behavior every build will want, or a curated capability
   we (Team Suzie) maintain?**
   → **Tier 2.** Not user-extensible. File a request; we ship upstream and
   gate behind a `modules.X` flag.

3. **Is it executable behavior this specific build needs that isn't on our
   menu?**
   → **Tier 3.** Build an extension in `apps/<this-build>/extensions/<name>/`.

The order matters. If something looks like an extension at first, but it's
really "a small variation on an upstream capability," that's a signal the
upstream capability has the wrong shape — file a request rather than
working around it in an extension.

## How SuzieCode reads a project

When SuzieCode opens an existing build, it reads:

1. **`agent.json`** → the configured menu: identity, modules, prompts,
   personas, theme. Tells SuzieCode what upstream capabilities this build
   has lit up.

2. **`extensions/`** directory scan → the custom code this build owns. For
   each extension subdirectory, SuzieCode reads:
   - `README.md` (convention; one per extension) — human-readable summary
     of what this extension does and what it registers.
   - `index.{ts,js,mjs}` (the `Extension` export) — authoritative list of
     registered tools, modules, AI-draft kinds.

3. **Combined view** — SuzieCode now has a complete picture:
   *"This build is a `<vertical>` agent using upstream modules `{ X, Y, Z }`
   plus N custom extensions adding tools `{ a, b, c }` and modules
   `{ p, q }`."*

There is **no `manifest.extensions` block in `agent.json`**. Auto-discovery
keeps the JSON canonical (config) and the directory canonical (code); we
don't maintain a third surface that can drift from either. If you want to
know what extensions a build has, look in `extensions/`.

For SuzieCode's own implementation of this discovery, see
[`apps/suziecode/apps/suziecode/src/extensions.ts`](https://github.com/) —
`readExtensions(agentRoot)` returns one entry per extension directory with
its name, index file location, README presence flag, and the full README
body when present. It pairs with `readManifest(agentRoot)` in
`src/manifest.ts` to give the combined "configured menu + custom code"
view this section describes. SuzieCode deliberately does NOT
dynamic-import extension `index.ts` files at inspection time (side
effects, heavy deps); for that, use the agent-runtime's
`loadExtensions` which IS the runtime path.

## Reference: the new suzielaw

Suzielaw is being rebuilt as a reference build that demonstrates this
composition pattern. Its shape:

- **`agent.json`** — turns on `modules.redline`, `modules.drafting`, plus
  the usual `history`/`personas`/`library`. Seeds the legal-vertical
  personas, workflow prompts, and theme. All Tier 1.

- **`extensions/legal-research/`** — the multi-jurisdiction legal research
  stack, lifted out of the original suzielaw's main src tree into a
  Tier-3 extension. Acts as the **canonical example** of how to author a
  per-build extension; a stable reference copy is committed at
  [`docs/examples/extension-legal-research/`](examples/extension-legal-research/README.md)
  so SuzieCode users can read it without having to chase generated build
  artifacts.

- **Everything else** — chat, files, redline UI, drafting tools, document
  export endpoint, artifact panel, side panel, persona registry — all
  Tier 2, delivered by `@teamsuzie/agent-runtime` and friends.

When suzielaw's legal-research moves into `extensions/`, the JSON-vs-code
boundary becomes visible at a glance: open suzielaw, see `agent.json` for
the configured menu and `extensions/legal-research/` for the build-specific
code. Nothing else is hiding in main src.

## What this gets us

- **Upstream stays small and predictable.** Tier 2 is the menu we
  maintain; we don't accept "make this configurable for my build"
  requests, only "this capability would benefit every legal/medical/PE
  build."
- **Users can build arbitrarily complex agents without forking.**
  Tier 3 is the escape hatch; the runtime is designed to never need it
  to be opened, but always supports it cleanly.
- **SuzieCode reads any project cleanly.** Two surfaces: `agent.json`
  (config) + `extensions/` (code). No hidden state.
- **Reference apps are not a tier.** They're builds. Their value is
  demonstrating the pattern, not introducing a new layer.

## See also

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — top-level Team Suzie (scope model,
  substrate, the five pillars).
- [`EXTENSION_MODEL.md`](EXTENSION_MODEL.md) — extension points for named
  subsystems (skill sources, approval dispatchers, LLM providers, vector
  backends, auth providers). Different from per-build extensions.
- [`packages/agent-runtime/EXTENSIONS.md`](../packages/agent-runtime/EXTENSIONS.md)
  — the per-build extension mechanism (file layout, type contract,
  mounting, packaging).
