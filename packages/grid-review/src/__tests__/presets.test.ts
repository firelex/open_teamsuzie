import { describe, expect, it } from 'vitest';
import { ColumnPresetRegistry, type ColumnPreset } from '../presets.js';

const GOVERNING_LAW: ColumnPreset = {
    id: 'governing-law',
    match: 'governing law',
    prompt: 'What is the governing law?',
    format: 'short_text',
};

const TERMINATION: ColumnPreset = {
    id: 'termination',
    match: /\btermination\b/i,
    prompt: 'How may this agreement be terminated?',
    format: 'text',
};

const TERMINATION_NOTICE: ColumnPreset = {
    id: 'termination-notice',
    match: /termination notice/i,
    prompt: 'How many days notice are required for termination?',
    format: 'short_text',
};

describe('ColumnPresetRegistry', () => {
    it('returns null on an empty registry', () => {
        const registry = new ColumnPresetRegistry();
        expect(registry.match('Governing law')).toBeNull();
    });

    it('returns null for empty / whitespace titles', () => {
        const registry = new ColumnPresetRegistry();
        registry.register(GOVERNING_LAW);
        expect(registry.match('')).toBeNull();
        expect(registry.match('   ')).toBeNull();
        // @ts-expect-error - defensive against bad input
        expect(registry.match(undefined)).toBeNull();
    });

    it('matches a string preset case-insensitively as a substring', () => {
        const registry = new ColumnPresetRegistry().register(GOVERNING_LAW);
        expect(registry.match('Governing law')?.id).toBe('governing-law');
        expect(registry.match('GOVERNING LAW')?.id).toBe('governing-law');
        expect(registry.match('Choice of governing law clause')?.id).toBe('governing-law');
    });

    it('matches a RegExp preset using its own flags', () => {
        const registry = new ColumnPresetRegistry().register(TERMINATION);
        expect(registry.match('Termination')?.id).toBe('termination');
        expect(registry.match('termination clauses')?.id).toBe('termination');
        // \b boundaries should reject substrings inside other words
        expect(registry.match('Subterminationation')).toBeNull();
    });

    it('returns null when nothing matches', () => {
        const registry = new ColumnPresetRegistry()
            .register(GOVERNING_LAW)
            .register(TERMINATION);
        expect(registry.match('Force majeure')).toBeNull();
    });

    it('first registered match wins (registration order matters)', () => {
        const registry = new ColumnPresetRegistry()
            .register(TERMINATION_NOTICE)
            .register(TERMINATION);
        // "Termination notice (days)" matches both — the more specific one
        // is registered first, so it should win.
        const match = registry.match('Termination notice (days)');
        expect(match?.id).toBe('termination-notice');
    });

    it('falls back to a less specific preset when the specific one misses', () => {
        const registry = new ColumnPresetRegistry()
            .register(TERMINATION_NOTICE)
            .register(TERMINATION);
        const match = registry.match('Termination clauses');
        expect(match?.id).toBe('termination');
    });

    it('supports bulk registration via registerAll', () => {
        const registry = new ColumnPresetRegistry();
        registry.registerAll([GOVERNING_LAW, TERMINATION]);
        expect(registry.list()).toHaveLength(2);
        expect(registry.match('Governing law')?.id).toBe('governing-law');
    });

    it('list returns presets in registration order, isolated from internal state', () => {
        const registry = new ColumnPresetRegistry()
            .register(GOVERNING_LAW)
            .register(TERMINATION);
        const snapshot = registry.list();
        expect(snapshot.map((p) => p.id)).toEqual([
            'governing-law',
            'termination',
        ]);
        // Mutating the snapshot must not affect the registry's internals.
        snapshot.pop();
        expect(registry.list()).toHaveLength(2);
    });

    it('clear empties the registry', () => {
        const registry = new ColumnPresetRegistry()
            .register(GOVERNING_LAW)
            .register(TERMINATION);
        registry.clear();
        expect(registry.list()).toEqual([]);
        expect(registry.match('Governing law')).toBeNull();
    });
});
