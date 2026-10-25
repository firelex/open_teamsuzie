import { describe, expect, it } from 'vitest';
import { minimalRoute } from './test-route.js';
import type { Route } from './types.js';
import { assertValidRoute, RouteValidationError, validateRoute } from './validate.js';

function errorsAfter(change: (route: Route) => void): string[] {
    const route = minimalRoute();
    change(route);
    return validateRoute(route);
}

function anyMatches(errors: string[], pattern: RegExp): boolean {
    return errors.some((error) => pattern.test(error));
}

describe('validateRoute', () => {
    it('accepts the minimal route', () => {
        expect(validateRoute(minimalRoute())).toEqual([]);
    });

    it('rejects a non-object', () => {
        expect(validateRoute('nope')).toEqual(['route must be an object']);
    });

    it('requires schema_version 1', () => {
        expect(anyMatches(errorsAfter((r) => { (r as { schema_version: number }).schema_version = 2; }), /schema_version/)).toBe(true);
    });

    it('requires a known provider', () => {
        expect(anyMatches(errorsAfter((r) => { (r as { provider: string }).provider = 'yahoo'; }), /provider/)).toBe(true);
    });

    it('requires route_version YYYY-MM-DD.N', () => {
        expect(anyMatches(errorsAfter((r) => { r.route_version = 'v1'; }), /route_version/)).toBe(true);
    });

    it('requires hostnames in domains and login_domains', () => {
        expect(anyMatches(errorsAfter((r) => { r.domains = []; }), /domains must be a non-empty/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.login_domains = ['https://x.com/']; }), /login_domains\[0\]/)).toBe(true);
    });

    it('requires an https home_url on a listed domain', () => {
        expect(anyMatches(errorsAfter((r) => { r.home_url = 'http://mail.example.com/'; }), /home_url/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.home_url = 'https://evil.example.org/'; }), /home_url/)).toBe(true);
    });

    it('requires every operation with at least one step', () => {
        expect(anyMatches(errorsAfter((r) => { delete (r.operations as Record<string, unknown>).search; }), /operations\.search/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = []; }), /operations\.search\.steps/)).toBe(true);
    });

    it('rejects unknown operations', () => {
        expect(anyMatches(errorsAfter((r) => { (r.operations as Record<string, unknown>).delete_all = { steps: [{ goto: 'home' }] }; }), /delete_all/)).toBe(true);
    });

    it('requires exactly one action per step and no unknown keys', () => {
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ goto: 'home', press: 'Enter' } as never]; }), /exactly one action/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ goto: 'home', delay: 5 } as never]; }), /unknown key "delay"/)).toBe(true);
    });

    it('only lets goto visit home or an https URL on a listed domain', () => {
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ goto: 'https://evil.example.org/x' }]; }), /goto/)).toBe(true);
        expect(validateRoute((() => { const r = minimalRoute(); r.operations.search.steps = [{ goto: 'https://mail.example.com/#search/$query' }]; return r; })())).toEqual([]);
    });

    it('requires role or css on a target, and not both name and name_pattern', () => {
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ click: { name: 'Send' } }]; }), /role or css/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ click: { role: 'button', name: 'a', name_pattern: 'b' } }]; }), /both name and name_pattern/)).toBe(true);
    });

    it('requires name_pattern and field patterns to compile', () => {
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ click: { role: 'button', name_pattern: '(' } }]; }), /name_pattern/)).toBe(true);
    });

    it('rejects css that depends on generated numeric ids', () => {
        for (const css of ['#116-group', '#588', '[aria-labelledby="116-label"]', 'label[for="123-label"]']) {
            expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ click: { css } }]; }), /generated numeric id/), css).toBe(true);
        }
        expect(validateRoute((() => { const r = minimalRoute(); r.operations.search.steps = [{ click: { css: 'input[id^="MSG_"]' } }]; return r; })())).toEqual([]);
    });

    it('rejects long css', () => {
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ click: { css: 'a'.repeat(513) } }]; }), /512/)).toBe(true);
    });

    it('requires expect, wait_for and within to name defined states', () => {
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ goto: 'home', expect: 'nowhere' }]; }), /state "nowhere"/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ wait_for: 'nowhere' }]; }), /state "nowhere"/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ click: { role: 'button', within: 'nowhere' } }]; }), /state "nowhere"/)).toBe(true);
    });

    it('requires an inbox_list state', () => {
        expect(anyMatches(errorsAfter((r) => { r.states.inbox = r.states.inbox_list!; delete (r.states as Record<string, unknown>).inbox_list; r.operations = JSON.parse(JSON.stringify(r.operations).replace(/"inbox_list"/g, '"inbox"')); }), /states\.inbox_list is required/)).toBe(true);
    });

    it('requires a within state to have a container', () => {
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ click: { role: 'button', within: 'inbox_list' } }]; }), /no container/)).toBe(true);
    });

    it('rejects within inside has, and validates has recursively', () => {
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ click: { role: 'row', has: { role: 'button', within: 'compose_open' } } }]; }), /has.*within/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ click: { role: 'row', has: { name: 'x' } } }]; }), /role or css/)).toBe(true);
    });

    it('only allows known placeholders', () => {
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ fill: { role: 'textbox' }, value: '$password' }]; }), /\$password/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ click: { role: 'row', name: '$secret' } }]; }), /\$secret/)).toBe(true);
    });

    it('requires a field pattern with exactly one capture group', () => {
        const withPattern = (pattern: string) => errorsAfter((r) => {
            r.operations.search.steps = [{ extract: { fields: { a: { from: 'text', pattern, format: 'text', required: false } } }, as: 'x' }];
        });
        expect(anyMatches(withPattern('abc'), /one capture group/)).toBe(true);
        expect(anyMatches(withPattern('(a)(b)'), /one capture group/)).toBe(true);
        expect(withPattern('(?:x)(a)')).toEqual([]);
    });

    it('requires extract items to be each: true and a known field source and format', () => {
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ extract: { items: { css: 'tr' }, fields: {} }, as: 'x' }]; }), /each: true/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ extract: { fields: { a: { from: 'html' as never, format: 'text', required: true } } }, as: 'x' }]; }), /from/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ extract: { fields: { a: { from: 'text', format: 'number' as never, required: true } } }, as: 'x' }]; }), /format/)).toBe(true);
    });

    it('requires recipient chip targets to be each: true', () => {
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ verify_recipients: { to: { css: '.chip' }, from: 'text' } }]; }), /each: true/)).toBe(true);
    });

    it('allows only harmless keys, and a key that sends only as its own commit step', () => {
        expect(validateRoute((() => { const r = minimalRoute(); r.operations.search.steps = [{ goto: 'home' }, { press: 'ControlOrMeta+N', expect: 'inbox_list' }]; return r; })())).toEqual([]);
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ press: 'Delete' }]; }), /press "Delete" is not an allowed key/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ press: 'e' }]; }), /not an allowed key/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ press: 'Control+Enter' }]; }), /sends, so it must be marked "commits": true/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.search.steps = [{ press: 'Tab', commits: true }]; }), /only a key that sends/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.compose_send.steps[1] = { type: { role: 'combobox', name: 'To', within: 'compose_open' }, value: '$draft.to', then_press: 'Control+Enter' }; }), /then_press.*sends/)).toBe(true);
        // A send shortcut marked as the commit step counts as the commit: test_end is then required.
        const keyboardSend = minimalRoute();
        keyboardSend.operations.compose_send.steps[4] = { press: 'ControlOrMeta+Enter', commits: true, expect: 'inbox_list' };
        expect(validateRoute(keyboardSend)).toEqual([]);
        delete keyboardSend.operations.compose_send.test_end;
        expect(anyMatches(validateRoute(keyboardSend), /test_end/)).toBe(true);
    });

    it('only lets discard_draft discard after checking the draft contains the marker', () => {
        expect(anyMatches(errorsAfter((r) => { r.operations.discard_draft.steps.splice(1, 1); }), /verify_text step with "contains": "\$marker"/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => {
            const step = r.operations.discard_draft.steps[1]!;
            if ('verify_text' in step) step.verify_text.contains = 'Route check';
        }), /verify_text step with "contains": "\$marker"/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.discard_draft.steps = [{ goto: 'home' }]; }), /must have a commit step/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => {
            const step = r.operations.discard_draft.steps[1]!;
            if ('verify_text' in step) (step.verify_text as unknown as Record<string, unknown>).regex = 'x';
        }), /verify_text has unknown key "regex"/)).toBe(true);
    });

    it('requires test_end on an operation that commits, without a commit step in it', () => {
        expect(anyMatches(errorsAfter((r) => { delete r.operations.compose_send.test_end; }), /test_end/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { r.operations.compose_send.test_end = [{ click: { role: 'button', name: 'Send' }, commits: true }]; }), /test_end.*commit/)).toBe(true);
    });

    it('rejects executable-looking keys anywhere', () => {
        expect(anyMatches(errorsAfter((r) => { (r.states.inbox_list as unknown as Record<string, unknown>).script = 'alert(1)'; }), /forbidden key "script"/)).toBe(true);
        expect(anyMatches(errorsAfter((r) => { (r as unknown as Record<string, unknown>).eval = 1; }), /forbidden key "eval"/)).toBe(true);
    });

    it('rejects routes over 64KB', () => {
        expect(anyMatches(errorsAfter((r) => { r.learned_by = 'x'.repeat(70_000); }), /64KB/)).toBe(true);
    });
});

describe('assertValidRoute', () => {
    it('returns the route when valid and throws listing every problem when not', () => {
        const route = minimalRoute();
        expect(assertValidRoute(route)).toBe(route);
        route.route_version = 'bad';
        route.domains = [];
        expect(() => assertValidRoute(route)).toThrow(RouteValidationError);
        try {
            assertValidRoute(route);
        } catch (error) {
            expect((error as RouteValidationError).problems.length).toBeGreaterThanOrEqual(2);
        }
    });
});
