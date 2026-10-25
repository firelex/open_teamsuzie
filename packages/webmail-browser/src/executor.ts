import type { Locator, Page } from 'playwright-core';
import {
    stepAction, substitute,
    type ExtractSpec, type FieldSpec, type OperationName, type PageState, type Params, type RecipientCheck, type Route, type Step, type Target,
} from '@teamsuzie/webmail-routes';
import type { Behaviour } from './behaviour.js';
import type { DateContext } from './dates.js';
import { NavigationError, NeedsLoginError, RouteError, UnreadableValueError, type RoutePhase } from './errors.js';
import { applyPattern, emailsIn, normalizeField, readSource } from './extract.js';
import { describeElements, describeTarget, inspectTarget, locatorIn, resolveAll, resolveOne, stateHoldsNow, type LocateContext, type TargetReport } from './locate.js';

export interface ExecutorOptions {
    page: Page;
    behaviour: Behaviour;
    /** How long a target may take to appear. */
    stepTimeoutMs: number;
    /** How long an `expect` / `wait_for` state may take to hold. */
    stateTimeoutMs: number;
    /** How long a `goto` may take to load. */
    navigationTimeoutMs: number;
    /** How the account's webmail writes dates. */
    dates: DateContext;
}

export interface StepRecord {
    phase: RoutePhase;
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

/** The states a test_end works inside (its clicks' `within`): the open draft or reply it is meant to close. */
function draftStatesOf(testEnd: Step[]): string[] {
    return [...new Set(testEnd.flatMap((step) => ('click' in step && step.click.within ? [step.click.within] : [])))];
}

/** Why a required field has no value, in words a reader can act on. */
function fieldProblem(field: FieldSpec, found: boolean, raw: string | null, matched: string | null): string {
    const shown = (text: string) => JSON.stringify(text.length > 160 ? `${text.slice(0, 160)}…` : text);
    if (!found) return field.target ? `no element inside matches its target ${describeTarget(field.target)}` : 'the item itself could not be read';
    if (raw === null) return `the element has no ${field.from.slice('attr:'.length)} attribute`;
    if (field.pattern !== undefined && matched === null) return `the pattern ${JSON.stringify(field.pattern)} did not match the ${field.from === 'text' ? 'text' : field.from} ${shown(raw)}`;
    return `${shown(matched ?? raw)} is not a valid ${field.format}`;
}

/** `live` runs every step. `test` stops before a commit step (Send) and runs `test_end` instead. */
export type RunMode = 'live' | 'test';

const STATE_POLL_MS = 150;

/** Runs a route's operations on one page, exactly as written: no alternative targets, no guessing. */
export class RouteExecutor {
    constructor(private readonly opts: ExecutorOptions) {}

    get page(): Page {
        return this.opts.page;
    }

    /**
     * Run one operation. Every operation starts from a clean inbox: any draft or reply left open is discarded with
     * the route's own discard steps, then the inbox is loaded and must show (see `startFromInbox`).
     */
    async run(route: Route, operation: OperationName, params: Params, mode: RunMode): Promise<OperationResult> {
        const op = route.operations[operation];
        const result: OperationResult = { extracted: {}, steps: [] };
        await this.startFromInbox(route, operation);
        await this.runSteps(route, operation, op.steps, 'steps', params, mode, result);
        if (mode === 'test' && op.test_end) {
            await this.runSteps(route, operation, op.test_end, 'test_end', params, mode, result);
            await this.checkClosed(route, operation, op.test_end);
        }
        return result;
    }

    /**
     * After test_end, the draft it was meant to close must be gone: every state its steps work `within` must stop
     * holding. Otherwise the discard did not work, and the next operation would start with a draft still open.
     */
    private async checkClosed(route: Route, operation: OperationName, testEnd: Step[]): Promise<void> {
        const deadline = Date.now() + this.opts.stateTimeoutMs;
        for (const state of draftStatesOf(testEnd)) {
            while (await this.stateHolds(route, state)) {
                if (Date.now() >= deadline) {
                    throw new RouteError('cleanup_failed', operation, testEnd.length - 1, `after the test_end steps ran, state "${state}" still holds: the draft or reply was not closed, so the discard steps do not work`, 'test_end');
                }
                await new Promise((r) => setTimeout(r, STATE_POLL_MS));
            }
        }
    }

    /**
     * Get back to a clean inbox: discard every draft or reply that is open (any state named by the `within` of a
     * commit operation's test_end steps that holds now), load `home_url`, and wait for the `inbox_list` state.
     * Failures are route errors of `operation` in phase `start`.
     */
    async startFromInbox(route: Route, operation: OperationName): Promise<void> {
        await this.discardOpenDrafts(route);
        this.checkSignedIn(route);
        await this.goto(route, route.home_url);
        const ctx = this.ctx(route, operation, -1, 'start', {});
        await this.waitForState(route, 'inbox_list', ctx);
        this.checkSignedIn(route);
    }

    /** Discard open drafts and replies, using the discard steps (test_end) of the operations that send. */
    private async discardOpenDrafts(route: Route): Promise<void> {
        for (const [name, op] of Object.entries(route.operations) as Array<[OperationName, Route['operations'][OperationName]]>) {
            if (!op.test_end || !op.steps.some((step) => 'click' in step && step.commits === true)) continue;
            for (const state of draftStatesOf(op.test_end)) {
                if (!(await this.stateHolds(route, state))) continue;
                const result: OperationResult = { extracted: {}, steps: [] };
                await this.runSteps(route, name, op.test_end, 'test_end', {}, 'test', result);
            }
        }
    }

