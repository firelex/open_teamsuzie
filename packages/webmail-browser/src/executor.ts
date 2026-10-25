import type { Locator, Page } from 'playwright-core';
import {
    stepAction, substitute,
    type ExtractSpec, type FieldSource, type FieldSpec, type Operation, type OperationName, type PageState, type Params, type RecipientCheck, type Route, type Step, type Target,
} from '@teamsuzie/webmail-routes';
import type { Behaviour } from './behaviour.js';
import type { DateContext } from './dates.js';
import { NavigationError, NeedsLoginError, RecipientsDifferError, RouteError, UnreadableValueError, type RoutePhase } from './errors.js';
import { applyPattern, emailsIn, normalizeField, readSource } from './extract.js';
import { describeElements, describeMarkup, describeTarget, inspectTarget, locatorIn, resolveAll, resolveOne, stateHoldsNow, type LocateContext, type TargetReport } from './locate.js';

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

/**
 * The states that hold while an operation's draft or reply is open: those used (as `within`) by its commit step, its
 * verify steps and its test_end. These only hold while a draft is open (unlike, say, "a message is open"), and they
 * still identify the draft when Send and discard are keyboard shortcuts.
 */
function draftStatesOf(op: Operation): string[] {
    const draftSteps: Step[] = [
        ...op.steps.filter((step) => ('click' in step || 'press' in step) && step.commits === true),
        ...op.steps.filter((step) => 'verify_recipients' in step || 'verify_text' in step),
        ...(op.test_end ?? []),
    ];
    const states = new Set<string>();
    for (const match of JSON.stringify(draftSteps).matchAll(/"within":"([^"]+)"/g)) states.add(match[1]!);
    return [...states];
}

/** True when the operation has a commit step (Send, by click or by key). */
function commits(op: Operation): boolean {
    return op.steps.some((step) => ('click' in step || 'press' in step) && step.commits === true);
}

/**
 * Everything a recipient field shows about its addresses: each piece of text kept apart (adjacent chips often have
 * no space between them, and reading them as one run would merge "a@x.comb@y.com"), plus the attribute values of
 * the field and everything inside it. A webmail may show a recipient as a name and keep the address only in an
 * attribute of the chip (a label or tooltip), so the text alone is not enough.
 */
async function readRecipientSource(el: Locator, from: FieldSource): Promise<string | null> {
    if (from !== 'text') return readSource(el, from);
    return el.evaluate((node) => {
        const pieces: string[] = [];
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        for (let current: Node | null = node; current; current = walker.nextNode()) {
            if (current instanceof Element) for (const attr of Array.from(current.attributes)) pieces.push(attr.value);
            else pieces.push(current.textContent ?? '');
        }
        return pieces.join(' ');
    });
}

/**
 * The name a suggestion shows next to `address`: its label without the address and the punctuation around it
 * ("Ann Lee - ann@x.com" and "Ann Lee <ann@x.com>" give "Ann Lee"). Null when it shows only the address.
 */
