import { readFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { Route } from '@teamsuzie/webmail-routes';

/**
 * A small Gmail-like web app for tests, served on https://mail.example.test by request interception (no network,
 * no certificates). Its sign-in page is https://login.example.test/signin.
 *
 * Variants: `standard`; `renamed` (the Compose button is called "New message"); `expire` (pressing Compose
 * signs the user out).
 */
export type FixtureVariant = 'standard' | 'renamed' | 'expire';

export const FIXTURE_HOME = 'https://mail.example.test/#inbox';

export interface FixtureBrowser {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    close(): Promise<void>;
}

const fixturesDir = new URL('../../fixtures/', import.meta.url);

function mailHtml(variant: FixtureVariant): string {
    return readFileSync(new URL('mail.html', fixturesDir), 'utf8')
        .replace('__VARIANT__', variant)
        .replace('__COMPOSE_LABEL__', variant === 'renamed' ? 'New message' : 'Compose');
}

/** Installed Chrome, headless, with the fixture app served on its fake hosts. */
export async function openFixtureBrowser(variant: FixtureVariant = 'standard'): Promise<FixtureBrowser> {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await serveFixture(context, variant);
    const page = await context.newPage();
    return { browser, context, page, close: () => browser.close() };
}

/** Serve the fixture app on `context` (replacing any variant served before). */
export async function serveFixture(context: BrowserContext, variant: FixtureVariant): Promise<void> {
    await context.unroute('https://mail.example.test/**');
    const html = mailHtml(variant);
    await context.route('https://mail.example.test/**', (route) => route.fulfill({ body: html, contentType: 'text/html' }));
    await context.unroute('https://login.example.test/**');
    const signin = readFileSync(new URL('signin.html', fixturesDir), 'utf8');
    await context.route('https://login.example.test/**', (route) => route.fulfill({ body: signin, contentType: 'text/html' }));
}

export interface FixtureActivity {
    sendClicks: number;
    discards: number;
    sent: Array<{ to: string; subject: string; body: string }>;
}

/** What the fixture app has recorded: Send clicks, discarded drafts and sent messages. */
export function fixtureActivity(page: Page): Promise<FixtureActivity> {
    return page.evaluate(() => {
        const w = window as unknown as { __sendClicks: number; __discards: number; __sent: FixtureActivity['sent'] };
        return { sendClicks: w.__sendClicks, discards: w.__discards, sent: w.__sent.map((m) => ({ to: m.to, subject: m.subject, body: m.body })) };
    });
}

/** Make the fixture's To field turn `typed` into `chosen` when committed, like a wrong autocomplete pick. */
export async function setAutocomplete(page: Page, typed: string, chosen: string): Promise<void> {
    await page.evaluate(([t, c]) => {
        (window as unknown as { __autocomplete: Record<string, string> }).__autocomplete[t!] = c!;
    }, [typed, chosen]);
}

/** A valid route for the fixture app, defining every operation. */
export function fixtureRoute(): Route {
    const rowFields = {
        id: { from: 'attr:data-id', format: 'id', required: true },
        thread_id: { from: 'attr:data-thread', format: 'id', required: false },
        from: { target: { css: 'td.from [data-email]' }, from: 'attr:data-email', format: 'emails', required: true },
        subject: { target: { css: 'td.subject' }, from: 'text', format: 'nonempty', required: true },
        date: { target: { css: 'td.date [title]' }, from: 'attr:title', format: 'date', required: true },
        snippet: { target: { css: 'td.snippet' }, from: 'text', format: 'text', required: false },
        unread: { from: 'attr:aria-label', pattern: '^(unread),', format: 'flag', required: false },
    } as const;
    return {
        schema_version: 1,
        provider: 'gmail',
        route_version: '2026-10-25.1',
        learned_by: 'seed',
        learned_at: '2026-10-25T00:00:00.000Z',
        domains: ['mail.example.test'],
        login_domains: ['login.example.test'],
        home_url: FIXTURE_HOME,
        fingerprint: null,
        states: {
            inbox_list: { url_matches: '#inbox$', visible: [{ role: 'grid', name: 'Inbox' }] },
            search_results: { url_matches: '#search/', visible: [{ role: 'grid', name: 'Search results' }] },
            sent_list: { url_matches: '#sent$', visible: [{ role: 'grid', name: 'Sent' }] },
            message_open: { url_matches: '#(inbox|all)/.+', visible: [{ role: 'button', name: 'Reply' }] },
            compose_open: {
                visible: [{ role: 'dialog', name: 'New Message' }],
                container: { role: 'dialog', name: 'New Message' },
            },
            reply_open: {
                visible: [{ role: 'region', name: 'Reply' }],
                container: { role: 'region', name: 'Reply' },
            },
        },
        operations: {
            read_account: {
                steps: [
                    { goto: 'home', expect: 'inbox_list' },
                    {
                        extract: {
                            fields: {
                                address: { target: { role: 'button', name_pattern: '^Fixture Account:' }, from: 'name', pattern: '\\(([^)]+)\\)', format: 'email', required: true },
                            },
                        },
                        as: 'account',
                    },
                ],
            },
            list_inbox: {
                steps: [
                    { goto: 'home', expect: 'inbox_list' },
                    { extract: { items: { css: 'tr.row', each: true }, fields: { ...rowFields } }, as: 'messages' },
                ],
            },
            open_message: {
                steps: [
                    { goto: 'https://mail.example.test/#inbox/$message_id', expect: 'message_open' },
                    {
                        extract: {
                            fields: {
                                subject: { target: { css: 'h2.subject' }, from: 'text', format: 'nonempty', required: true },
                                from: { target: { css: '.msg[data-message-id="$message_id"] .sender' }, from: 'attr:data-email', format: 'email', required: true },
                                to: { target: { css: '.msg[data-message-id="$message_id"] .to' }, from: 'attr:title', pattern: '^to (.+)$', format: 'emails', required: false },
                                cc: { target: { css: '.msg[data-message-id="$message_id"] .cc' }, from: 'attr:title', pattern: '^cc (.+)$', format: 'emails', required: false },
                                date: { target: { css: '.msg[data-message-id="$message_id"] .when' }, from: 'attr:title', format: 'date', required: true },
                                body: { target: { css: '.msg[data-message-id="$message_id"] .body' }, from: 'text', format: 'nonempty', required: true },
                            },
                        },
                        as: 'message',
                    },
                ],
            },
            read_thread: {
                steps: [
                    { goto: 'https://mail.example.test/#all/$thread_id', expect: 'message_open' },
                    {
                        extract: {
                            items: { css: '.msg', each: true },
                            fields: {
                                id: { from: 'attr:data-message-id', format: 'id', required: true },
                                from: { target: { css: '.sender' }, from: 'attr:data-email', format: 'email', required: true },
                                date: { target: { css: '.when' }, from: 'attr:title', format: 'date', required: true },
                                body: { target: { css: '.body' }, from: 'text', format: 'nonempty', required: true },
                            },
                        },
                        as: 'messages',
                    },
                ],
            },
            search: {
                steps: [
                    { goto: 'home', expect: 'inbox_list' },
                    { type: { role: 'searchbox', name: 'Search mail' }, value: '$query', then_press: 'Enter', expect: 'search_results' },
                    { extract: { items: { css: 'tr.row', each: true }, fields: { ...rowFields } }, as: 'messages' },
                ],
            },
            compose_send: {
                steps: [
                    { goto: 'home', expect: 'inbox_list' },
                    { click: { role: 'button', name: 'Compose' }, expect: 'compose_open' },
                    { type: { role: 'combobox', name: 'To recipients', within: 'compose_open' }, value: '$draft.to', each_address: true, then_press: 'Tab' },
                    { fill: { role: 'textbox', name: 'Subject', within: 'compose_open' }, value: '$draft.subject' },
                    { fill: { role: 'textbox', name: 'Message Body', within: 'compose_open' }, value: '$draft.body' },
                    { verify_recipients: { to: { css: '.chip', each: true, within: 'compose_open' }, from: 'attr:data-email' } },
                    { click: { role: 'button', name: 'Send', within: 'compose_open' }, commits: true, expect: 'inbox_list' },
                ],
                test_end: [{ click: { role: 'button', name: 'Discard draft', within: 'compose_open' } }],
            },
            reply: {
                steps: [
                    { goto: 'https://mail.example.test/#inbox/$message_id', expect: 'message_open' },
                    { click: { role: 'button', name: 'Reply' }, expect: 'reply_open' },
                    { fill: { role: 'textbox', name: 'Message Body', within: 'reply_open' }, value: '$draft.body' },
                    { verify_recipients: { to: { css: '.chip', each: true, within: 'reply_open' }, from: 'attr:data-email' } },
                    { click: { role: 'button', name: 'Send', within: 'reply_open' }, commits: true, expect: 'message_open' },
                ],
                test_end: [{ click: { role: 'button', name: 'Discard draft', within: 'reply_open' } }],
            },
            check_sent: {
                steps: [
                    { goto: 'https://mail.example.test/#sent', expect: 'sent_list' },
                    {
                        extract: {
                            items: { css: 'tr.row', each: true },
                            fields: {
                                id: { from: 'attr:data-id', format: 'id', required: true },
                                to: { target: { css: 'td.from [data-email]' }, from: 'attr:data-email', format: 'emails', required: true },
                                subject: { target: { css: 'td.subject' }, from: 'text', format: 'nonempty', required: true },
                            },
                        },
                        as: 'messages',
                    },
                ],
            },
        },
    };
}
