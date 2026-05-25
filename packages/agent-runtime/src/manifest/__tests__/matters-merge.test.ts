import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest } from '../index.js';

let tmp: string;
beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'matters-merge-'));
});
afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
});

describe('mergeWithDefaults — manifest.matters passthrough', () => {
    it('keeps manifest.matters.label across the load → merge → read path', () => {
        // Regression: an earlier mergeWithDefaults dropped `matters`
        // entirely, which silently broke L1's label re-skinning and L3's
        // types[] support — the runtime always saw the default ("Matter"
        // / "Matters") because the field never landed in the merged
        // manifest.
        const p = join(tmp, 'agent.json');
        writeFileSync(
            p,
            JSON.stringify({
                name: 'Test',
                description: 'd',
                theme: { id: 'default' },
                persona: { id: 'p', systemPrompt: 's' },
                components: {
                    chat: true,
                    toolActivity: true,
                    approvals: false,
                    knowledgeBase: false,
                    files: false,
                    citations: false,
                    workspace: false,
                },
                modules: {},
                tools: [],
                matters: {
                    label: { singular: 'Deal', plural: 'Deals' },
                },
            }),
        );
        const m = loadManifest(p);
        expect(m.matters?.label).toEqual({
            singular: 'Deal',
            plural: 'Deals',
        });
    });

    it('keeps manifest.matters.types across the load → merge → read path', () => {
        const p = join(tmp, 'agent.json');
        writeFileSync(
            p,
            JSON.stringify({
                name: 'Test',
                description: 'd',
                theme: { id: 'default' },
                persona: { id: 'p', systemPrompt: 's' },
                components: {
                    chat: true,
                    toolActivity: true,
                    approvals: false,
                    knowledgeBase: false,
                    files: false,
                    citations: false,
                    workspace: false,
                },
                modules: {},
                tools: [],
                matters: {
                    types: [
                        {
                            id: 'litigation',
                            label: 'Litigation',
                            customFields: [
                                {
                                    key: 'jurisdiction',
                                    label: 'Jurisdiction',
                                    type: 'text',
                                    required: true,
                                },
                            ],
                        },
                    ],
                },
            }),
        );
        const m = loadManifest(p);
        expect(m.matters?.types).toHaveLength(1);
        expect(m.matters?.types?.[0]?.id).toBe('litigation');
        expect(m.matters?.types?.[0]?.customFields?.[0]?.key).toBe('jurisdiction');
    });
});
