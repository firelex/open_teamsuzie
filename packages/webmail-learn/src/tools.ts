import { RouteError, UnreadableValueError, type OperationResult, type RouteExecutor } from '@teamsuzie/webmail-browser';
import {
    validateRoute,
    type ExtractSpec, type OperationName, type PageState, type Params, type Route, type Step, type Target,
} from '@teamsuzie/webmail-routes';
import type { ToolCall, ToolDefinition } from './model.js';
import { applyRepair } from './parse.js';

const OBJECT = { type: 'object' } as const;
const STEPS = { type: 'array', items: OBJECT } as const;
const STATES = {
    type: 'object',
    description: 'States you are adding or changing, by name (each {"url_matches"?, "visible": [...], "container"?}). Targets and steps in this call can refer to them.',
} as const;

/** The tools the repairing model can call. Every tool only looks at the page or runs in test mode: nothing is sent. */
export const LEARNER_TOOLS: ToolDefinition[] = [
    {
        name: 'try_target',
        description: 'Find out what a target matches on the page as it is right now, without clicking anything. Returns how many visible elements match and a one-line description of each (tag, attributes, text, and the labelled regions it sits in), or, when nothing matches, the nearest candidates on the page. Use it to check a target before putting it in a step.',
        parameters: { type: 'object', properties: { target: { ...OBJECT, description: 'A target, as in the rules.' }, states: STATES }, required: ['target'] },
    },
    {
        name: 'check_state',
        description: 'Check whether a page state holds right now. Give the name of a state in the route, or a full state object you are proposing. Returns whether it holds and, if not, which part fails and what is on the page instead.',
        parameters: { type: 'object', properties: { state: { description: 'A state name, or a state object {"url_matches"?, "visible": [...], "container"?}.' }, states: STATES }, required: ['state'] },
    },
    {
        name: 'try_extract',
        description: 'Run an extract (the object that goes under "extract" in an extract step) on the page as it is right now, and see the first few records it reads, or the exact error (for example which field is missing, which pattern did not match which text). Use it to check fields before submitting.',
        parameters: { type: 'object', properties: { extract: { ...OBJECT, description: 'The extract object: {"items"?, "fields": {...}}.' }, states: STATES }, required: ['extract'] },
    },
    {
        name: 'run_operation',
        description: 'Run a complete candidate version of the task in test mode, from a clean inbox, exactly as the program would: it never presses the step marked "commits" and runs "test_end" instead, then checks the draft really closed. Where the task works on a message, it is run for two different messages, since it must work for any message. Returns success with what was read, or the exact failure with what was on the page. This changes the page (it clicks, types and discards), but sends nothing.',
        parameters: { type: 'object', properties: { steps: STEPS, test_end: STEPS, states: STATES }, required: ['steps'] },
    },
    {
        name: 'read_shortcut_help',
        description: 'Open the webmail\'s own list of keyboard shortcuts for this account (by pressing "?" on the inbox), return its text, and close it again. Shortcuts depend on the account\'s settings, so read them here instead of guessing. Some listed shortcuts are destructive (for example archive or delete) and are not allowed in steps; only the allowed keys in the rules may be used.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'submit_repair',
        description: 'Submit your final version of the task. The program checks it against the rules, runs it in test mode, and also re-tests other tasks that use any state you changed. If it is accepted the repair is finished; if not, you get the reason and can keep working. Submit only after run_operation has succeeded with the same steps and states.',
        parameters: {
            type: 'object',
            properties: { steps: STEPS, test_end: STEPS, states: STATES, notes: { type: 'string', description: 'One or two sentences: what changed on the page and what you changed.' } },
            required: ['steps', 'notes'],
        },
    },
];

const MAX_RECORDS = 5;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function routeErrorResult(error: RouteError): Record<string, unknown> {
    return {
        ok: false,
        error: error.code,
        where: error.phase === 'start' ? 'start (clean inbox)' : `${error.phase}[${error.stepIndex}]`,
        detail: error.detail,
        ...(error.evidence.length > 0 ? { found_on_page: error.evidence } : {}),
    };
}

/**
 * Carries out the inspection tools for one repair of one operation. Proposed states are merged into a copy of the
 * route for each call; the route itself is never changed here.
 */
export class LearnerToolbox {
    constructor(
        private readonly executor: RouteExecutor,
        private readonly route: Route,
        private readonly operation: OperationName,
        private readonly params: Params,
        /** Parameters for a second, different message; run_operation runs with both. */
        private readonly alternateParams: Params | null,
        private readonly checkResult: (operation: OperationName, result: OperationResult) => void,
    ) {}

