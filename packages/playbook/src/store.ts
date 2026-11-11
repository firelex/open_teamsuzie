import { jsonColumn, prepareCached, type DatabaseInstance, type Migration } from '@teamsuzie/db-sqlite';
import { randomUUID } from 'node:crypto';
import type { PlaybookRule, RuleFinding } from './rules.js';

export const PLAYBOOK_MIGRATIONS: Migration[] = [
  {
    name: '20261111_create_playbooks',
    up: `
      CREATE TABLE IF NOT EXISTS playbooks (
        id            TEXT PRIMARY KEY,
        owner_id      TEXT NOT NULL,
        name          TEXT NOT NULL,
        description   TEXT NOT NULL DEFAULT '',
        contract_type TEXT NOT NULL DEFAULT '',
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_playbooks_owner ON playbooks(owner_id);
      CREATE TABLE IF NOT EXISTS playbook_rules (
        id            TEXT PRIMARY KEY,
        playbook_id   TEXT NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
        position      INTEGER NOT NULL,
        title         TEXT NOT NULL,
        standard      TEXT NOT NULL,
        fallback      TEXT,
        unacceptable  TEXT,
        guidance      TEXT,
        sample_clause TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_playbook_rules_playbook ON playbook_rules(playbook_id, position);
      CREATE TABLE IF NOT EXISTS playbook_runs (
        id             TEXT PRIMARY KEY,
        playbook_id    TEXT NOT NULL,
        playbook_name  TEXT NOT NULL,
        owner_id       TEXT NOT NULL,
        workspace_id   TEXT NOT NULL,
        document_id    TEXT NOT NULL,
        document_name  TEXT NOT NULL,
        status         TEXT NOT NULL,
        findings       TEXT,
        redline_doc_id TEXT,
        error          TEXT,
        created_at     INTEGER NOT NULL,
        finished_at    INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_playbook_runs_workspace ON playbook_runs(workspace_id, created_at DESC);
    `,
  },
];

export interface RulePlaybook {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  contractType: string;
  rules: PlaybookRule[];
  createdAt: number;
  updatedAt: number;
}

export interface RulePlaybookSummary extends Omit<RulePlaybook, 'rules'> {
  ruleCount: number;
}

export interface RulePlaybookInput {
  name: string;
  description?: string;
  contractType?: string;
  rules: Array<Omit<PlaybookRule, 'id'> & { id?: string }>;
}

export type PlaybookRunStatus = 'running' | 'succeeded' | 'failed';

export interface PlaybookRun {
  id: string;
  playbookId: string;
  playbookName: string;
  ownerId: string;
  workspaceId: string;
  documentId: string;
  documentName: string;
  status: PlaybookRunStatus;
  findings: RuleFinding[] | null;
  /** File id of the tracked-changes DOCX produced from the findings' edits. */
  redlineDocId: string | null;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
}

interface PlaybookRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  contract_type: string;
  created_at: number;
  updated_at: number;
}

interface RuleRow {
  id: string;
  title: string;
  standard: string;
  fallback: string | null;
  unacceptable: string | null;
  guidance: string | null;
  sample_clause: string | null;
}

interface RunRow {
  id: string;
  playbook_id: string;
  playbook_name: string;
  owner_id: string;
  workspace_id: string;
  document_id: string;
  document_name: string;
  status: PlaybookRunStatus;
  findings: string | null;
  redline_doc_id: string | null;
  error: string | null;
  created_at: number;
  finished_at: number | null;
}

function validateInput(input: RulePlaybookInput): void {
  if (!input.name.trim()) throw new Error('playbook name is required');
  input.rules.forEach((r, i) => {
    if (!r.title?.trim()) throw new Error(`rule ${i + 1}: title is required`);
    if (!r.standard?.trim()) throw new Error(`rule ${i + 1} ("${r.title}"): standard position is required`);
  });
}

const blank = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

/**
 * Owner-scoped playbooks (with ordered rules) and the history of runs
 * against documents. Ownership is enforced by the caller passing
 * `ownerId`; runs are listed per workspace (matter).
 */
export class PlaybookStore {
  private readonly now: () => number;

  constructor(private readonly opts: { db: DatabaseInstance; now?: () => number }) {
    this.now = opts.now ?? Date.now;
  }

  private get db(): DatabaseInstance {
    return this.opts.db;
  }

  list(ownerId: string): RulePlaybookSummary[] {
    const rows = prepareCached<[string], PlaybookRow & { rule_count: number }>(
      this.db,
      `SELECT p.*, (SELECT COUNT(*) FROM playbook_rules r WHERE r.playbook_id = p.id) AS rule_count
         FROM playbooks p WHERE p.owner_id = ? ORDER BY p.updated_at DESC`,
    ).all(ownerId);
    return rows.map((r) => ({ ...this.toSummary(r), ruleCount: r.rule_count }));
  }

  get(id: string, ownerId: string): RulePlaybook | null {
    const row = prepareCached<[string, string], PlaybookRow>(
      this.db,
      `SELECT * FROM playbooks WHERE id = ? AND owner_id = ?`,
    ).get(id, ownerId);
    if (!row) return null;
    const rules = prepareCached<[string], RuleRow>(
      this.db,
      `SELECT * FROM playbook_rules WHERE playbook_id = ? ORDER BY position`,
    )
      .all(id)
      .map((r) => ({
        id: r.id,
        title: r.title,
        standard: r.standard,
        fallback: r.fallback,
        unacceptable: r.unacceptable,
        guidance: r.guidance,
        sampleClause: r.sample_clause,
      }));
    return { ...this.toSummary(row), rules };
  }

