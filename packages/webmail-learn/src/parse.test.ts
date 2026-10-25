import { describe, expect, it } from 'vitest';
import { minimalRoute } from '@teamsuzie/webmail-routes';
import { applyRepair, parseRepair, RepairParseError } from './parse.js';
import { buildRepairPrompt } from './prompt.js';

describe('parseRepair', () => {
    const reply = { steps: [{ goto: 'home' }], states: { s: { visible: [{ role: 'main' }] } }, notes: 'Renamed.' };

    it('reads a plain JSON reply', () => {
        expect(parseRepair(JSON.stringify(reply))).toEqual(reply);
    });

    it('reads a reply in a json fence with text around it', () => {
        expect(parseRepair(`Here you go:\n\`\`\`json\n${JSON.stringify(reply)}\n\`\`\`\nDone.`).notes).toBe('Renamed.');
    });

    it('treats missing states and notes as none', () => {
        expect(parseRepair('{"steps":[{"goto":"home"}]}')).toEqual({ steps: [{ goto: 'home' }], states: {}, notes: '' });
    });

    it.each([
        ['prose', 'I think you should click the button.', /did not contain a JSON object/],
        ['broken JSON', '{"steps": [', /did not contain a JSON object|not valid JSON/],
        ['no steps', '{"notes": "x"}', /"steps" must be a non-empty array/],
        ['unknown key', '{"steps": [{"goto":"home"}], "script": "x"}', /unexpected key "script"/],
        ['bad test_end', '{"steps": [{"goto":"home"}], "test_end": {}}', /"test_end" must be an array/],
    ])('rejects %s', (_name, text, message) => {
        expect(() => parseRepair(text)).toThrow(RepairParseError);
        expect(() => parseRepair(text)).toThrow(message);
    });
});

describe('applyRepair', () => {
    it('replaces only the operation and upserts the given states', () => {
        const route = minimalRoute();
        const next = applyRepair(route, 'search', { steps: [{ press: 'Enter' }], states: { inbox_list: { visible: [{ role: 'main' }] }, extra: { visible: [{ role: 'grid' }] } }, notes: '' });
        expect(next.operations.search).toEqual({ steps: [{ press: 'Enter' }] });
        expect(next.operations.compose_send).toEqual(route.operations.compose_send);
        expect(next.states.inbox_list).toEqual({ visible: [{ role: 'main' }] });
        expect(next.states.extra).toBeDefined();
        expect(next.states.compose_open).toEqual(route.states.compose_open);
        expect(route.operations.search.steps).toEqual([{ goto: 'home', expect: 'inbox_list' }]);
    });
});

describe('buildRepairPrompt', () => {
    it('is self-contained: goal, failure, steps, states, page and earlier problems', () => {
        const prompt = buildRepairPrompt({
            route: minimalRoute(),
            operation: 'compose_send',
            goal: 'Start a new message and send it.',
            outputs: 'This operation returns nothing.',
            failure: { code: 'target_not_found', phase: 'steps', stepIndex: 0, message: 'no visible element matches {"role":"button","name":"Compose"}', evidence: ['visible button: <button> text "New message" inside toolbar "Actions"'] },
            capture: { url: 'https://mail.example.com/#inbox', aria: '- button "New message"', unnamed: ['<div tabindex="0">'], outline: '<div role="option" data-key="m1">' },
            previousProblems: ['The reply was not valid JSON: Unexpected end'],
        });
        expect(prompt).toContain('Start a new message and send it.');
        expect(prompt).toContain('step 0 of its "steps" list failed: no visible element on the page matched');
        expect(prompt).toContain('- button "New message"');
        expect(prompt).toContain('- visible button: <button> text "New message" inside toolbar "Actions"');
        expect(prompt).toContain('<div tabindex="0">');
        expect(prompt).toContain('"compose_open"');
        expect(prompt).toContain('1. The reply was not valid JSON');
        expect(prompt).toContain('$draft.to');
        expect(prompt).toContain('mail.example.com');
        expect(prompt).not.toMatch(/undefined|\[object Object\]/);
    });
});
