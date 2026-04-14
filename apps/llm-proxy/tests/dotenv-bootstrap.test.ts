/**
 * Regression test for a specific bug that cost hours:
 *
 *   `apps/llm-proxy/src/index.ts` was missing `import 'dotenv/config'`.
 *   Result: llm-proxy never loaded its `.env` file → INTERNAL_SERVICE_KEY
 *   was absent from process.env → llm-proxy skipped its self-sync call
 *   to admin on startup → provider keys were never (re)pushed after
 *   llm-proxy restarts → dashscope requests 502'd with "No API key
 *   configured for provider".
 *
 * This test is a static content check — it fails loudly if anyone
 * removes the dotenv import. It doesn't require running the service.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('llm-proxy bootstrap', () => {
    const indexPath = resolve(__dirname, '..', 'src', 'index.ts');

    it('src/index.ts loads dotenv before anything else', () => {
        const source = readFileSync(indexPath, 'utf-8');
        const firstImport = source
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l.startsWith('import '));
        expect(
            firstImport,
            'First import statement in llm-proxy/src/index.ts must be `import \'dotenv/config\';` — ' +
                'otherwise .env vars (INTERNAL_SERVICE_KEY, provider keys) are never loaded and the ' +
                'self-sync loop to admin silently fails after restarts.',
        ).toBe(`import 'dotenv/config';`);
    });

    it('src/index.ts references loadKeysFromEnv on startup', () => {
        // Defensive: the flow assumes env is loaded THEN keys are populated
        // from env. If loadKeysFromEnv is removed, keys never get their
        // fallback values.
        const source = readFileSync(indexPath, 'utf-8');
        expect(source).toContain('loadKeysFromEnv()');
    });

    it('src/index.ts triggers admin self-sync when INTERNAL_SERVICE_KEY is set', () => {
        // Defensive: the self-healing path depends on this block existing.
        // If someone removes it, drift returns.
        const source = readFileSync(indexPath, 'utf-8');
        expect(source).toContain('INTERNAL_SERVICE_KEY');
        expect(source).toContain('/api/internal/sync-proxy');
    });
});
