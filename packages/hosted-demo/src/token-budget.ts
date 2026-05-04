import type { DatabaseInstance, Migration } from '@teamsuzie/db-sqlite';

export type HostedDemoAuthProvider = 'demo' | 'google' | 'microsoft';

export interface HostedDemoAccountSession {
  email: string;
  name: string;
  role: string;
}

export interface TokenBudgetSummary extends HostedDemoAccountSession {
  authProvider: HostedDemoAuthProvider;
  authSubject: string | null;
  tokenLimit: number;
  tokensUsed: number;
  tokensRemaining: number;
  limitReached: boolean;
}

export interface TokenUsageInput {
  ownerEmail: string;
  source: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  metadata?: Record<string, unknown>;
}

interface AccountRow {
  email: string;
  name: string;
  role: string;
  auth_provider: HostedDemoAuthProvider;
  auth_subject: string | null;
  token_limit: number;
  tokens_used: number;
}

export const HOSTED_DEMO_MIGRATIONS: Migration[] = [
  {
    name: '20260502_create_hosted_demo_accounts_and_token_usage',
    up: `
      CREATE TABLE IF NOT EXISTS hosted_demo_accounts (
        email TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        auth_provider TEXT NOT NULL,
        auth_subject TEXT,
        token_limit INTEGER NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_hosted_demo_accounts_auth
        ON hosted_demo_accounts(auth_provider, auth_subject);

      CREATE TABLE IF NOT EXISTS hosted_demo_token_usage (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        source TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        metadata_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_hosted_demo_token_usage_email_created
        ON hosted_demo_token_usage(email, created_at DESC);
    `,
  },
];

export class TokenLimitExceededError extends Error {
  constructor(message = 'Demo token allowance used') {
    super(message);
    this.name = 'TokenLimitExceededError';
  }
}

export class TokenBudgetStore {
  constructor(
    private readonly db: DatabaseInstance,
    private readonly defaultTokenLimit: number,
  ) {}

  upsertAccount(input: {
    email: string;
    name: string;
    role?: string;
    authProvider: HostedDemoAuthProvider;
    authSubject?: string | null;
    tokenLimit?: number;
  }): TokenBudgetSummary {
    const now = Date.now();
    const email = normalizeEmail(input.email);
    const existing = this.findRow(email);
    this.db
      .prepare(
        `INSERT INTO hosted_demo_accounts
          (email, name, role, auth_provider, auth_subject, token_limit, tokens_used, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           name = excluded.name,
           role = excluded.role,
           auth_provider = excluded.auth_provider,
           auth_subject = excluded.auth_subject,
           updated_at = excluded.updated_at`,
      )
      .run(
        email,
        input.name.trim() || email,
        input.role || existing?.role || 'user',
        input.authProvider,
        input.authSubject ?? null,
        input.tokenLimit ?? existing?.token_limit ?? this.defaultTokenLimit,
        now,
        now,
      );
    return this.getSummary(email);
  }

  getSummary(email: string): TokenBudgetSummary {
    const row = this.findRow(email);
    if (!row) {
      return this.upsertAccount({
        email,
        name: email,
        authProvider: 'demo',
        authSubject: email,
      });
    }
    return rowToSummary(row);
  }

  assertCanSpend(email: string): TokenBudgetSummary {
    const summary = this.getSummary(email);
    if (summary.tokenLimit > 0 && summary.tokensRemaining <= 0) {
      throw new TokenLimitExceededError(
        `Demo token allowance used. This account has reached its ${summary.tokenLimit.toLocaleString()} token limit.`,
      );
    }
    return summary;
  }

