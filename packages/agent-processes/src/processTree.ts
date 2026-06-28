import { execFileSync } from 'node:child_process';
import { resolve, sep } from 'node:path';

export interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
  command: string;
  cwd?: string;
}

export interface WorkspaceProcessGroup {
  pgid: number;
  workspace: string;
  pids: number[];
}

export function parsePsRows(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      command: match[4] ?? '',
    });
  }
  return rows;
}

export function parseLsofCwds(text: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  let sawCwd = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1));
      sawCwd = false;
    } else if (line === 'fcwd') {
      sawCwd = true;
    } else if (line.startsWith('n') && pid !== null && sawCwd) {
      cwds.set(pid, line.slice(1));
      sawCwd = false;
    }
  }
  return cwds;
}

export function pathIsInsideWorkspace(pathname: string | undefined, workspace: string): boolean {
  if (!pathname) return false;
  const normalizedPath = resolve(pathname);
  const normalizedWorkspace = resolve(workspace);
  return normalizedPath === normalizedWorkspace || normalizedPath.startsWith(`${normalizedWorkspace}${sep}`);
}

function matchWorkspace(row: ProcessRow, workspaces: string[]): string | null {
  for (const workspace of workspaces) {
    if (pathIsInsideWorkspace(row.cwd, workspace)) return workspace;
    if (row.command.includes(workspace)) return workspace;
  }
  return null;
}

export function findWorkspaceProcessGroups(
  rows: ProcessRow[],
  workspaces: string[],
  currentPid = process.pid,
): WorkspaceProcessGroup[] {
  const normalizedWorkspaces = [...new Set(workspaces.map((w) => resolve(w)))];
  const byParent = new Map<number, ProcessRow[]>();
  const byPid = new Map<number, ProcessRow>();
  for (const row of rows) {
    byPid.set(row.pid, row);
    const children = byParent.get(row.ppid) ?? [];
    children.push(row);
    byParent.set(row.ppid, children);
  }
  const currentPgid = byPid.get(currentPid)?.pgid;

  const selected = new Map<number, { row: ProcessRow; workspace: string }>();
  const queue: Array<{ row: ProcessRow; workspace: string }> = [];

  for (const row of rows) {
    if (row.pid === currentPid) continue;
    const workspace = matchWorkspace(row, normalizedWorkspaces);
    if (!workspace) continue;
    selected.set(row.pid, { row, workspace });
    queue.push({ row, workspace });
  }

  while (queue.length > 0) {
    const { row, workspace } = queue.shift()!;
    for (const child of byParent.get(row.pid) ?? []) {
      if (child.pid === currentPid || selected.has(child.pid)) continue;
      selected.set(child.pid, { row: child, workspace });
      queue.push({ row: child, workspace });
    }
  }

  const groups = new Map<number, { workspace: string; pids: Set<number> }>();
  for (const { row, workspace } of selected.values()) {
    if (row.pgid <= 1) continue;
    if (currentPgid !== undefined && row.pgid === currentPgid) continue;
    const group = groups.get(row.pgid) ?? { workspace, pids: new Set<number>() };
    group.pids.add(row.pid);
    groups.set(row.pgid, group);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([pgid, group]) => ({
      pgid,
      workspace: group.workspace,
      pids: [...group.pids].sort((a, b) => a - b),
    }));
}

export function findDescendantProcessGroups(
  rows: ProcessRow[],
  rootPid: number,
  currentPid = process.pid,
): WorkspaceProcessGroup[] {
  const byParent = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const children = byParent.get(row.ppid) ?? [];
    children.push(row);
    byParent.set(row.ppid, children);
  }

  const selected = new Map<number, ProcessRow>();
  const queue = [rootPid];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const child of byParent.get(parent) ?? []) {
      if (child.pid === currentPid || selected.has(child.pid)) continue;
      selected.set(child.pid, child);
      queue.push(child.pid);
    }
  }

  const groups = new Map<number, Set<number>>();
  for (const row of selected.values()) {
    if (row.pgid <= 1) continue;
    const pids = groups.get(row.pgid) ?? new Set<number>();
    pids.add(row.pid);
    groups.set(row.pgid, pids);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([pgid, pids]) => ({
      pgid,
      workspace: '',
      pids: [...pids].sort((a, b) => a - b),
    }));
}

export function listProcessRows(): ProcessRow[] {
  const ps = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' });
  const rows = parsePsRows(ps);
  let cwds = new Map<number, string>();
  try {
    const user = process.env.USER;
    const args = user
      ? ['-nP', '-a', '-d', 'cwd', '-u', user, '-Fnpc']
      : ['-nP', '-a', '-d', 'cwd', '-Fnpc'];
    cwds = parseLsofCwds(execFileSync('lsof', args, { encoding: 'utf8' }));
  } catch {
    cwds = new Map();
  }
  return rows.map((row) => ({ ...row, cwd: cwds.get(row.pid) }));
}

export function killProcessGroups(groups: WorkspaceProcessGroup[], signal: NodeJS.Signals): number {
  let killed = 0;
  for (const group of groups) {
    try {
      process.kill(-group.pgid, signal);
      killed += 1;
      continue;
    } catch {
      // Fall through to individual pids; some descendants may have moved to
      // another process group or the shell may have already exited.
    }
    for (const pid of group.pids) {
      try {
        process.kill(pid, signal);
        killed += 1;
      } catch {
        // Best-effort cleanup; stale pids are harmless.
      }
    }
  }
  return killed;
}

export function killWorkspaceProcessSubtrees(
  workspaces: string[],
  signal: NodeJS.Signals,
): { groups: WorkspaceProcessGroup[]; killed: number } {
  const groups = findWorkspaceProcessGroups(listProcessRows(), workspaces);
  const killed = killProcessGroups(groups, signal);
  return { groups, killed };
}