    /**
     * The webmail's own list of keyboard shortcuts: from a clean inbox, press "?" (Outlook and Gmail open their
     * shortcut reference with it), read the text of any dialog that opens, then press Escape and return to a clean
     * inbox. Returns null when nothing opened.
     */
    async readShortcutHelp(route: Route, operation: OperationName): Promise<string | null> {
        await this.startFromInbox(route, operation);
        await this.opts.behaviour.press(this.opts.page, '?');
        const deadline = Date.now() + this.opts.stepTimeoutMs;
        let text: string | null = null;
        while (Date.now() < deadline && text === null) {
            text = await this.opts.page.evaluate(() => {
                const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
                    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 50 && r.height > 50; });
                const found = dialogs.map((el) => ((el as HTMLElement).innerText ?? '').replace(/[ \t]+/g, ' ').trim()).filter((t) => t.length > 0);
                return found.length > 0 ? found.join('\n---\n') : null;
            });
            if (text === null) await new Promise((r) => setTimeout(r, STATE_POLL_MS));
        }
        await this.opts.behaviour.press(this.opts.page, 'Escape');
        await this.startFromInbox(route, operation);
        return text;
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
        route: Route, operation: OperationName, steps: Step[], phase: RoutePhase,
        params: Params, mode: RunMode, result: OperationResult,
    ): Promise<void> {
        for (let index = 0; index < steps.length; index++) {
            const step = steps[index]!;
            // The commit step (Send, by click or by key) is never run in test mode.
            if (mode === 'test' && phase === 'steps' && ('click' in step || 'press' in step) && step.commits === true) return;
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

    private ctx(route: Route, operation: string, stepIndex: number, phase: RoutePhase, params: Params): LocateContext {
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
        const report = await this.stateReport(state, ctx);
        const url = this.opts.page.url();
        const reasons = report.reasons;
        const evidence = report.evidence;
        const when = ctx.phase === 'start' ? 'after loading the inbox at the start of the operation, ' : '';
        throw new RouteError('state_not_reached', ctx.operation, ctx.stepIndex, `${when}state "${name}" did not hold within ${this.opts.stateTimeoutMs}ms: ${reasons.join('; ') || 'it held only briefly'} (url ${url})`, ctx.phase, evidence);
    }

    /** Whether a state holds right now, and if not, which of its parts fail and what is on the page instead. */
    private async stateReport(state: PageState, ctx: LocateContext): Promise<{ holds: boolean; reasons: string[]; evidence: string[] }> {
        const url = this.opts.page.url();
        const reasons: string[] = [];
        if (state.url_matches !== undefined && !new RegExp(state.url_matches).test(url)) reasons.push(`the url ${url} does not match ${state.url_matches}`);
        const evidence: string[] = [];
        for (const target of state.visible) {
            const report = await inspectTarget(target, ctx);
            if (report.matches === 1 && report.problem === undefined) continue;
            reasons.push(report.problem ?? `${describeTarget(target)} matches ${report.matches} visible elements, not exactly one`);
            evidence.push(...report.elements);
        }
        return { holds: reasons.length === 0, reasons, evidence };
    }

    /** Check a state, named in the route or given in full, without waiting. For testing a state before using it. */
    async inspectState(route: Route, state: string | PageState, params: Params = {}): Promise<{ holds: boolean; reasons: string[]; evidence: string[] }> {
        const definition = typeof state === 'string' ? route.states[state] : state;
        if (!definition) throw new Error(`Route has no state "${String(state)}"`);
        return this.stateReport(definition, this.ctx(route, 'inspect', -1, 'steps', params));
    }

    /** What a target matches right now, without waiting. */
    inspectTarget(route: Route, target: Target, params: Params = {}): Promise<TargetReport> {
        return inspectTarget(target, this.ctx(route, 'inspect', -1, 'steps', params));
    }

    /** Run one extract step on the page as it is now. Route errors are thrown as in a real run. */
    tryExtract(route: Route, spec: ExtractSpec, params: Params = {}): Promise<ExtractedRecord | ExtractedRecord[]> {
        return this.extract(spec, this.ctx(route, 'inspect', -1, 'steps', params));
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
            const matched = applyPattern(raw, field.pattern);
            const value = normalizeField(matched, field, this.opts.dates);
            if (value === null && matched !== null && field.format === 'date') {
                // The element and its text were found; only the date reader cannot read it.
                throw new UnreadableValueError(ctx.operation, name, field.format, matched);
            }
            if (value === null && field.required) {
                const evidence = item !== null ? await describeElements(item, 1) : element !== null ? await describeElements(element, 1) : [];
                throw new RouteError('extract_invalid', ctx.operation, ctx.stepIndex, `required field "${name}"${where}: ${fieldProblem(field, element !== null, raw, matched)}`, ctx.phase, evidence.map((e) => (item !== null ? `the item: ${e}` : `the element: ${e}`)));
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
            if (all.length > 1) throw new RouteError('target_ambiguous', ctx.operation, ctx.stepIndex, `field "${name}": its target ${describeTarget(field.target)} matches ${all.length} elements, not one`, ctx.phase, await describeElements(locatorIn(this.opts.page, field.target, ctx.params)));
            return all[0] ?? null;
        }
        const inItem = locatorIn(item, field.target, ctx.params);
        const matches = await inItem.all();
        if (matches.length > 1) {
            throw new RouteError('extract_invalid', ctx.operation, ctx.stepIndex, `field "${name}"${where}: its target ${describeTarget(field.target)} matches ${matches.length} elements inside the item, not one`, ctx.phase, await describeElements(inItem));
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