  recordUsage(input: TokenUsageInput): TokenBudgetSummary {
    const email = normalizeEmail(input.ownerEmail);
    const totalTokens = Math.max(0, Math.floor(input.inputTokens + input.outputTokens));
    if (totalTokens <= 0) return this.getSummary(email);
    this.assertCanSpend(email);
    const now = Date.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO hosted_demo_token_usage
            (id, email, source, model, input_tokens, output_tokens, total_tokens, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomId(),
          email,
          input.source,
          input.model,
          Math.max(0, Math.floor(input.inputTokens)),
          Math.max(0, Math.floor(input.outputTokens)),
          totalTokens,
          input.metadata ? JSON.stringify(input.metadata) : null,
          now,
        );
      this.db
        .prepare(
          `UPDATE hosted_demo_accounts
           SET tokens_used = tokens_used + ?, updated_at = ?
           WHERE email = ?`,
        )
        .run(totalTokens, now, email);
    })();
    return this.getSummary(email);
  }

  private findRow(email: string): AccountRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM hosted_demo_accounts WHERE email = ?`)
        .get(normalizeEmail(email)) as AccountRow | undefined) ?? null
    );
  }
}

export function createTokenMeteredFetch(opts: {
  budget: TokenBudgetStore;
  ownerEmail: string;
  source: string;
  model: string;
  enabled: boolean;
  fallbackTokens: number;
}): typeof fetch {
  if (!opts.enabled) return fetch;
  return async (input, init) => {
    opts.budget.assertCanSpend(opts.ownerEmail);
    const body = requestUsageInBody(init?.body);
    const response = await fetch(input, { ...init, body: body ?? init?.body });
    void meterResponse(response, opts);
    return response;
  };
}

export function parseTokenLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function requestUsageInBody(body: BodyInit | null | undefined): BodyInit | null {
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed.stream === true) {
      parsed.stream_options = {
        ...((parsed.stream_options as Record<string, unknown> | undefined) ?? {}),
        include_usage: true,
      };
      return JSON.stringify(parsed);
    }
  } catch {
    return null;
  }
  return null;
}

async function meterResponse(
  response: Response,
  opts: {
    budget: TokenBudgetStore;
    ownerEmail: string;
    source: string;
    model: string;
    fallbackTokens: number;
  },
): Promise<void> {
  if (!response.ok) return;
  try {
    const clone = response.clone();
    const contentType = clone.headers.get('content-type') ?? '';
    const usage = contentType.includes('text/event-stream')
      ? await readStreamUsage(clone)
      : await readJsonUsage(clone);

    if (usage) {
      opts.budget.recordUsage({
        ownerEmail: opts.ownerEmail,
        source: opts.source,
        model: opts.model,
        inputTokens: usage.input,
        outputTokens: usage.output,
      });
    } else if (opts.fallbackTokens > 0) {
      opts.budget.recordUsage({
        ownerEmail: opts.ownerEmail,
        source: `${opts.source}:fallback`,
        model: opts.model,
        inputTokens: opts.fallbackTokens,
        outputTokens: 0,
        metadata: { reason: 'provider omitted usage' },
      });
    }
  } catch (err) {
    console.warn('[hosted-demo] usage metering failed:', err instanceof Error ? err.message : err);
  }
}

async function readJsonUsage(response: Response): Promise<{ input: number; output: number } | null> {
  const data = (await response.json().catch(() => null)) as { usage?: Record<string, unknown> } | null;
  return extractUsage(data?.usage);
}

async function readStreamUsage(response: Response): Promise<{ input: number; output: number } | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastUsage: { input: number; output: number } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      const line = event.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as { usage?: Record<string, unknown> };
        const usage = extractUsage(parsed.usage);
        if (usage) lastUsage = usage;
      } catch {
        // Ignore malformed stream chunks.
      }
    }
  }
  return lastUsage;
}

function extractUsage(usage: Record<string, unknown> | undefined): { input: number; output: number } | null {
  if (!usage) return null;
  const input = numberValue(usage.prompt_tokens) ?? numberValue(usage.input_tokens) ?? 0;
  const output = numberValue(usage.completion_tokens) ?? numberValue(usage.output_tokens) ?? 0;
  if (input <= 0 && output <= 0) return null;
  return { input, output };
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function rowToSummary(row: AccountRow): TokenBudgetSummary {
  const tokenLimit = Math.max(0, row.token_limit);
  const tokensUsed = Math.max(0, row.tokens_used);
  const tokensRemaining = tokenLimit === 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, tokenLimit - tokensUsed);
  return {
    email: row.email,
    name: row.name,
    role: row.role,
    authProvider: row.auth_provider,
    authSubject: row.auth_subject,
    tokenLimit,
    tokensUsed,
    tokensRemaining,
    limitReached: tokenLimit > 0 && tokensRemaining <= 0,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