    /** The result of one tool call (not submit_repair), as a JSON-ready object. Problems are results, not throws. */
    async handle(call: ToolCall): Promise<Record<string, unknown>> {
        let args: unknown;
        try {
            args = JSON.parse(call.arguments);
        } catch (error) {
            return { ok: false, error: `the arguments were not valid JSON: ${(error as Error).message}` };
        }
        if (!isObject(args)) return { ok: false, error: 'the arguments must be a JSON object' };
        switch (call.name) {
            case 'try_target': return this.tryTarget(args);
            case 'check_state': return this.checkState(args);
            case 'try_extract': return this.tryExtract(args);
            case 'run_operation': return this.runOperation(args);
            case 'read_shortcut_help': {
                const help = await this.executor.readShortcutHelp(this.route, this.operation);
                return help === null
                    ? { ok: false, error: 'pressing "?" on the inbox opened nothing; this account may have keyboard shortcuts turned off' }
                    : { ok: true, shortcuts: help.length > 6000 ? `${help.slice(0, 6000)}… (cut)` : help };
            }
            default: return { ok: false, error: `there is no tool named "${call.name}"` };
        }
    }

    /** The route with these steps as the operation and these states added; plus every rule they break. */
    private candidate(steps: Step[], testEnd: Step[] | undefined, states: unknown): { route: Route; problems: string[] } {
        if (states !== undefined && !isObject(states)) return { route: this.route, problems: ['"states" must be an object of named states'] };
        const route = applyRepair(this.route, this.operation, {
            steps,
            ...(testEnd !== undefined ? { test_end: testEnd } : {}),
            states: (states ?? {}) as Record<string, PageState>,
            notes: '',
        });
        return { route, problems: validateRoute(route) };
    }

    private async tryTarget(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        if (!isObject(args.target)) return { ok: false, error: '"target" must be an object' };
        const target = args.target as Target;
        // A single click step checks the target against the target rules.
        const { route, problems } = this.candidate([{ click: target }], undefined, args.states);
        if (problems.length > 0) return { ok: false, error: 'the target breaks the rules', problems };
        const report = await this.executor.inspectTarget(route, target, this.params);
        return { ok: true, matches: report.matches, ...(report.problem ? { problem: report.problem } : {}), [report.matches > 0 ? 'elements' : 'nearest_on_page']: report.elements };
    }

    private async checkState(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        const state = args.state;
        if (typeof state !== 'string' && !isObject(state)) return { ok: false, error: '"state" must be a state name or a state object' };
        const extra = isObject(args.states) ? { ...args.states } : {};
        const name = typeof state === 'string' ? state : '__checked';
        if (typeof state !== 'string') extra[name] = state;
        const { route, problems } = this.candidate([{ wait_for: name }], undefined, extra);
        if (problems.length > 0) return { ok: false, error: 'the state breaks the rules', problems };
        const report = await this.executor.inspectState(route, name, this.params);
        return { ok: true, holds: report.holds, ...(report.holds ? {} : { why_not: report.reasons, found_on_page: report.evidence }) };
    }

    private async tryExtract(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        if (!isObject(args.extract)) return { ok: false, error: '"extract" must be an object' };
        const spec = args.extract as unknown as ExtractSpec;
        const { route, problems } = this.candidate([{ extract: spec, as: 'checked' }], undefined, args.states);
        if (problems.length > 0) return { ok: false, error: 'the extract breaks the rules', problems };
        try {
            const read = await this.executor.tryExtract(route, spec, this.params);
            return Array.isArray(read)
                ? { ok: true, records_read: read.length, first_records: read.slice(0, MAX_RECORDS) }
                : { ok: true, record: read };
        } catch (error) {
            if (error instanceof RouteError) return routeErrorResult(error);
            if (error instanceof UnreadableValueError) return { ok: false, error: 'unreadable_value', detail: error.message };
            throw error;
        }
    }

    private async runOperation(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        if (!Array.isArray(args.steps) || args.steps.length === 0) return { ok: false, error: '"steps" must be a non-empty array' };
        if (args.test_end !== undefined && !Array.isArray(args.test_end)) return { ok: false, error: '"test_end" must be an array' };
        const { route, problems } = this.candidate(args.steps as Step[], args.test_end as Step[] | undefined, args.states);
        if (problems.length > 0) return { ok: false, error: 'the steps break the rules', problems };
        const first = await this.runWith(route, this.params);
        if (first.ok !== true || this.alternateParams === null) return first;
        const second = await this.runWith(route, this.alternateParams);
        if (second.ok === true) return { ...first, also_worked_for_another_message: true };
        return {
            ...second,
            ok: false,
            note: `This worked for the first test message but failed for another message (${JSON.stringify(this.alternateParams)}). The task must work for any message: do not put a particular message's subject, sender or other text into targets.`,
        };
    }

    private async runWith(route: Route, params: Params): Promise<Record<string, unknown>> {
        try {
            const result = await this.executor.run(route, this.operation, params, 'test');
            this.checkResult(this.operation, result);
            const extracted = JSON.stringify(result.extracted);
            return { ok: true, steps_run: result.steps.length, read: extracted.length > 3000 ? `${extracted.slice(0, 3000)}… (cut)` : result.extracted };
        } catch (error) {
            if (error instanceof RouteError) return routeErrorResult(error);
            if (error instanceof UnreadableValueError) return { ok: false, error: 'unreadable_value', detail: error.message };
            throw error;
        }
    }
}
