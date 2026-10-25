import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { z } from 'zod';

const positive = z.number().positive();
const positiveInt = z.number().int().positive();
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM (24-hour)');
const token = z.string().min(24, 'must be at least 24 characters');

const allowRule = z.object({
    allow: z.array(z.enum(['send', 'reply'])).min(1),
    agents: z.array(z.string().min(1)).min(1),
    all_recipients_in_domains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'must be a domain name')).min(1).optional(),
    recipients_already_in_thread: z.literal(true).optional(),
}).strict().refine(
    (rule) => rule.all_recipients_in_domains !== undefined || rule.recipients_already_in_thread !== undefined,
    'an allow rule needs all_recipients_in_domains or recipients_already_in_thread (a rule that allows any recipient is not supported)',
);

const capRule = z.object({
    max_per_hour: positiveInt,
    agents: z.array(z.string().min(1)).min(1),
}).strict();

const schema = z.object({
    data_dir: z.string().min(1),
    listen: z.object({ host: z.literal('127.0.0.1'), port: z.number().int().min(1).max(65535) }).strict(),
    admin_token: token,
    agents: z.array(z.object({ id: z.string().regex(/^[\w.-]+$/), token }).strict()).min(1),
    accounts: z.array(z.object({
        address: z.string().email(),
        provider: z.enum(['gmail', 'outlook']),
        headed_offscreen: z.boolean(),
    }).strict()).min(1),
    learner: z.object({
        base_url: z.string().url(),
        model: z.string().min(1),
        api_key_env: z.string().min(1).nullable(),
        max_submissions: z.number().int().min(1).max(20),
        max_tool_calls: z.number().int().min(1).max(200),
        attempts: z.number().int().min(1).max(10),
        max_tokens: positiveInt,
    }).strict(),
    notifications: z.enum(['macos', 'none']),
    /** Hours between full canaries, or null for none (real failures, layout changes and daily retries still trigger checks). */
    canary_interval_hours: positive.nullable(),
    check_inbox_minutes: z.tuple([positive, positive]).refine(([min, max]) => min <= max, 'the first number must not be larger than the second'),
    default_job_timeout_minutes: positive,
    login_timeout_minutes: positive,
    locale: z.string().min(2),
    timezone: z.string().min(1),
    timeouts: z.object({ step_ms: positiveInt, state_ms: positiveInt, navigation_ms: positiveInt }).strict(),
    volume: z.object({
        opens_per_minute: positive,
        opens_per_hour: positive,
        min_seconds_between_sends: positive,
        quiet_hours: z.object({ start: clock, end: clock }).strict().nullable(),
    }).strict(),
    send_policy: z.object({ rules: z.array(z.union([capRule, allowRule])) }).strict(),
}).strict();

export type AgentConfig = z.infer<typeof schema>;
export type AllowRule = z.infer<typeof allowRule>;
export type CapRule = z.infer<typeof capRule>;
export type SendRule = AllowRule | CapRule;

export class ConfigError extends Error {
    override readonly name = 'ConfigError';
}

/** Parse and check a config object. Throws a ConfigError naming every problem. */
export function parseConfig(raw: unknown, env: NodeJS.ProcessEnv): AgentConfig {
    const result = schema.safeParse(raw);
    if (!result.success) {
        const problems = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
        throw new ConfigError(`Invalid email-agent config:\n- ${problems.join('\n- ')}`);
    }
    const config = result.data;
    const problems: string[] = [];
    const agentIds = config.agents.map((a) => a.id);
    const tokens = [config.admin_token, ...config.agents.map((a) => a.token)];
    if (new Set(agentIds).size !== agentIds.length) problems.push('agents: agent ids must be unique');
    if (new Set(tokens).size !== tokens.length) problems.push('agents: every token (and admin_token) must be different');
    const addresses = config.accounts.map((a) => a.address.toLowerCase());
    if (new Set(addresses).size !== addresses.length) problems.push('accounts: addresses must be unique');
    for (const [i, rule] of config.send_policy.rules.entries()) {
        for (const agent of rule.agents) {
            if (agent !== '*' && !agentIds.includes(agent)) problems.push(`send_policy.rules.${i}.agents: unknown agent "${agent}"`);
        }
    }
    if (config.learner.api_key_env !== null && !env[config.learner.api_key_env]) {
        problems.push(`learner.api_key_env: environment variable ${config.learner.api_key_env} is not set`);
    }
    try {
        new Intl.DateTimeFormat('en', { timeZone: config.timezone });
    } catch {
        problems.push(`timezone: "${config.timezone}" is not a known time zone`);
    }
    if (problems.length > 0) throw new ConfigError(`Invalid email-agent config:\n- ${problems.join('\n- ')}`);
    // A leading ~ in data_dir means the user's home directory.
    return { ...config, data_dir: config.data_dir.replace(/^~(?=\/|$)/, homedir()) };
}

export function loadConfig(path: string, env: NodeJS.ProcessEnv = process.env): AgentConfig {
    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
        throw new ConfigError(`Could not read the email-agent config at ${path}: ${(error as Error).message}`);
    }
    return parseConfig(raw, env);
}
