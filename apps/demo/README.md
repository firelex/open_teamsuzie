# demo

A minimal example agent wired through the full Team Suzie stack. Think of it as the "hello world" that proves the five pillars work end-to-end.

## What it demonstrates

1. **Auth**: connects to the `auth` service with an agent API key.
2. **LLM proxy**: all model calls route through `llm-proxy` (tokens get counted per-agent).
3. **Scoped knowledge**: queries `vector-db` and `graph-db` with the agent's scope hierarchy.
4. **Skill runtime**: boots with a couple of skills installed into its workspace.
5. **Approval queue**: proposes a draft action that a human approves in the admin UI before it dispatches.

This is **not** a production agent. It's a didactic harness — single file, single prompt loop, heavily commented. You should feel comfortable reading it in ten minutes.

## Run

```bash
cd apps/demo
cp .env.example .env
# paste AGENT_API_KEY from the admin UI into .env
pnpm dev
```

Then open the admin UI at `http://localhost:3008` and watch the agent's actions show up in the approval queue.

## Using your own runtime

The demo uses a stub runtime to keep dependencies light. To replace it with OpenClaw (the first-class integration) or your own loop, swap out `src/runtime.ts` — the Team Suzie packages (`@teamsuzie/db-client`, `@teamsuzie/config-client`, `@teamsuzie/approvals`) are runtime-agnostic by design. Adapters for LangGraph, CrewAI, and other runtimes are planned but not yet validated.

## Status

v0.1 — scaffolded, implementation lands in v0.2.
