import type { FieldSpec, Route } from '@teamsuzie/webmail-routes';

/**
 * The starting Gmail route, from the hooks TeamSuzie's Gmail driver relied on (2026). It has not been checked
 * against a live account by this package: the first canary run relearns any operation that no longer matches.
 */
const ROW_FIELDS: Record<string, FieldSpec> = {
    id: { target: { css: '[data-legacy-thread-id]' }, from: 'attr:data-legacy-thread-id', format: 'id', required: true },
    thread_id: { target: { css: '[data-legacy-thread-id]' }, from: 'attr:data-legacy-thread-id', format: 'id', required: false },
    from: { target: { css: 'td span[email]:not([name="me"])' }, from: 'attr:email', format: 'email', required: true },
    subject: { target: { css: 'span.bog' }, from: 'text', format: 'nonempty', required: true },
    date: { target: { css: 'td.xW span[title]' }, from: 'attr:title', format: 'date', required: true },
    snippet: { target: { css: 'span.y2' }, from: 'text', format: 'text', required: false },
    unread: { from: 'attr:class', pattern: '\\b(zE)\\b', format: 'flag', required: false },
};

const LAST_MESSAGE = 'div[role="listitem"]:last-of-type';

export const GMAIL_SEED_ROUTE: Route = {
    schema_version: 1,
    provider: 'gmail',
    route_version: '2026-10-25.1',
    learned_by: 'seed',
    learned_at: '2026-10-25T00:00:00.000Z',
    domains: ['mail.google.com'],
    login_domains: ['accounts.google.com'],
    home_url: 'https://mail.google.com/mail/u/0/#inbox',
    fingerprint: null,
    states: {
        inbox_list: { url_matches: '#inbox$', visible: [{ role: 'main' }] },
        search_results: { url_matches: '#search/', visible: [{ role: 'main' }] },
        sent_list: { url_matches: '#sent$', visible: [{ role: 'main' }] },
        message_open: { url_matches: '#[a-z]+(/[^/]+)?/[A-Za-z0-9]+$', visible: [{ css: 'h2.hP' }] },
        compose_open: {
            visible: [{ role: 'dialog', has: { css: 'input[name="subjectbox"]' } }],
            container: { role: 'dialog', has: { css: 'input[name="subjectbox"]' } },
        },
        reply_open: {
            visible: [{ css: 'div.M9', has: { role: 'textbox', name: 'Message Body' } }],
            container: { css: 'div.M9', has: { role: 'textbox', name: 'Message Body' } },
        },
    },
    operations: {
        read_account: {
            steps: [
                { goto: 'home', expect: 'inbox_list' },
                {
                    extract: {
                        fields: {
                            address: { target: { css: 'a[aria-label^="Google Account"]' }, from: 'attr:aria-label', pattern: '\\(([^()\\s]+@[^()\\s]+)\\)', format: 'email', required: true },
                        },
                    },
                    as: 'account',
                },
            ],
        },
        list_inbox: {
            steps: [
                { goto: 'home', expect: 'inbox_list' },
                { extract: { items: { css: 'div[role="main"] tr.zA', each: true }, fields: ROW_FIELDS }, as: 'messages' },
            ],
        },
        open_message: {
            steps: [
                { goto: 'https://mail.google.com/mail/u/0/#all/$message_id', expect: 'message_open' },
                {
                    extract: {
                        fields: {
                            subject: { target: { css: 'h2.hP' }, from: 'text', format: 'nonempty', required: true },
                            from: { target: { css: `${LAST_MESSAGE} span.gD[email]` }, from: 'attr:email', format: 'email', required: true },
                            date: { target: { css: `${LAST_MESSAGE} span.g3[title]` }, from: 'attr:title', format: 'date', required: true },
                            body: { target: { css: `${LAST_MESSAGE} div.a3s` }, from: 'text', format: 'nonempty', required: true },
                        },
                    },
                    as: 'message',
                },
            ],
        },
        read_thread: {
            steps: [
                { goto: 'https://mail.google.com/mail/u/0/#all/$thread_id', expect: 'message_open' },
                {
                    extract: {
                        items: { css: 'div[role="listitem"]', each: true },
                        fields: {
                            id: { target: { css: '[data-legacy-message-id]' }, from: 'attr:data-legacy-message-id', format: 'id', required: true },
                            from: { target: { css: 'span.gD[email]' }, from: 'attr:email', format: 'email', required: true },
                            date: { target: { css: 'span.g3[title]' }, from: 'attr:title', format: 'date', required: true },
                            body: { target: { css: 'div.a3s' }, from: 'text', format: 'text', required: false },
                        },
                    },
                    as: 'messages',
                },
            ],
        },
        search: {
            steps: [
                { goto: 'home', expect: 'inbox_list' },
                { type: { css: 'input[aria-label="Search mail"]' }, value: '$query', then_press: 'Enter', expect: 'search_results' },
                { extract: { items: { css: 'div[role="main"] tr.zA', each: true }, fields: ROW_FIELDS }, as: 'messages' },
            ],
        },
        compose_send: {
            steps: [
                { goto: 'home', expect: 'inbox_list' },
                { click: { role: 'button', name: 'Compose' }, expect: 'compose_open' },
                { type: { role: 'combobox', name: 'To recipients', within: 'compose_open' }, value: '$draft.to', each_address: true, then_press: 'Tab' },
                { fill: { css: 'input[name="subjectbox"]', within: 'compose_open' }, value: '$draft.subject' },
                { fill: { role: 'textbox', name: 'Message Body', within: 'compose_open' }, value: '$draft.body' },
                { verify_recipients: { to: { css: '[data-hovercard-id*="@"]', each: true, within: 'compose_open' }, from: 'attr:data-hovercard-id' } },
                { click: { role: 'button', name_pattern: '^Send', within: 'compose_open' }, commits: true, expect: 'inbox_list' },
            ],
            test_end: [{ click: { role: 'button', name_pattern: '^Discard draft', within: 'compose_open' } }],
        },
        reply: {
            steps: [
                { goto: 'https://mail.google.com/mail/u/0/#all/$message_id', expect: 'message_open' },
                { click: { role: 'link', name: 'Reply' }, expect: 'reply_open' },
                { fill: { role: 'textbox', name: 'Message Body', within: 'reply_open' }, value: '$draft.body' },
                { verify_recipients: { to: { css: 'span[email]', each: true, within: 'reply_open' }, from: 'attr:email' } },
                { click: { role: 'button', name_pattern: '^Send', within: 'reply_open' }, commits: true, expect: 'message_open' },
            ],
            test_end: [{ click: { role: 'button', name_pattern: '^Discard draft', within: 'reply_open' } }],
        },
        check_sent: {
            steps: [
                { goto: 'https://mail.google.com/mail/u/0/#sent', expect: 'sent_list' },
                {
                    extract: {
                        items: { css: 'div[role="main"] tr.zA', each: true },
                        fields: {
                            id: { target: { css: '[data-legacy-thread-id]' }, from: 'attr:data-legacy-thread-id', format: 'id', required: true },
                            to: { target: { css: 'td span[email]' }, from: 'attr:email', format: 'emails', required: true },
                            subject: { target: { css: 'span.bog' }, from: 'text', format: 'nonempty', required: true },
                        },
                    },
                    as: 'messages',
                },
            ],
        },
    },
};
