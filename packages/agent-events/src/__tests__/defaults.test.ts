import { describe, expect, it } from 'vitest';

import { defaultActionsFor, resolveActions } from '../defaults.js';
import type { AgentUpdate } from '../types.js';

function update(partial: Partial<AgentUpdate> & Pick<AgentUpdate, 'kind'>): AgentUpdate {
    return {
        subjectId: 'subj-1',
        summary: 'test',
        ...partial,
    };
}

describe('defaultActionsFor', () => {
    it('returns approve + ask_for_changes for result (no host-specific actions)', () => {
        const actions = defaultActionsFor(update({ kind: 'result' }));
        expect(actions.map((a) => a.intent)).toEqual(['approve', 'ask_for_changes']);
    });

    it('returns continue + replan for progress', () => {
        const actions = defaultActionsFor(update({ kind: 'progress' }));
        expect(actions.map((a) => a.intent)).toEqual(['continue', 'replan']);
    });

    it('returns replan for question', () => {
        const actions = defaultActionsFor(update({ kind: 'question' }));
        expect(actions.map((a) => a.intent)).toEqual(['replan']);
    });

    it('returns try-again continue + replan for error', () => {
        const actions = defaultActionsFor(update({ kind: 'error' }));
        expect(actions).toEqual([
            { id: 'continue', label: 'Try again', intent: 'continue' },
            { id: 'replan', label: 'Replan', intent: 'replan' },
        ]);
    });

    it('never includes host-specific intents like open_preview or push', () => {
        for (const kind of ['progress', 'question', 'result', 'error'] as const) {
            const intents = defaultActionsFor(update({ kind })).map((a) => a.intent);
            expect(intents).not.toContain('open_preview');
            expect(intents).not.toContain('push');
        }
    });
});

describe('resolveActions', () => {
    it('returns caller-provided actions when non-empty', () => {
        const custom = [{ id: 'x', label: 'Custom', intent: 'approve' as const }];
        const out = resolveActions(update({ kind: 'result', actions: custom }));
        expect(out).toBe(custom);
    });

    it('falls back to defaultActionsFor when actions is missing', () => {
        const out = resolveActions(update({ kind: 'progress' }));
        expect(out).toEqual(defaultActionsFor(update({ kind: 'progress' })));
    });

    it('falls back to defaultActionsFor when actions is empty', () => {
        const out = resolveActions(update({ kind: 'progress', actions: [] }));
        expect(out).toEqual(defaultActionsFor(update({ kind: 'progress' })));
    });
});
