import { OPERATION_NAMES, type Operation, type OperationName, type Route } from './types.js';

/** A small valid route, for tests in this and other packages. Each test changes a copy. */
export function minimalRoute(): Route {
    const simple: Operation = {
        steps: [{ goto: 'home', expect: 'inbox_list' }],
    };
    const operations = Object.fromEntries(
        OPERATION_NAMES.map((name) => [name, structuredClone(simple)]),
    ) as Record<OperationName, Operation>;
    operations.compose_send = {
        steps: [
            { click: { role: 'button', name: 'Compose' }, expect: 'compose_open' },
            { type: { role: 'combobox', name: 'To', within: 'compose_open' }, value: '$draft.to', each_address: true, then_press: 'Tab' },
            { fill: { role: 'textbox', name: 'Subject', within: 'compose_open' }, value: '$draft.subject' },
            { verify_recipients: { to: { css: '.chip', each: true, within: 'compose_open' }, from: 'attr:data-email' } },
            { click: { role: 'button', name: 'Send', within: 'compose_open' }, commits: true, expect: 'inbox_list' },
        ],
        test_end: [{ click: { role: 'button', name: 'Discard draft', within: 'compose_open' } }],
    };
    operations.list_inbox = {
        steps: [
            { goto: 'home', expect: 'inbox_list' },
            {
                extract: {
                    items: { css: 'tr.row', each: true },
                    fields: {
                        id: { from: 'attr:data-id', format: 'id', required: true },
                        from: { target: { css: '.from' }, from: 'attr:data-email', format: 'email', required: true },
                    },
                },
                as: 'messages',
            },
        ],
    };
    operations.discard_draft = {
        steps: [
            { goto: 'https://mail.example.com/#drafts/$message_id', expect: 'compose_open' },
            { verify_text: { target: { role: 'textbox', name: 'Body', within: 'compose_open' }, from: 'text', contains: '$marker' } },
            { click: { role: 'button', name: 'Discard draft', within: 'compose_open' }, commits: true, expect: 'inbox_list' },
        ],
        test_end: [{ press: 'Escape' }],
    };
    operations.open_message = {
        steps: [{ goto: 'https://mail.example.com/#inbox/$message_id', expect: 'message_open' }],
    };
    return {
        schema_version: 1,
        provider: 'gmail',
        route_version: '2026-10-25.1',
        learned_by: 'seed',
        learned_at: '2026-10-25T00:00:00.000Z',
        domains: ['mail.example.com'],
        login_domains: ['accounts.example.com'],
        home_url: 'https://mail.example.com/#inbox',
        fingerprint: null,
        states: {
            inbox_list: { url_matches: '#inbox', visible: [{ role: 'grid' }] },
            message_open: { visible: [{ role: 'heading', name_pattern: '.+' }] },
            compose_open: {
                visible: [{ role: 'dialog' }],
                container: { role: 'dialog', has: { role: 'button', name: 'Send' } },
            },
        },
        operations,
    };
}
