import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertValidRoute, nextRouteVersion, type ProviderKey, type Route } from '@teamsuzie/webmail-routes';

/**
 * Routes on disk: `<dir>/<provider>/current.json` is the route in use; every version ever saved is kept in
 * `<dir>/<provider>/history/<version>.json` for audit and diffs. Old versions are never used automatically.
 */
export class FileRouteStore {
    constructor(private readonly dir: string) {}

    /** Write `route` as the current route only when the provider has none yet (a fresh install). */
    seed(route: Route): void {
        if (!existsSync(this.currentPath(route.provider))) this.save(route);
    }

    current(provider: ProviderKey): Route {
        const path = this.currentPath(provider);
        if (!existsSync(path)) throw new Error(`No ${provider} route at ${path}; seed it first`);
        return assertValidRoute(JSON.parse(readFileSync(path, 'utf8')));
    }

    save(route: Route): void {
        assertValidRoute(route);
        const providerDir = join(this.dir, route.provider);
        mkdirSync(join(providerDir, 'history'), { recursive: true });
        const text = `${JSON.stringify(route, null, 2)}\n`;
        writeFileSync(join(providerDir, 'history', `${route.route_version}.json`), text);
        const tmp = join(providerDir, 'current.json.tmp');
        writeFileSync(tmp, text);
        renameSync(tmp, this.currentPath(route.provider));
    }

    /**
     * When the current route was saved before some operations existed, add those operations from `seed` (with any
     * states they need that the route lacks) and save it as a new version. Returns the operations added.
     */
    addMissingOperations(seed: Route, now: Date): string[] {
        const path = this.currentPath(seed.provider);
        if (!existsSync(path)) throw new Error(`No ${seed.provider} route at ${path}; seed it first`);
        const route = JSON.parse(readFileSync(path, 'utf8')) as Route;
        const missing = (Object.keys(seed.operations) as Array<keyof Route['operations']>).filter((op) => route.operations[op] === undefined);
        if (missing.length === 0) return [];
        for (const op of missing) {
            route.operations[op] = structuredClone(seed.operations[op]);
            const text = JSON.stringify(seed.operations[op]);
            for (const [name, state] of Object.entries(seed.states)) {
                if (route.states[name] === undefined && text.includes(`"${name}"`)) route.states[name] = structuredClone(state);
            }
        }
        route.route_version = nextRouteVersion(route.route_version, now);
        this.save(route);
        return missing;
    }

    /** Saved versions, oldest first. */
    history(provider: ProviderKey): string[] {
        const dir = join(this.dir, provider, 'history');
        if (!existsSync(dir)) return [];
        return readdirSync(dir)
            .filter((f) => f.endsWith('.json'))
            .map((f) => f.slice(0, -'.json'.length))
            .sort((a, b) => {
                const [da, na] = a.split('.');
                const [db, nb] = b.split('.');
                return da === db ? Number(na) - Number(nb) : da!.localeCompare(db!);
            });
    }

    private currentPath(provider: ProviderKey): string {
        return join(this.dir, provider, 'current.json');
    }
}
