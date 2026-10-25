import type { FieldSpec, Route } from '@teamsuzie/webmail-routes';

/**
 * The starting Outlook on the web route, from the hooks TeamSuzie's Outlook driver relied on (2026). It has not
 * been checked against a live account by this package: the first canary run relearns any operation that no longer
 * matches.
 */
const ROW_FIELDS: Record<string, FieldSpec> = {
    id: { from: 'attr:data-convid', format: 'id', required: true },
    thread_id: { from: 'attr:data-convid', format: 'id', required: false },
    from: { target: { css: 'span[title*="@"]' }, from: 'attr:title', format: 'email', required: true },
    subject: { from: 'attr:aria-label', pattern: '^(?:Unread )?(?:[^,]+), ([^,]+),', format: 'nonempty', required: true },
    date: { target: { css: 'span[title*=":"]' }, from: 'attr:title', format: 'date', required: true },
    unread: { from: 'attr:aria-label', pattern: '^(Unread)\\b', format: 'flag', required: false },
};

const READING_PANE = 'div[role="main"][aria-label*="Reading" i]';

export const OUTLOOK_SEED_ROUTE: Route = {
    schema_version: 1,
    provider: 'outlook',
    route_version: '2026-10-25.1',
    learned_by: 'seed',
    learned_at: '2026-10-25T00:00:00.000Z',
    domains: ['outlook.cloud.microsoft', 'outlook.office.com', 'outlook.office365.com', 'outlook.live.com'],
    login_domains: ['login.microsoftonline.com', 'login.live.com', 'login.microsoft.com'],
    home_url: 'https://outlook.cloud.microsoft/mail/inbox',
    fingerprint: null,
    states: {
        inbox_list: { url_matches: '/mail/(inbox)?/?$', visible: [{ role: 'listbox', name_pattern: 'message list' }] },
        search_results: { url_matches: '/mail/', visible: [{ role: 'listbox', name_pattern: 'message list' }] },
        sent_list: { url_matches: '/mail/sentitems', visible: [{ role: 'listbox', name_pattern: 'message list' }] },
        message_open: { visible: [{ css: `${READING_PANE} div[role="document"]` }], container: { css: READING_PANE } },
        compose_open: {
            visible: [{ role: 'textbox', name_pattern: '^Message body' }],
            container: { role: 'main', has: { role: 'textbox', name_pattern: '^Message body' } },
        },
    },
    operations: {
        read_account: {
            steps: [
                { goto: 'home', expect: 'inbox_list' },
                {
                    extract: {
                        fields: {
                            address: { target: { css: '[role="treeitem"][title*="@"][aria-level="1"]' }, from: 'attr:title', format: 'email', required: true },
                        },
                    },
                    as: 'account',
                },
            ],
        },
        list_inbox: {
            steps: [
                { goto: 'home', expect: 'inbox_list' },
                { extract: { items: { role: 'option', css: '[data-convid]', each: true }, fields: ROW_FIELDS }, as: 'messages' },
            ],
        },
        open_message: {
            steps: [
                { goto: 'home', expect: 'inbox_list' },
                { click: { role: 'option', css: '[data-convid="$message_id"]' }, expect: 'message_open' },
                {
                    extract: {
                        fields: {
                            subject: { target: { role: 'heading', within: 'message_open', css: '[aria-level="2"], [aria-level="3"]' }, from: 'text', format: 'nonempty', required: true },
                            from: { target: { css: `${READING_PANE} span[title*="@"]` }, from: 'attr:title', format: 'email', required: true },
                            date: { target: { css: `${READING_PANE} [data-testid="SentReceivedSavedTime"]` }, from: 'text', format: 'date', required: true },
                            body: { target: { css: `${READING_PANE} div[role="document"]` }, from: 'text', format: 'nonempty', required: true },
                        },
                    },
                    as: 'message',
                },
            ],
        },
        read_thread: {
            steps: [
                { goto: 'home', expect: 'inbox_list' },
                { click: { role: 'option', css: '[data-convid="$thread_id"]' }, expect: 'message_open' },
                {
                    extract: {
                        items: { css: `${READING_PANE} div[aria-label^="Email from" i]`, each: true },
                        fields: {
                            id: { from: 'attr:data-item-id', format: 'id', required: true },
                            from: { target: { css: 'span[title*="@"]' }, from: 'attr:title', format: 'email', required: true },
                            date: { target: { css: '[data-testid="SentReceivedSavedTime"]' }, from: 'text', format: 'date', required: true },
                            body: { target: { css: 'div[role="document"]' }, from: 'text', format: 'text', required: false },
                        },
                    },
                    as: 'messages',
                },
            ],
        },
        search: {
            steps: [
                { goto: 'home', expect: 'inbox_list' },
                { type: { role: 'combobox', name_pattern: '^Search' }, value: '$query', then_press: 'Enter', expect: 'search_results' },
                { extract: { items: { role: 'option', css: '[data-convid]', each: true }, fields: ROW_FIELDS }, as: 'messages' },
            ],
        },
        compose_send: {
            steps: [
                { goto: 'home', expect: 'inbox_list' },
                // The whole name: the new Outlook's split button also has a "New mail options" arrow, which a prefix would match too.
                { click: { role: 'button', name_pattern: '^New (mail|email|message)$' }, expect: 'compose_open' },
                { type: { role: 'textbox', name: 'To', within: 'compose_open' }, value: '$draft.to', each_address: true, then_press: 'Enter' },
                { fill: { role: 'textbox', name_pattern: '^(Add a subject|Subject)$', within: 'compose_open' }, value: '$draft.subject' },
                { fill: { role: 'textbox', name_pattern: '^Message body', within: 'compose_open' }, value: '$draft.body' },
                { verify_recipients: { to: { css: 'div[aria-label="To" i] span[title*="@"]', each: true, within: 'compose_open' }, from: 'attr:title' } },
                { click: { role: 'button', name: 'Send', within: 'compose_open' }, commits: true, expect: 'inbox_list' },
            ],
            test_end: [{ click: { role: 'button', name: 'Discard', within: 'compose_open' } }],
        },
        reply: {
            steps: [
                { goto: 'home', expect: 'inbox_list' },
                { click: { role: 'option', css: '[data-convid="$message_id"]' }, expect: 'message_open' },
                { click: { role: 'button', name: 'Reply', within: 'message_open' }, expect: 'compose_open' },
                { fill: { role: 'textbox', name_pattern: '^Message body', within: 'compose_open' }, value: '$draft.body' },
                { verify_recipients: { to: { css: 'div[aria-label="To" i] span[title*="@"]', each: true, within: 'compose_open' }, from: 'attr:title' } },
                { click: { role: 'button', name: 'Send', within: 'compose_open' }, commits: true, expect: 'message_open' },
            ],
            test_end: [{ click: { role: 'button', name: 'Discard', within: 'compose_open' } }],
        },
        check_sent: {
            steps: [
                { goto: 'https://outlook.cloud.microsoft/mail/sentitems', expect: 'sent_list' },
                {
                    extract: {
                        items: { role: 'option', css: '[data-convid]', each: true },
                        fields: {
                            id: { from: 'attr:data-convid', format: 'id', required: true },
                            to: { target: { css: 'span[title]' }, from: 'attr:title', format: 'text', required: false },
                            subject: { from: 'attr:aria-label', pattern: '^(?:[^,]+), ([^,]+),', format: 'nonempty', required: true },
                        },
                    },
                    as: 'messages',
                },
            ],
        },
    },
};
