import {
    capturePage, computeFingerprint, RouteError, UnreadableValueError,
    type OperationResult, type RouteExecutor,
} from '@teamsuzie/webmail-browser';
import {
    nextRouteVersion, OPERATION_NAMES, validateRoute,
    type OperationName, type Params, type Route,
} from '@teamsuzie/webmail-routes';
import type { RouteModel, ToolChatMessage } from './model.js';
import { applyRepair, parseRepair, RepairParseError } from './parse.js';
import { buildRepairPrompt } from './prompt.js';
import { LEARNER_TOOLS, LearnerToolbox } from './tools.js';

/** How much of the page outline goes into the first message. */
const PROMPT_OUTLINE_CHARS = 40_000;
/** Tool results are cut to this length before they go back to the model. */
const MAX_TOOL_RESULT_CHARS = 12_000;
/** Replies in a row without a tool call before the attempt is given up. */
const MAX_IDLE_TURNS = 3;

const SYSTEM = 'You repair the steps a program uses to operate a webmail page. You work only by calling the tools you are given. The program never runs code from you, and nothing you do sends email.';

/** One model turn and the tool calls it made, recorded so the model's work can be reviewed afterwards. */
export interface LearnerRound {
    at: string;
    model: string;
    operation: OperationName;
    turn: number;
    /** The first message the model received (only on the first turn). */
    prompt: string | null;
    text: string;
    calls: Array<{ name: string; arguments: string; result: string }>;
}

export interface LearnerDeps {
    model: RouteModel;
    executor: RouteExecutor;
    /** How many repairs one attempt may submit. */
    maxSubmissions: number;
    /** How many tool calls one attempt may make, submissions included. */
    maxToolCalls: number;
    log: (message: string) => void;
    /** Receives every model turn. */
    record: (round: LearnerRound) => void;
    now: () => Date;
}

export interface RelearnInput {
    route: Route;
    operation: OperationName;
    goal: string;
    outputs: string;
    /** Test parameters for each operation, used to test the repaired one and any operation sharing a changed state. */
    params: Partial<Record<OperationName, Params>>;
    /** Throws a RouteError when a result lacks what the operation must return. */
    checkResult: (operation: OperationName, result: OperationResult) => void;
}

export type LearnOutcome =
    | {
        ok: true; changed: true; route: Route; notes: string[]; changedStates: string[];
        /**
         * Operations to check next: ones that use a changed state but had no test parameters, and ones that fail
         * with the repaired route but were already failing with the old one (the page changed for them too).
         */
        untested: OperationName[];
    }
    | { ok: true; changed: false }
    | { ok: false; reason: string };

