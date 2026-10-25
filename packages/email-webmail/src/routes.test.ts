import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateRoute, OPERATION_NAMES } from '@teamsuzie/webmail-routes';
import { OPERATION_GOALS, OPERATION_OUTPUTS } from './goals.js';
import { FileRouteStore } from './route-store.js';
import { SEED_ROUTES } from './routes/index.js';

let dir: string | null = null;
afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
});

describe('seed routes', () => {
    it.each(Object.entries(SEED_ROUTES))('%s is a valid route', (_provider, route) => {
        expect(validateRoute(route)).toEqual([]);
    });

    it.each(Object.entries(SEED_ROUTES))('%s extracts every required output field', (_provider, route) => {
        for (const operation of OPERATION_NAMES) {
            const output = OPERATION_OUTPUTS[operation];
            if (output === null) continue;
            const extract = route.operations[operation].steps.find((s) => 'extract' in s && s.as === output.as);
            if (!extract || !('extract' in extract)) throw new Error(`${operation} has no "${output.as}" extract step`);
            expect(Boolean(extract.extract.items), operation).toBe(output.list);
            for (const field of output.required) expect(extract.extract.fields[field], `${operation}.${field}`).toBeDefined();
        }
    });

    it('has a goal for every operation', () => {
        for (const operation of OPERATION_NAMES) expect(OPERATION_GOALS[operation].length).toBeGreaterThan(40);
    });
});

describe('FileRouteStore', () => {
    it('seeds once, saves versions to history and reads the current route', () => {
        dir = mkdtempSync(join(tmpdir(), 'routes-'));
        const store = new FileRouteStore(dir);
        expect(() => store.current('gmail')).toThrow(/No gmail route/);
        store.seed(SEED_ROUTES.gmail);
        expect(store.current('gmail').route_version).toBe('2026-10-25.1');
        store.save({ ...SEED_ROUTES.gmail, route_version: '2026-10-25.2', learned_by: 'learner:test' });
        store.seed(SEED_ROUTES.gmail);
        expect(store.current('gmail').route_version).toBe('2026-10-25.2');
        store.save({ ...SEED_ROUTES.gmail, route_version: '2026-10-25.10' });
        expect(store.history('gmail')).toEqual(['2026-10-25.1', '2026-10-25.2', '2026-10-25.10']);
    });

    it('refuses to save an invalid route', () => {
        dir = mkdtempSync(join(tmpdir(), 'routes-'));
        const store = new FileRouteStore(dir);
        expect(() => store.save({ ...SEED_ROUTES.gmail, route_version: 'nope' })).toThrow(/route_version/);
    });
});
