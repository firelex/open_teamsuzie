import type { Locator, Page } from 'playwright-core';
import {
    stepAction, substitute,
    type ExtractSpec, type FieldSpec, type OperationName, type Params, type RecipientCheck, type Route, type Step,
} from '@teamsuzie/webmail-routes';
import type { Behaviour } from './behaviour.js';
import { NavigationError, NeedsLoginError, RouteError } from './errors.js';
import { applyPattern, emailsIn, normalizeField, readSource } from './extract.js';
import { locatorIn, resolveAll, resolveOne, stateHoldsNow, type LocateContext } from './locate.js';

export interface ExecutorOptions {
    page: Page;
    behaviour: Behaviour;
    /** How long a target may take to appear. */
    stepTimeoutMs: number;
    /** How long an `expect` / `wait_for` state may take to hold. */
    stateTimeoutMs: number;
    /** How long a `goto` may take to load. */
    navigationTimeoutMs: number;
}

export interface StepRecord {
    phase: 'steps' | 'test_end';
    index: number;
    action: string;
    ms: number;
}

export interface OperationResult {
    /** Each `extract` step's result under its `as` name: one record, or a list of records. */
    extracted: Record<string, ExtractedRecord | ExtractedRecord[]>;
    steps: StepRecord[];
}

export type ExtractedRecord = Record<string, string | null>;

/** `live` runs every step. `test` stops before a commit step (Send) and runs `test_end` instead. */
export type RunMode = 'live' | 'test';

const STATE_POLL_MS = 150;

/** Runs a route's operations on one page, exactly as written: no alternative targets, no guessing. */
export class RouteExecutor {
    constructor(private readonly opts: ExecutorOptions) {}

    get page(): Page {
        return this.opts.page;
    }

    async run(route: Route, operation: OperationName, params: Params, mode: RunMode): Promise<OperationResult> {
        const op = route.operations[operation];
        const result: OperationResult = { extracted: {}, steps: [] };
        await this.runSteps(route, operation, op.steps, 'steps', params, mode, result);
        if (mode === 'test' && op.test_end) {
            await this.runSteps(route, operation, op.test_end, 'test_end', params, mode, result);
        }
        return result;
    }

    /** True when `state` holds on the page right now. */
    async stateHolds(route: Route, state: string, params: Params = {}): Promise<boolean> {
        const definition = route.states[state];
        if (!definition) throw new Error(`Route has no state "${state}"`);
        return stateHoldsNow(definition, this.ctx(route, 'state', -1, 'steps', params));
    }

    /** Throws NeedsLoginError when the page is on one of the provider's sign-in hosts. */
    checkSignedIn(route: Route): void {
        const url = this.opts.page.url();
        if (!url.startsWith('http')) return;
        const host = new URL(url).hostname;
        if (route.login_domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
            throw new NeedsLoginError(`The ${route.provider} account is signed out: the page went to ${host}`);
        }
    }

    private async runSteps(
        route: Route, operation: OperationName, steps: Step[], phase: 'steps' | 'test_end',
        params: Params, mode: RunMode, result: OperationResult,
    ): Promise<void> {
        for (let index = 0; index < steps.length; index++) {
            const step = steps[index]!;
            if (mode === 'test' && phase === 'steps' && 'click' in step && step.commits === true) return;
            if (index > 0 || phase === 'test_end') await this.opts.behaviour.betweenSteps();
            this.checkSignedIn(route);
            const started = Date.now();
            const ctx = this.ctx(route, operation, index, phase, params);
            await this.runStep(route, step, ctx, result);
            if ('expect' in step && step.expect !== undefined) await this.waitForState(route, step.expect, ctx);
            this.checkSignedIn(route);
            result.steps.push({ phase, index, action: stepAction(step), ms: Date.now() - started });
        }
    }

    private ctx(route: Route, operation: string, stepIndex: number, phase: 'steps' | 'test_end', params: Params): LocateContext {
        return {
            page: this.opts.page,
            states: route.states,
            params,
            timeoutMs: this.opts.stepTimeoutMs,
            operation,
            stepIndex,
            phase,
        };
    }

    private async runStep(route: Route, step: Step, ctx: LocateContext, result: OperationResult): Promise<void> {
        const { page, behaviour } = this.opts;
        if ('goto' in step) {
            await this.goto(route, step.goto === 'home' ? route.home_url : substitute(step.goto, ctx.params, 'url'));
        } else if ('click' in step) {
            await behaviour.click(page, await resolveOne(step.click, ctx));
        } else if ('fill' in step) {
            await behaviour.clearAndType(page, await resolveOne(step.fill, ctx), substitute(step.value, ctx.params, 'none'));
        } else if ('type' in step) {
            const value = substitute(step.value, ctx.params, 'none');
            const parts = step.each_address ? value.split(/[,;]/).map((p) => p.trim()).filter((p) => p.length > 0) : [value];
            for (const part of parts) {
                await behaviour.typeText(page, await resolveOne(step.type, ctx), part);
                if (step.then_press !== undefined) await behaviour.press(page, step.then_press);
            }
        } else if ('press' in step) {
            await behaviour.press(page, step.press);
        } else if ('scroll' in step) {
            await behaviour.scroll(page, step.scroll === 'page' ? null : await resolveOne(step.scroll, ctx));
        } else if ('wait_for' in step) {
            await this.waitForState(route, step.wait_for, ctx);
        } else if ('extract' in step) {
            result.extracted[step.as] = await this.extract(step.extract, ctx);
        } else if ('verify_recipients' in step) {
            await this.verifyRecipients(step.verify_recipients, ctx);
        } else {
            throw new Error(`Unknown step: ${JSON.stringify(step)}`);
        }
    }

