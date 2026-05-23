# starter-external-agent-omnibus

The canonical seed used by SuzieCode and the base every other
manifest-driven starter is expected to mirror. `src/index.ts` is a
3-line `startAgent()` call; everything else (theme, nav modules,
personas, workflows, tools) is configured through `agent.json` and
sibling files (`personas/<id>/PERSONA.md`, `workflows.seed.json`).

To run locally:
```bash
pnpm --filter @teamsuzie/starter-external-agent-omnibus dev
```