  create(ownerId: string, input: RulePlaybookInput): RulePlaybook {
    validateInput(input);
    const id = randomUUID();
    const now = this.now();
    this.db.transaction(() => {
      prepareCached<[string, string, string, string, string, number, number]>(
        this.db,
        `INSERT INTO playbooks (id, owner_id, name, description, contract_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, ownerId, input.name.trim(), input.description?.trim() ?? '', input.contractType?.trim() ?? '', now, now);
      this.writeRules(id, input.rules);
    })();
    return this.get(id, ownerId)!;
  }

  /** Replace name, description and the full ordered rule list. */
  update(id: string, ownerId: string, input: RulePlaybookInput): RulePlaybook | null {
    validateInput(input);
    if (!this.get(id, ownerId)) return null;
    this.db.transaction(() => {
      prepareCached<[string, string, string, number, string]>(
        this.db,
        `UPDATE playbooks SET name = ?, description = ?, contract_type = ?, updated_at = ? WHERE id = ?`,
      ).run(input.name.trim(), input.description?.trim() ?? '', input.contractType?.trim() ?? '', this.now(), id);
      prepareCached<[string]>(this.db, `DELETE FROM playbook_rules WHERE playbook_id = ?`).run(id);
      this.writeRules(id, input.rules);
    })();
    return this.get(id, ownerId);
  }

  delete(id: string, ownerId: string): boolean {
    let removed = false;
    this.db.transaction(() => {
      const r = prepareCached<[string, string]>(
        this.db,
        `DELETE FROM playbooks WHERE id = ? AND owner_id = ?`,
      ).run(id, ownerId);
      removed = r.changes > 0;
      if (removed) prepareCached<[string]>(this.db, `DELETE FROM playbook_rules WHERE playbook_id = ?`).run(id);
    })();
    return removed;
  }

  startRun(input: {
    playbook: RulePlaybook;
    ownerId: string;
    workspaceId: string;
    documentId: string;
    documentName: string;
  }): PlaybookRun {
    const id = randomUUID();
    prepareCached<[string, string, string, string, string, string, string, number]>(
      this.db,
      `INSERT INTO playbook_runs (id, playbook_id, playbook_name, owner_id, workspace_id, document_id, document_name,
                                  status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
    ).run(
      id,
      input.playbook.id,
      input.playbook.name,
      input.ownerId,
      input.workspaceId,
      input.documentId,
      input.documentName,
      this.now(),
    );
    return this.getRun(id)!;
  }

  finishRun(id: string, result: { findings: RuleFinding[]; redlineDocId: string | null }): PlaybookRun {
    prepareCached<[string, string | null, number, string]>(
      this.db,
      `UPDATE playbook_runs SET status = 'succeeded', findings = ?, redline_doc_id = ?, finished_at = ? WHERE id = ?`,
    ).run(jsonColumn.serialize(result.findings), result.redlineDocId, this.now(), id);
    return this.getRun(id)!;
  }

  failRun(id: string, error: string): PlaybookRun {
    prepareCached<[string, number, string]>(
      this.db,
      `UPDATE playbook_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`,
    ).run(error, this.now(), id);
    return this.getRun(id)!;
  }

  /** Runs still marked running after a restart can never finish. */
  failInterruptedRuns(): number {
    return prepareCached<[number]>(
      this.db,
      `UPDATE playbook_runs SET status = 'failed', error = 'Interrupted by a server restart', finished_at = ?
        WHERE status = 'running'`,
    ).run(this.now()).changes;
  }

  getRun(id: string): PlaybookRun | null {
    const row = prepareCached<[string], RunRow>(this.db, `SELECT * FROM playbook_runs WHERE id = ?`).get(id);
    return row ? this.toRun(row) : null;
  }

  listRuns(workspaceId: string): PlaybookRun[] {
    return prepareCached<[string], RunRow>(
      this.db,
      `SELECT * FROM playbook_runs WHERE workspace_id = ? ORDER BY created_at DESC`,
    )
      .all(workspaceId)
      .map((r) => this.toRun(r));
  }

  private writeRules(playbookId: string, rules: RulePlaybookInput['rules']): void {
    const insert = prepareCached<
      [string, string, number, string, string, string | null, string | null, string | null, string | null]
    >(
      this.db,
      `INSERT INTO playbook_rules (id, playbook_id, position, title, standard, fallback, unacceptable, guidance,
                                   sample_clause)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    rules.forEach((r, i) => {
      insert.run(
        randomUUID(),
        playbookId,
        i,
        r.title.trim(),
        r.standard.trim(),
        blank(r.fallback),
        blank(r.unacceptable),
        blank(r.guidance),
        blank(r.sampleClause),
      );
    });
  }

  private toSummary(r: PlaybookRow): Omit<RulePlaybook, 'rules'> {
    return {
      id: r.id,
      ownerId: r.owner_id,
      name: r.name,
      description: r.description,
      contractType: r.contract_type,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private toRun(r: RunRow): PlaybookRun {
    return {
      id: r.id,
      playbookId: r.playbook_id,
      playbookName: r.playbook_name,
      ownerId: r.owner_id,
      workspaceId: r.workspace_id,
      documentId: r.document_id,
      documentName: r.document_name,
      status: r.status,
      findings: r.findings ? (jsonColumn.parse(r.findings) as RuleFinding[]) : null,
      redlineDocId: r.redline_doc_id,
      error: r.error,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
    };
  }
}
