import type { Locator, Page } from 'playwright-core';
import { substitute, type PageState, type Params, type Target } from '@teamsuzie/webmail-routes';
import { RouteError, type RoutePhase } from './errors.js';

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
    phase: RoutePhase;
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
    try {
        return await resolveOne(state.container, ctx);
    } catch (error) {
        if (!(error instanceof RouteError)) throw error;
        throw new RouteError(
            error.code, ctx.operation, ctx.stepIndex,
            `the target ${describeTarget(target)} is searched inside the container of state "${target.within}", but that container ${error.code === 'target_ambiguous' ? 'matches more than one element' : 'is not on the page'}: ${error.detail}`,
            ctx.phase, error.evidence,
        );
    }
}

export function describeTarget(target: Target): string {
    return JSON.stringify(target);
}

const MAX_EVIDENCE = 10;
const MAX_CANDIDATES = 20;

/**
 * One line per element: its tag and describing attributes, its text, and the labelled regions it sits in, so a
 * reader can tell elements with the same role apart.
 */
export function describeElements(locator: Locator, max = MAX_EVIDENCE): Promise<string[]> {
    return locator.evaluateAll((elements, limit) => elements.slice(0, limit).map((el) => {
        const keep = /^(role|aria-label|aria-level|aria-selected|aria-expanded|aria-checked|title|name|type|class|href|placeholder|data-[\w-]+)$/;
        const attrs: string[] = [];
        for (const attr of Array.from(el.attributes)) {
            if (!keep.test(attr.name)) continue;
            const value = attr.name === 'class' ? attr.value.split(/\s+/).slice(0, 3).join(' ') : attr.value;
            attrs.push(`${attr.name}="${value.length > 60 ? `${value.slice(0, 60)}…` : value}"`);
        }
        const text = ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim();
        const regions: string[] = [];
        for (let up = el.parentElement; up && regions.length < 3; up = up.parentElement) {
            const role = up.getAttribute('role');
            const label = up.getAttribute('aria-label');
            if (role || label) regions.push(`${role ?? up.tagName.toLowerCase()}${label ? ` "${label.slice(0, 40)}"` : ''}`);
        }
        return `<${el.tagName.toLowerCase()}${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}>`
            + (text ? ` text "${text.length > 80 ? `${text.slice(0, 80)}…` : text}"` : ' (no text)')
            + (regions.length > 0 ? ` inside ${regions.join(' < ')}` : '');
    }), max);
}

/** Words of a target's name or name pattern, to rank candidates by how close their text is. */
function wantedWords(target: Target): string[] {
    const source = target.name ?? target.name_pattern ?? '';
    return source.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
}

/** When a target matched nothing: the nearest things that are on the page, to show what is there instead. */
async function candidatesFor(root: Root, target: Target, ctx: LocateContext): Promise<string[]> {
    const evidence: string[] = [];
    const selectedTabs = await describeElements(ctx.page.locator('[role="tab"][aria-selected="true"]').filter({ visible: true }), 5);
    if (selectedTabs.length > 0) evidence.push(...selectedTabs.map((l) => `selected tab (the page is showing this tab's controls): ${l}`));
    if (target.role !== undefined) {
        const sameRole = root.getByRole(target.role as AriaRole).filter({ visible: true });
        const lines = await describeElements(sameRole, 200);
        // Closest names first: elements sharing words with the wanted name, then the rest in page order.
        const words = wantedWords(target);
        const score = (line: string) => words.filter((w) => line.toLowerCase().includes(w)).length;
        const ranked = lines.map((line, i) => ({ line, i, score: score(line) })).sort((a, b) => b.score - a.score || a.i - b.i);
        const shown = ranked.slice(0, MAX_CANDIDATES).map((r) => `visible ${target.role}: ${r.line}`);
        if (lines.length > MAX_CANDIDATES) shown.push(`… and ${lines.length - MAX_CANDIDATES} more visible ${target.role} elements`);
        evidence.push(...(lines.length > 0 ? shown : [`no visible element has the role "${target.role}" here`]));
    }
    if (target.css !== undefined) {
        const css = root.locator(substitute(target.css, ctx.params, 'css'));
        const all = await css.count();
        const visible = await css.filter({ visible: true }).count();
        if (all > 0 && visible === 0) evidence.push(`${all} element(s) match the css "${target.css}" but none is visible`);
        else if (all === 0) evidence.push(`nothing on the page matches the css "${target.css}"`);
        else evidence.push(...(await describeElements(css.filter({ visible: true }))).map((l) => `matches the css alone: ${l}`));
    }
    if (target.has !== undefined) {
        const without = locatorIn(root, { ...target, has: undefined }, ctx.params);
        const lines = await describeElements(without);
        if (lines.length > 0) evidence.push(...lines.map((l) => `matches without the "has" condition: ${l}`));
    }
    return evidence;
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
        throw new RouteError('target_not_found', ctx.operation, ctx.stepIndex, `no visible element matches ${describeTarget(target)}`, ctx.phase, await candidatesFor(root, target, ctx));
    }
    if (count > 1) {
        throw new RouteError('target_ambiguous', ctx.operation, ctx.stepIndex, `${count} visible elements match ${describeTarget(target)}; the target must match exactly one (add "within", "has", a name or an attribute that tells them apart)`, ctx.phase, await describeElements(locator));
    }
    return locator;
}

export interface TargetReport {
    /** How many visible elements match. */
    matches: number;
    /** One line per match (up to ten), or, when nothing matched, the nearest candidates. */
    elements: string[];
    /** Set when the target could not be searched at all (for example its `within` container is missing). */
    problem?: string;
}

/** What `target` matches on the page right now, without waiting: for testing a target before using it. */
export async function inspectTarget(target: Target, ctx: LocateContext): Promise<TargetReport> {
    let root: Root;
    try {
        root = await rootFor(target, { ...ctx, timeoutMs: 0 });
    } catch (error) {
        if (error instanceof RouteError) return { matches: 0, elements: error.evidence, problem: error.detail };
        throw error;
    }
    const locator = locatorIn(root, target, ctx.params);
    const matches = await locator.count();
    return { matches, elements: matches > 0 ? await describeElements(locator) : await candidatesFor(root, target, ctx) };
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