export function suggestionName(label: string, address: string): string | null {
    const index = label.toLowerCase().indexOf(address.toLowerCase());
    const rest = `${label.slice(0, index)} ${label.slice(index + address.length)}`;
    const name = rest.replace(/[\s\-–—<>()[\],;:"']+/g, ' ').trim();
    return name.length > 0 ? name : null;
}

/** The element a step acts on, if it has one. */
function stepTarget(step: Step): Target | null {
    if ('click' in step) return step.click;
    if ('fill' in step) return step.fill;
    if ('type' in step) return step.type;
    if ('scroll' in step && step.scroll !== 'page') return step.scroll;
    return null;
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
    /**
     * For this run: each address entered by picking a suggestion, and the name that suggestion showed with it (null
     * when it showed only the address). The recipient chip may show just that name.
     */
    private pickedRecipients = new Map<string, string | null>();

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
        this.pickedRecipients = new Map();
        await this.startFromInbox(route, operation);
        try {
            await this.runSteps(route, operation, op.steps, 'steps', params, mode, result);
        } catch (error) {
            // A failed run must not leave its draft behind (webmail saves drafts as you type, so every failed test
            // run would otherwise add one to the Drafts folder). If the draft or reply is open, run test_end now:
            // it discards the operation's own draft, or, after a failed verify_text, closes what was opened
            // untouched (so the next clean start does not discard it either).
            if ((error instanceof RouteError || error instanceof RecipientsDifferError) && op.test_end && (await this.draftOpen(route, op))) {
                try {
                    await this.runSteps(route, operation, op.test_end, 'test_end', params, 'test', { extracted: {}, steps: [] });
                } catch (cleanup) {
                    if (!(cleanup instanceof RouteError)) throw cleanup;
                    if (error instanceof RecipientsDifferError) throw cleanup;
                    throw new RouteError(error.code, error.operation, error.stepIndex, `${error.detail} (and closing the draft afterwards also failed: ${cleanup.message})`, error.phase, error.evidence);
                }
            }
            throw error;
        }
        if (mode === 'test' && op.test_end) {
            await this.runSteps(route, operation, op.test_end, 'test_end', params, mode, result);
            await this.checkClosed(route, operation, op);
        }
        return result;
    }

    /** True when one of the operation's draft states holds now: its draft or reply is open. */
    private async draftOpen(route: Route, op: Operation): Promise<boolean> {
        for (const state of draftStatesOf(op)) if (await this.stateHolds(route, state)) return true;
        return false;
    }

    /**
     * Before a later discard step: wait until either the draft is closed (true: nothing left to do) or the step can
     * run (false: its target is on the page, or it has none). If neither happens in time, returns false and the step
     * runs, failing with the usual "not found" evidence.
     */
    private async draftClosedBefore(route: Route, op: Operation, step: Step, ctx: LocateContext): Promise<boolean> {
        const target = stepTarget(step);
        const deadline = Date.now() + this.opts.stepTimeoutMs;
        for (;;) {
            if (!(await this.draftOpen(route, op))) return true;
            if (target === null || (await inspectTarget(target, ctx)).matches > 0) return false;
            if (Date.now() >= deadline) return false;
            await new Promise((r) => setTimeout(r, STATE_POLL_MS));
        }
    }

    /**
     * After test_end, the draft it was meant to close must be gone: every state its steps work `within` must stop
     * holding. Otherwise the discard did not work, and the next operation would start with a draft still open.
     */
    private async checkClosed(route: Route, operation: OperationName, op: Operation): Promise<void> {
        const testEnd = op.test_end ?? [];
        const deadline = Date.now() + this.opts.stateTimeoutMs;
        for (const state of draftStatesOf(op)) {
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
            if (!op.test_end || !commits(op)) continue;
            for (const state of draftStatesOf(op)) {
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
        // The help panel is whatever text appears after pressing "?" (it need not be marked as a dialog).
        const pageLines = () => this.opts.page.evaluate(() => (document.body.innerText ?? '').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter((l) => l.length > 0));
        const before = new Set(await pageLines());
        await this.opts.behaviour.press(this.opts.page, '?');
        const deadline = Date.now() + this.opts.stepTimeoutMs;
        let text: string | null = null;
        while (Date.now() < deadline && text === null) {
            const appeared = (await pageLines()).filter((line) => !before.has(line));
            if (appeared.length >= 3) text = appeared.join('\n');
            else await new Promise((r) => setTimeout(r, STATE_POLL_MS));
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
            // Discard steps end once the draft is closed. Some steps answer a confirmation that appears only some
            // of the time (Esc may discard at once, or first ask "Discard?"), so a later step runs only while the
            // draft is still open. Whether the draft really closed is checked afterwards (checkClosed).
            if (phase === 'test_end' && index > 0 && (await this.draftClosedBefore(route, route.operations[operation], step, ctx))) return;
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
            if (step.at === 'start') await behaviour.caretToStart(page, await resolveOne(step.type, ctx));
            for (const part of parts) {
                const field = await resolveOne(step.type, ctx);
                await behaviour.typeText(page, field, part);
                if (step.then_press !== undefined) await behaviour.press(page, step.then_press);
                if (step.pick_suggestion !== undefined) await this.pickSuggestion(field, step.pick_suggestion, part, ctx);
            }
        } else if ('press' in step) {
            await behaviour.press(page, step.press);
        } else if ('scroll' in step) {
            await behaviour.scroll(page, step.scroll === 'page' ? null : await resolveOne(step.scroll, ctx));
        } else if ('wait_for' in step) {
            await this.waitForState(route, step.wait_for, ctx);
        } else if ('extract' in step) {
            result.extracted[step.as] = await this.extract(step.extract, ctx);
        } else if ('verify_text' in step) {
            const check = step.verify_text;
            const element = await resolveOne(check.target, ctx);
            const text = (await readSource(element, check.from)) ?? '';
            const wanted = substitute(check.contains, ctx.params, 'none');
            if (!text.includes(wanted)) {
                throw new RouteError('verification_failed', ctx.operation, ctx.stepIndex, `${describeTarget(check.target)} shows ${JSON.stringify(text.length > 160 ? `${text.slice(0, 160)}…` : text)}, which does not contain ${JSON.stringify(wanted)}`, ctx.phase, await describeElements(element, 1));
            }
        } else if ('verify_recipients' in step) {
            await this.verifyRecipients(step.verify_recipients, ctx, result);
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

    /**
     * Compare the recipients the page shows with the requested ones. Without requested recipients (no $draft.to,
     * as in tests of a reply), only read them: they are returned under "recipients", and at least one To address
     * must be readable. Unreadable recipients are a route problem; readable but different ones are a
     * RecipientsDifferError (nothing is sent; the caller decides).
     */
    private async verifyRecipients(check: RecipientCheck, ctx: LocateContext, result: OperationResult): Promise<void> {
        const kinds = ['to', 'cc', 'bcc'] as const;
        const read = async () => {
            const shown = { to: [] as string[], cc: [] as string[], bcc: [] as string[] };
            for (const kind of kinds) {
                const target = check[kind];
                if (target === undefined) continue;
                const found: string[] = [];
                let fieldText = '';
                for (const chip of await resolveAll(target, ctx)) {
                    const source = (await readRecipientSource(chip, check.from)) ?? '';
                    found.push(...emailsIn(source));
                    fieldText += ` ${source.replace(/\s+/g, ' ')}`;
                }
                // An address picked from a suggestion counts as shown when its chip shows the suggestion's name.
                for (const [address, name] of this.pickedRecipients) {
                    if (name !== null && fieldText.toLowerCase().includes(name.toLowerCase())) found.push(address);
                }
                shown[kind] = [...new Set(found)].sort();
            }
            return shown;
        };
        const wanted = (kind: typeof kinds[number]) => [...new Set(emailsIn(ctx.params[`$draft.${kind}`] ?? ''))].sort().join(',');
        const settled = (shown: Awaited<ReturnType<typeof read>>) => ctx.params['$draft.to'] === undefined
            ? shown.to.length > 0
            : kinds.every((kind) => shown[kind].join(',') === wanted(kind));
        // Webmail turns a typed address into a recipient chip a moment after it is entered, and the field may be
        // briefly empty or half-drawn meanwhile: read until it shows what is expected or the step time runs out.
        const deadline = Date.now() + this.opts.stepTimeoutMs;
        let shown = await read();
        while (!settled(shown) && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, STATE_POLL_MS));
            shown = await read();
        }
        if (ctx.params['$draft.to'] === undefined) {
            if (shown.to.length === 0) {
                throw new RouteError('recipients_mismatch', ctx.operation, ctx.stepIndex, `no To recipient could be read from ${describeTarget(check.to)}`, ctx.phase, await this.recipientEvidence(check, ctx));
            }
            result.extracted.recipients = { to: shown.to.join(', '), cc: shown.cc.join(', '), bcc: shown.bcc.join(', ') };
            return;
        }
        const expected = { to: [] as string[], cc: [] as string[], bcc: [] as string[] };
        const unreadable: string[] = [];
        for (const kind of kinds) {
            expected[kind] = [...new Set(emailsIn(ctx.params[`$draft.${kind}`] ?? ''))].sort();
            if (expected[kind].length === 0) continue;
            if (check[kind] === undefined) unreadable.push(`the route cannot read ${kind} recipients but the draft has ${expected[kind].join(', ')}`);
            else if (shown[kind].length === 0) unreadable.push(`no ${kind} address could be read from ${describeTarget(check[kind]!)}, though the draft has ${expected[kind].join(', ')}`);
        }
        if (unreadable.length > 0) {
            throw new RouteError('recipients_mismatch', ctx.operation, ctx.stepIndex, unreadable.join('; '), ctx.phase, await this.recipientEvidence(check, ctx));
        }
        if (kinds.some((kind) => shown[kind].join(',') !== expected[kind].join(','))) {
            throw new RecipientsDifferError(ctx.operation, shown, expected);
        }
    }

    /**
     * After an address is typed into `field`: wait for the one suggestion whose label or text contains the address
     * (case does not matter), click it, and remember the name it shows with the address. Suggestions are searched
     * only inside the list the field itself names as its suggestion list (the standard aria-controls or aria-owns
     * attribute of a field with suggestions), so other things on the page that mention the address (such as inbox
     * rows) never count. `target` says which elements in that list are suggestions.
     */
    private async pickSuggestion(field: Locator, target: Target, address: string, ctx: LocateContext): Promise<void> {
        const wanted = address.toLowerCase();
        const deadline = Date.now() + this.opts.stepTimeoutMs;
        for (;;) {
            const listIds = await field.evaluate((node) => {
                // The field, or the element inside it that has focus, names its list.
                const owners = [node, ...(node.contains(document.activeElement) && document.activeElement !== node ? [document.activeElement!] : [])];
                return owners.flatMap((el) => `${el.getAttribute('aria-controls') ?? ''} ${el.getAttribute('aria-owns') ?? ''}`.split(/\s+/)).filter((id) => id.length > 0);
            });
            const candidates: Locator[] = [];
            for (const id of new Set(listIds)) {
                const list = this.opts.page.locator(`[id="${id.replace(/["\\]/g, (ch) => `\\${ch}`)}"]`);
                if ((await list.count()) === 1) candidates.push(...await locatorIn(list, target, ctx.params).all());
            }
            const matching: Array<{ el: Locator; label: string }> = [];
            for (const el of candidates) {
                // Its accessible label, or else its text: whichever of the two mentions the address.
                const sources = await el.evaluate((node) => [node.getAttribute('aria-label') ?? '', (node as HTMLElement).innerText ?? ''].map((t) => t.replace(/\s+/g, ' ').trim()));
                const label = sources.find((text) => text.toLowerCase().includes(wanted));
                if (label !== undefined) matching.push({ el, label });
            }
            if (matching.length > 1) {
                throw new RouteError('target_ambiguous', ctx.operation, ctx.stepIndex, `${matching.length} suggestions matching ${describeTarget(target)} mention ${address}; exactly one must`, ctx.phase, matching.map((m) => m.label));
            }
            if (matching.length === 1) {
                await this.opts.behaviour.click(this.opts.page, matching[0]!.el);
                this.pickedRecipients.set(wanted, suggestionName(matching[0]!.label, address));
                return;
            }
            if (Date.now() >= deadline) {
                if (listIds.length === 0) {
                    throw new RouteError('target_not_found', ctx.operation, ctx.stepIndex, `after typing ${address}, the field names no suggestion list (it has no aria-controls or aria-owns attribute), so no suggestion can be picked from it`, ctx.phase, await describeElements(field, 1));
                }
                const evidence = candidates.length > 0
                    ? await Promise.all(candidates.slice(0, 10).map(async (el) => (await describeElements(el, 1))[0] ?? ''))
                    : [`the field's suggestion list (id ${listIds.join(', ')}) has no visible element matching ${describeTarget(target)}`];
                throw new RouteError('target_not_found', ctx.operation, ctx.stepIndex, `no suggestion matching ${describeTarget(target)} in the field's suggestion list mentions ${address}`, ctx.phase, evidence);
            }
            await new Promise((r) => setTimeout(r, STATE_POLL_MS));
        }
    }

    /** What the To field held when no address could be read in it: each matching element and the markup inside it. */
    private async recipientEvidence(check: RecipientCheck, ctx: LocateContext): Promise<string[]> {
        const fields = await resolveAll(check.to, ctx);
        if (fields.length === 0) return [`nothing visible matches ${describeTarget(check.to)}`];
        const evidence: string[] = [];
        for (const field of fields.slice(0, 3)) evidence.push(...await describeElements(field, 1), ...(await describeMarkup(field, 1)).map((markup) => `markup inside:\n${markup}`));
        return evidence;
    }
}