type Acceptance = { accepted: true; route: Route; notes: string; changedStates: string[]; untested: OperationName[] } | { accepted: false; problem: string };

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}… (cut at ${max} characters)` : text;
}

/**
 * Repairs one operation of a route against the live page. The model investigates with tools (what a target
 * matches, whether a state holds, what an extract reads, a full test-mode run of a candidate) and then submits a
 * repair. A submission is accepted only when it passes the rules, a test-mode run, and the test-mode runs of other
 * operations that use a state it changed.
 */
export class RouteLearner {
    constructor(private readonly deps: LearnerDeps) {}

    async relearn(input: RelearnInput): Promise<LearnOutcome> {
        const { operation } = input;
        const params = input.params[operation];
        if (params === undefined) throw new Error(`No test parameters for ${operation}`);

        let failure: RouteError;
        try {
            input.checkResult(operation, await this.deps.executor.run(input.route, operation, params, 'test'));
            return { ok: true, changed: false };
        } catch (error) {
            if (error instanceof UnreadableValueError) return { ok: false, reason: `relearning cannot help: ${error.message}` };
            if (!(error instanceof RouteError)) throw error;
            failure = error;
        }
        this.deps.log(`relearn ${operation}: ${failure.message}`);

        const prompt = buildRepairPrompt({
            route: input.route,
            operation,
            goal: input.goal,
            outputs: input.outputs,
            failure: { code: failure.code, phase: failure.phase, stepIndex: failure.stepIndex, message: failure.detail, evidence: failure.evidence },
            capture: await capturePage(this.deps.executor.page, PROMPT_OUTLINE_CHARS),
        });
        const messages: ToolChatMessage[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }];
        const toolbox = new LearnerToolbox(this.deps.executor, input.route, operation, params, input.checkResult);
        let toolCalls = 0;
        let submissions = 0;
        let idle = 0;
        let lastProblem = failure.message;

        for (let turn = 1; toolCalls < this.deps.maxToolCalls; turn++) {
            const reply = await this.deps.model.chat(messages, LEARNER_TOOLS);
            messages.push({ role: 'assistant', content: reply.text || null, toolCalls: reply.toolCalls });
            const round: LearnerRound = {
                at: this.deps.now().toISOString(), model: this.deps.model.id, operation, turn,
                prompt: turn === 1 ? prompt : null, text: reply.text, calls: [],
            };
            if (reply.toolCalls.length === 0) {
                this.deps.record(round);
                if (++idle >= MAX_IDLE_TURNS) return { ok: false, reason: `${operation}: the model stopped calling tools (${lastProblem})` };
                messages.push({ role: 'user', content: 'Answer by calling a tool: test with try_target, check_state, try_extract or run_operation, then call submit_repair.' });
                continue;
            }
            idle = 0;
            for (const call of reply.toolCalls) {
                toolCalls++;
                let result: Record<string, unknown>;
                if (call.name === 'submit_repair') {
                    submissions++;
                    const acceptance = await this.accept(call.arguments, input, params);
                    if (acceptance.accepted) {
                        round.calls.push({ name: call.name, arguments: call.arguments, result: 'accepted' });
                        this.deps.record(round);
                        return {
                            ok: true, changed: true, route: acceptance.route, notes: [acceptance.notes],
                            changedStates: acceptance.changedStates, untested: acceptance.untested,
                        };
                    }
                    lastProblem = acceptance.problem;
                    this.deps.log(`relearn ${operation}: submission ${submissions} not accepted: ${acceptance.problem}`);
                    result = { accepted: false, problem: acceptance.problem, submissions_left: this.deps.maxSubmissions - submissions };
                } else {
                    result = await toolbox.handle(call);
                }
                const text = clip(JSON.stringify(result), MAX_TOOL_RESULT_CHARS);
                round.calls.push({ name: call.name, arguments: call.arguments, result: text });
                messages.push({ role: 'tool', toolCallId: call.id, content: text });
                if (submissions >= this.deps.maxSubmissions) {
                    this.deps.record(round);
                    return { ok: false, reason: `${operation}: no repair accepted after ${submissions} submissions: ${lastProblem}` };
                }
            }
            this.deps.record(round);
        }
        return { ok: false, reason: `${operation}: no repair accepted within ${this.deps.maxToolCalls} tool calls (${submissions} submitted): ${lastProblem}` };
    }

    /** Check a submitted repair: rules, a test-mode run, and the other operations that use a state it changed. */
    private async accept(argumentsText: string, input: RelearnInput, params: Params): Promise<Acceptance> {
        let candidate: Route;
        let notes: string;
        let changedStates: string[];
        try {
            const proposal = parseRepair(argumentsText);
            candidate = applyRepair(input.route, input.operation, proposal);
            const invalid = validateRoute(candidate);
            if (invalid.length > 0) return { accepted: false, problem: `the repair breaks these rules: ${invalid.join('; ')}` };
            notes = proposal.notes;
            changedStates = Object.keys(proposal.states);
        } catch (error) {
            if (error instanceof RepairParseError) return { accepted: false, problem: error.message };
            throw error;
        }
        const failure = await this.testFailure(candidate, input.operation, params, input);
        if (failure !== null) return { accepted: false, problem: `the repaired task failed its test run: ${failure}` };
        const dependents = await this.checkDependents(candidate, input, new Set(changedStates));
        if (dependents.broken !== null) return { accepted: false, problem: `the repair broke another task that uses a state it changed: ${dependents.broken}` };
        return { accepted: true, route: await this.finish(candidate, input.operation), notes, changedStates, untested: dependents.untested };
    }

    /**
     * Test every other operation that uses a changed state (every operation, when the inbox state changed, since all
     * of them start from it): the first that fails, and those that could not be tested.
     */
    private async checkDependents(route: Route, input: RelearnInput, changedStates: Set<string>): Promise<{ broken: string | null; untested: OperationName[] }> {
        const untested: OperationName[] = [];
        for (const other of OPERATION_NAMES) {
            if (other === input.operation || changedStates.size === 0) continue;
            const text = JSON.stringify(route.operations[other]);
            if (![...changedStates].some((state) => text.includes(`"${state}"`)) && !changedStates.has('inbox_list')) continue;
            const params = input.params[other];
            if (params === undefined) {
                this.deps.log(`relearn ${input.operation}: ${other} uses a changed state but has no test parameters; not tested`);
                untested.push(other);
                continue;
            }
            const failure = await this.testFailure(route, other, params, input);
            if (failure === null) continue;
            // Blame the repair only when the old route still worked for this operation.
            const before = await this.testFailure(input.route, other, params, input);
            if (before === null) return { broken: `${other} (${failure})`, untested };
            this.deps.log(`relearn ${input.operation}: ${other} was already failing before this repair; check it next`);
            untested.push(other);
        }
        return { broken: null, untested };
    }

    /** Why the operation fails in test mode with `route`, or null when it passes. */
    private async testFailure(route: Route, operation: OperationName, params: Params, input: RelearnInput): Promise<string | null> {
        try {
            input.checkResult(operation, await this.deps.executor.run(route, operation, params, 'test'));
            return null;
        } catch (error) {
            if (error instanceof RouteError) {
                return `${error.message}${error.evidence.length > 0 ? ` | found on the page: ${error.evidence.slice(0, 5).join(' | ')}` : ''}`;
            }
            if (error instanceof UnreadableValueError) return error.message;
            throw error;
        }
    }

    private async finish(route: Route, operation: OperationName): Promise<Route> {
        await this.deps.executor.startFromInbox(route, operation);
        return {
            ...route,
            route_version: nextRouteVersion(route.route_version, this.deps.now()),
            learned_by: `learner:${this.deps.model.id}`,
            learned_at: this.deps.now().toISOString(),
            fingerprint: await computeFingerprint(this.deps.executor.page),
        };
    }
}
