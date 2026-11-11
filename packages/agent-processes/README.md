# @teamsuzie/agent-processes

A tracked child-process registry and POSIX process-tree cleanup helpers for agent runtimes that spawn external CLIs.

Use it when a host spawns long-running or detached child processes (e.g. an agent CLI) and needs to guarantee they — and their descendants — are killed when the host shuts down, instead of being orphaned.

```ts
import { spawn } from 'node:child_process';
import { TrackedProcessRegistry } from '@teamsuzie/agent-processes';

const registry = new TrackedProcessRegistry(spawn);

const child = registry.spawn('some-agent-cli', ['--task', 'build'], {});

// ... later, on host shutdown:
registry.shutdownAll(); // SIGTERM the whole descendant tree of every tracked child
// or, if that doesn't finish in time:
registry.killAllHard(); // SIGKILL

registry.snapshot(); // [{ pid, command, ageMs }, ...]
registry.size();     // number of currently tracked children
```

## Main exports

- `TrackedProcessRegistry` — wraps a `spawn` function; `spawn(cmd, args, opts)` forces `detached: true` and tracks the resulting child. `shutdownAll()` / `killAllHard()` signal (`SIGTERM` / `SIGKILL`) every tracked child's process group (and its descendants). `snapshot()` returns `{ pid, command, ageMs }[]`; `size()` returns the live count. Options: `currentPid`, `now`, `listProcessRows`, `killProcessGroups`, `killPid` (all overridable, mainly for tests).
- `findWorkspaceProcessGroups(rows, workspaces, currentPid?)` — given process rows and a list of workspace directory paths, finds the process groups whose cwd or command line matches one of the workspaces (plus their descendants).
- `findDescendantProcessGroups(rows, rootPid, currentPid?)` — finds the process groups under a given root pid.
- `killProcessGroups(groups, signal)` — signals each group's pgid (`process.kill(-pgid, signal)`), falling back to signalling individual pids if the group kill fails. Returns the number of successful kills.
- `killWorkspaceProcessSubtrees(workspaces, signal)` — convenience wrapper: lists live processes, finds the matching groups, kills them. Returns `{ groups, killed }`.
- `listProcessRows()` — shells out to `ps` and `lsof` to build the current process table (`{ pid, ppid, pgid, command, cwd? }[]`).
- `parsePsRows(text)` / `parseLsofCwds(text)` — pure parsers for `ps -axo pid=,ppid=,pgid=,command=` and `lsof -nP -a -d cwd -Fnpc` output, exposed so callers/tests can feed in canned output instead of shelling out.
- `pathIsInsideWorkspace(pathname, workspace)` — path-prefix check used internally to match a process's cwd to a workspace root.

## Notable behaviour

- `TrackedProcessRegistry.spawn` always forces `detached: true` on the spawn options, overriding whatever the caller passed.
- Killing a tracked child tries, in order: process-group kill via the enumerated descendant tree, then `killPid(-pid, signal)` if the child was detached, then a direct `child.kill(signal)` — each step is best-effort and swallows errors so one failure doesn't block cleanup of the rest.
- Process-tree enumeration (`listProcessRows`) shells out to `ps` and `lsof` and is POSIX-specific; `lsof` failures are swallowed and cwd data is simply left empty.
- `findDescendantProcessGroups` returns groups with `workspace: ''` (it doesn't know about workspace paths) — only `findWorkspaceProcessGroups` populates a real workspace string.
