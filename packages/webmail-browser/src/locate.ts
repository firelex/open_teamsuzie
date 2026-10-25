import type { Locator, Page } from 'playwright-core';
import { substitute, type PageState, type Params, type Target } from '@teamsuzie/webmail-routes';
import { RouteError } from './errors.js';

type Root = Page | Locator;
type AriaRole = Parameters<Page['getByRole']>[0];

export interface LocateContext {
    page: Page;
    states: Record<string, PageState>;
    params: Params;
    timeoutMs: number;
    /** Where the target appears, for error messages. */
    operation: string;
    stepIndex: number;
    phase: 'steps' | 'test_end';
}

const POLL_MS = 100;

/** A locator for every visible element `target` describes, searched inside `root`. `within` is ignored here. */
export function locatorIn(root: Root, target: Target, params: Params): Locator {
    let locator: Locator;
    if (target.role !== undefined) {
        const options: { name?: string | RegExp; exact?: boolean } = {};
        if (target.name !== undefined) {
            options.name = substitute(target.name, params, 'none');
            options.exact = true;
        } else if (target.name_pattern !== undefined) {
            options.name = new RegExp(target.name_pattern, 'i');
        }
        locator = root.getByRole(target.role as AriaRole, options);
        if (target.css !== undefined) locator = locator.and(root.locator(substitute(target.css, params, 'css')));
    } else if (target.css !== undefined) {
        locator = root.locator(substitute(target.css, params, 'css'));
    } else {
        throw new Error('A target needs role or css');
    }
    if (target.has !== undefined) locator = locator.filter({ has: locatorIn(root, target.has, params) });
    return locator.filter({ visible: true });
}

/** The root a target is searched in: the page, or its `within` state's container (which must match exactly once). */
async function rootFor(target: Target, ctx: LocateContext): Promise<Root> {
    if (target.within === undefined) return ctx.page;
    const state = ctx.states[target.within];
    if (!state?.container) throw new Error(`State "${target.within}" has no container`);
    return resolveOne(state.container, ctx);
}

function describe(target: Target): string {
    return JSON.stringify(target);
}

/** The one visible element `target` matches. Waits up to the timeout for it to appear. */
export async function resolveOne(target: Target, ctx: LocateContext): Promise<Locator> {
    const root = await rootFor(target, ctx);
    const locator = locatorIn(root, target, ctx.params);
    const deadline = Date.now() + ctx.timeoutMs;
    let count = await locator.count();
    while (count === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        count = await locator.count();
    }
    if (count === 0) {
        throw new RouteError('target_not_found', ctx.operation, ctx.stepIndex, `no visible element matches ${describe(target)}`, ctx.phase);
    }
    if (count > 1) {
        throw new RouteError('target_ambiguous', ctx.operation, ctx.stepIndex, `${count} visible elements match ${describe(target)}`, ctx.phase);
    }
    return locator;
}

/** Every visible element `target` matches right now (possibly none). */
export async function resolveAll(target: Target, ctx: LocateContext): Promise<Locator[]> {
    const root = await rootFor(target, ctx);
    return locatorIn(root, target, ctx.params).all();
}

/** True when the state's URL pattern matches and each of its visible targets matches exactly one element. */
export async function stateHoldsNow(state: PageState, ctx: LocateContext): Promise<boolean> {
    if (state.url_matches !== undefined && !new RegExp(state.url_matches).test(ctx.page.url())) return false;
    for (const target of state.visible) {
        const root = target.within === undefined ? ctx.page : await containerNow(target.within, ctx);
        if (root === null) return false;
        if ((await locatorIn(root, target, ctx.params).count()) !== 1) return false;
    }
    return true;
}

async function containerNow(stateName: string, ctx: LocateContext): Promise<Locator | null> {
    const container = ctx.states[stateName]?.container;
    if (!container) throw new Error(`State "${stateName}" has no container`);
    const locator = locatorIn(ctx.page, container, ctx.params);
    return (await locator.count()) === 1 ? locator : null;
}
