import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { AlertStore, type Alert, type Notifier } from './alerts.js';
import { SqliteApprovalStore } from './approval-store.js';
import { parseConfig } from './config.js';
import { openAgentDb } from './db.js';
import { HealthStore } from './health.js';
import { NewMailStore } from './new-mail.js';
import { exampleRaw, manualClock } from './test-support.js';

describe('config', () => {
    it('accepts the example and expands ~ in data_dir', () => {
        const config = parseConfig(exampleRaw(), {});
        expect(config.data_dir.startsWith(homedir())).toBe(true);
        expect(config.accounts).toHaveLength(2);
    });

    it('names every problem', () => {
        const raw = exampleRaw();
        delete raw.learner;
        (raw.listen as Record<string, unknown>).host = '0.0.0.0';
        expect(() => parseConfig(raw, {})).toThrow(/learner[\s\S]*listen\.host|listen\.host[\s\S]*learner/);
    });

    it('rejects unknown keys, duplicate tokens, unknown agents in rules and unset key variables', () => {
        expect(() => parseConfig({ ...exampleRaw(), extra: 1 }, {})).toThrow(/extra/);
        const sameToken = exampleRaw();
        (sameToken.agents as Array<Record<string, string>>)[1]!.token = (sameToken.agents as Array<Record<string, string>>)[0]!.token!;
        expect(() => parseConfig(sameToken, {})).toThrow(/every token/);
        const unknownAgent = exampleRaw();
        (unknownAgent.send_policy as { rules: Array<Record<string, unknown>> }).rules[0]!.agents = ['nobody'];
        expect(() => parseConfig(unknownAgent, {})).toThrow(/unknown agent "nobody"/);
        const withKey = exampleRaw();
        (withKey.learner as Record<string, unknown>).api_key_env = 'LEARNER_KEY';
        expect(() => parseConfig(withKey, {})).toThrow(/LEARNER_KEY is not set/);
        expect(parseConfig(withKey, { LEARNER_KEY: 'x' }).learner.api_key_env).toBe('LEARNER_KEY');
    });

    it('rejects an allow rule with no recipient condition, a bad provider and a bad time zone', () => {
        const openRule = exampleRaw();
        (openRule.send_policy as { rules: unknown[] }).rules = [{ allow: ['send'], agents: ['*'] }];
        expect(() => parseConfig(openRule, {})).toThrow(/needs all_recipients_in_domains or recipients_already_in_thread/);
        const yahoo = exampleRaw();
        (yahoo.accounts as Array<Record<string, unknown>>)[0]!.provider = 'yahoo';
        expect(() => parseConfig(yahoo, {})).toThrow(/provider/);
        expect(() => parseConfig({ ...exampleRaw(), timezone: 'Mars/Olympus' }, {})).toThrow(/time zone/);
    });
});

describe('SqliteApprovalStore', () => {
    it('creates, finds by job id, updates and lists', async () => {
        const store = new SqliteApprovalStore(openAgentDb(':memory:'), manualClock().now);
        const item = await store.create({ subject_id: 'ops-agent', action_type: 'email.send_job', payload: { to: 'a@b.com' }, metadata: { job_id: 'job-1' } });
        expect(item).toMatchObject({ status: 'pending', payload: { to: 'a@b.com' }, metadata: { job_id: 'job-1' } });
        expect((await store.findByJobId('job-1'))?.id).toBe(item.id);
        expect(await store.findByJobId('job-2')).toBeNull();
        const reviewed = await store.update(item.id, { status: 'approved', review: { reviewer_id: 'admin', verdict: 'approve', reviewed_at: new Date('2026-10-26T10:00:00Z') } });
        expect(reviewed.review?.reviewed_at).toEqual(new Date('2026-10-26T10:00:00Z'));
        await store.create({ subject_id: 'other', action_type: 'email.send_job', payload: {} });
        expect(await store.list({ status: 'pending' })).toHaveLength(1);
        expect(await store.list({ subject_id: 'ops-agent' })).toHaveLength(1);
        expect(await store.list({ limit: 1 })).toHaveLength(1);
    });
});

describe('HealthStore', () => {
    it('treats an unrecorded operation as healthy and records state changes', () => {
        const clock = manualClock();
        const health = new HealthStore(openAgentDb(':memory:'), clock.now);
        expect(health.get('me@x.com', 'search').state).toBe('healthy');
        health.set('me@x.com', 'search', { state: 'broken', last_error: 'gone' });
        clock.advance(1000);
        health.set('me@x.com', 'search', { last_error: 'still gone' });
        expect(health.get('me@x.com', 'search')).toMatchObject({ state: 'broken', last_error: 'still gone', since: '2026-10-26T10:00:00.000Z' });
        expect(Object.keys(health.all('me@x.com'))).toEqual(['search']);
    });
});

describe('AlertStore', () => {
    it('stores alerts, tells every notifier and lists after a cursor', async () => {
        const seen: Alert[] = [];
        const notifier: Notifier = { notify: async (a) => { seen.push(a); } };
        const alerts = new AlertStore(openAgentDb(':memory:'), [notifier], manualClock().now);
        const first = await alerts.raise('me@x.com', 'needs_login', 'Sign in please');
        await alerts.raise('you@x.com', 'route_broken', 'search is broken');
        expect(seen.map((a) => a.kind)).toEqual(['needs_login', 'route_broken']);
        expect(alerts.list({ after: first.seq, limit: 10 }).map((a) => a.kind)).toEqual(['route_broken']);
        expect(alerts.list({ after: 0, limit: 10, account: 'me@x.com' })).toHaveLength(1);
    });

    it('fails loudly when a notifier fails', async () => {
        const alerts = new AlertStore(openAgentDb(':memory:'), [{ notify: async () => { throw new Error('no display'); } }], manualClock().now);
        await expect(alerts.raise('me@x.com', 'needs_login', 'x')).rejects.toThrow('no display');
    });
});

describe('NewMailStore', () => {
    it('records each message once, in date order, and pages by cursor', () => {
        const mail = new NewMailStore(openAgentDb(':memory:'), manualClock().now);
        const m = (id: string, date: string) => ({ id, thread_id: null, from: `${id}@x.com`, subject: id, date, snippet: null });
        const added = mail.record('me@x.com', [m('b', '2026-10-26T09:00:00Z'), m('a', '2026-10-26T08:00:00Z')]);
        expect(added.map((i) => i.id)).toEqual(['a', 'b']);
        expect(mail.record('me@x.com', [m('a', '2026-10-26T08:00:00Z'), m('c', '2026-10-26T10:00:00Z')]).map((i) => i.id)).toEqual(['c']);
        const page = mail.list({ after: 0, limit: 2 });
        expect(page.items.map((i) => i.id)).toEqual(['a', 'b']);
        expect(mail.list({ after: page.cursor, limit: 10 }).items.map((i) => i.id)).toEqual(['c']);
        const last = mail.list({ after: page.cursor, limit: 10 }).cursor;
        expect(mail.list({ after: last, limit: 10 })).toEqual({ items: [], cursor: last });
        expect(mail.senderOf('me@x.com', 'b')).toBe('b@x.com');
        expect(mail.senderOf('me@x.com', 'z')).toBeNull();
    });
});