    private async goto(route: Route, url: string): Promise<void> {
        const host = new URL(url).hostname;
        if (!route.domains.includes(host)) throw new Error(`Refusing to visit ${host}: not one of the route's domains`);
        try {
            await this.opts.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.opts.navigationTimeoutMs });
        } catch (error) {
            throw new NavigationError(`Could not load ${url}: ${(error as Error).message}`);
        }
    }

    private async waitForState(route: Route, name: string, ctx: LocateContext): Promise<void> {
        const state = route.states[name];
        if (!state) throw new Error(`Route has no state "${name}"`);
        const deadline = Date.now() + this.opts.stateTimeoutMs;
        for (;;) {
            this.checkSignedIn(route);
            if (await stateHoldsNow(state, ctx)) return;
            if (Date.now() >= deadline) break;
            await new Promise((r) => setTimeout(r, STATE_POLL_MS));
        }
        throw new RouteError('state_not_reached', ctx.operation, ctx.stepIndex, `state "${name}" did not hold within ${this.opts.stateTimeoutMs}ms (url ${this.opts.page.url()})`, ctx.phase);
    }

    private async extract(spec: ExtractSpec, ctx: LocateContext): Promise<ExtractedRecord | ExtractedRecord[]> {
        if (spec.items === undefined) return this.readRecord(null, spec.fields, ctx);
        const items = await resolveAll(spec.items, ctx);
        const records: ExtractedRecord[] = [];
        for (let i = 0; i < items.length; i++) records.push(await this.readRecord(items[i]!, spec.fields, ctx, i));
        return records;
    }

    /** One record: each field read from `item` (or the page when `item` is null). */
    private async readRecord(item: Locator | null, fields: Record<string, FieldSpec>, ctx: LocateContext, itemIndex?: number): Promise<ExtractedRecord> {
        const record: ExtractedRecord = {};
        const where = itemIndex === undefined ? '' : ` in item ${itemIndex}`;
        for (const [name, field] of Object.entries(fields)) {
            const element = await this.fieldElement(item, name, field, ctx, where);
            const raw = element === null ? null : await readSource(element, field.from);
            const value = normalizeField(applyPattern(raw, field.pattern), field);
            if (value === null && field.required) {
                throw new RouteError('extract_invalid', ctx.operation, ctx.stepIndex, `required field "${name}"${where} is ${raw === null ? 'missing' : `not a valid ${field.format}: ${JSON.stringify(raw.slice(0, 120))}`}`, ctx.phase);
            }
            record[name] = value;
        }
        return record;
    }

    private async fieldElement(item: Locator | null, name: string, field: FieldSpec, ctx: LocateContext, where: string): Promise<Locator | null> {
        if (field.target === undefined) {
            if (item === null) throw new Error(`Field "${name}" has no target and is not inside an item`);
            return item;
        }
        if (item === null || field.target.within !== undefined) {
            if (field.required) return resolveOne(field.target, ctx);
            const all = await resolveAll(field.target, ctx);
            if (all.length > 1) throw new RouteError('target_ambiguous', ctx.operation, ctx.stepIndex, `field "${name}" matches ${all.length} elements`, ctx.phase);
            return all[0] ?? null;
        }
        const matches = await locatorIn(item, field.target, ctx.params).all();
        if (matches.length > 1) {
            throw new RouteError('extract_invalid', ctx.operation, ctx.stepIndex, `field "${name}"${where} matches ${matches.length} elements`, ctx.phase);
        }
        return matches[0] ?? null;
    }

    private async verifyRecipients(check: RecipientCheck, ctx: LocateContext): Promise<void> {
        const problems: string[] = [];
        for (const kind of ['to', 'cc', 'bcc'] as const) {
            const expected = [...new Set(emailsIn(ctx.params[`$draft.${kind}`] ?? ''))].sort();
            const target = check[kind];
            if (target === undefined) {
                if (expected.length > 0) problems.push(`${kind}: the route cannot read ${kind} recipients but the draft has ${expected.join(', ')}`);
                continue;
            }
            const shown: string[] = [];
            for (const chip of await resolveAll(target, ctx)) shown.push(...emailsIn((await readSource(chip, check.from)) ?? ''));
            const unique = [...new Set(shown)].sort();
            if (unique.join(',') !== expected.join(',')) {
                problems.push(`${kind}: page shows [${unique.join(', ')}], draft has [${expected.join(', ')}]`);
            }
        }
        if (problems.length > 0) {
            throw new RouteError('recipients_mismatch', ctx.operation, ctx.stepIndex, problems.join('; '), ctx.phase);
        }
    }
}
