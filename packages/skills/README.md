# @teamsuzie/skills

The skill runtime — discovery, install, template injection, and workspace sync.

## The model

A **skill** is a named, versioned, installable capability. It ships as a directory:

```
my-skill/
  skill.json          # manifest: name, version, required config, dependencies
  SKILL.md            # instructions the agent reads when the skill is installed
  examples/           # (optional) example inputs and outputs
  prompts/            # (optional) templated prompt fragments
```

Installing a skill copies this directory into an agent's **workspace** — a filesystem view the agent reads at boot. The `SKILL.md` is rendered with `{{variable}}` substitutions from agent-scoped config.

No code executes at install time. Installation is purely file sync + template render. Side effects happen through the agent's tool surface at runtime, not through this package.

## API surface

```typescript
const registry = new SkillRegistry({ skillsDir: '/path/to/skills' });

registry.listSkills();                       // SkillInfo[] — discovery
registry.getSkill(skillName);                // raw SKILL.md text, or null
registry.renderSkill(skillName, context);    // interpolated SkillFile, or null
registry.applySkills(subjectId, context, target, skillNames?);
```

The runtime is **headless** — it does not know where skills end up. That's what the
`SkillTarget` interface is for:

```typescript
interface SkillTarget {
  apply(subjectId: string, files: SkillFile[]): Promise<void>;
  remove?(subjectId: string, filePaths: string[]): Promise<void>;
}
```

Two implementations:
- `FilesystemSkillTarget` — ships in this package; writes rendered files to disk.
- Database-backed target — belongs in whatever app owns the agent model (e.g. the
  hosted admin app upserts into `AgentWorkspaceFile`). Not in this package.

## Extension

- **Authoring a skill:** create a directory under `packages/skills/templates/<your-skill>`
  with a `SKILL.md`. Frontmatter fields: `name`, `description`. Body is whatever
  instructions the agent should read. Reference caller-provided placeholders with
  `{{KEY_NAME}}` syntax.
- **Custom target:** implement `SkillTarget` and pass it to `applySkills()`.
- **Loading skills from multiple sources:** instantiate multiple `SkillRegistry`s with
  different `skillsDir` roots and merge their output in your application.

## Out of scope

- **Entitlements and pricing.** The OSS runtime does not decide whether an agent is *allowed* to install a given skill. That's a commercial concern and sits in a separate hosted service.
- **Runtime sandboxing.** Skills are plain data. If a skill's instructions tell an agent to call an external API, that call happens through the agent's tool layer, which has its own auth and guardrails.

## Status

v0.1 — **runnable.** Headless skill discovery, rendering, and filesystem delivery are
in and tested. Ships with one reference skill (`hello-world`) in `templates/`.

First-party skills that target real services (email & calendar, inter-agent messaging,
token usage, etc.) depend on `apps/admin` being extracted first — tracked in the
roadmap under v0.3.
