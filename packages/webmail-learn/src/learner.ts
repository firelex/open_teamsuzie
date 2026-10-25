import {
    capturePage, computeFingerprint, NavigationError, RouteError,
    type OperationResult, type RouteExecutor,
} from '@teamsuzie/webmail-browser';
import {
    nextRouteVersion, OPERATION_NAMES, validateRoute,
    type OperationName, type Params, type Route,
} from '@teamsuzie/webmail-routes';
import type { RouteModel } from './model.js';
import { applyRepair, parseRepair, RepairParseError } from './parse.js';
import { buildRepairPrompt } from './prompt.js';

export interface LearnerDeps {
    model: RouteModel;
    executor: RouteExecutor;
    /** How many model replies one attempt may use. */
    maxStepFixes: number;
    log: (message: string) => void;
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
        /** Operations that use a changed state but had no test parameters, so were not tested; canary them next. */
        untested: OperationName[];
    }
    | { ok: true; changed: false }
    | { ok: false; reason: string };

/**
 * Repairs one operation of a route against the live page. Each round runs the operation in test mode; on a route
 * error it captures the page, asks the model for new steps, validates them and tries again. A repair is accepted
 * only when the operation, and every other operation using a state it changed, pass in test mode.
 */
export class RouteLearner {
    constructor(private readonly deps: LearnerDeps) {}

    async relearn(input: RelearnInput): Promise<LearnOutcome> {
        const { operation } = input;
        const params = input.params[operation];
        if (params === undefined) throw new Error(`No test parameters for ${operation}`);

        let candidate = input.route;
        const changedStates = new Set<string>();
        const notes: string[] = [];
        const problems: string[] = [];

        for (let round = 0; round <= this.deps.maxStepFixes; round++) {
            await this.resetPage(candidate);
            let failure: RouteError;
            try {
                const result = await this.deps.executor.run(candidate, operation, params, 'test');
                input.checkResult(operation, result);
                if (round === 0) return { ok: true, changed: false };
                const dependents = await this.checkDependents(candidate, input, changedStates);
                if (dependents.broken !== null) return { ok: false, reason: `the repair of ${operation} broke ${dependents.broken}` };
                return {
                    ok: true, changed: true, route: await this.finish(candidate), notes,
                    changedStates: [...changedStates], untested: dependents.untested,
                };
            } catch (error) {
                if (!(error instanceof RouteError)) throw error;
                failure = error;
            }
            if (round === this.deps.maxStepFixes) {
                return { ok: false, reason: `${operation} still fails after ${this.deps.maxStepFixes} repairs: ${failure.message}` };
            }
            this.deps.log(`relearn ${operation}: round ${round + 1}: ${failure.message}`);

            const prompt = buildRepairPrompt({
                route: candidate,
                operation,
                goal: input.goal,
                outputs: input.outputs,
                failure: { code: failure.code, phase: failure.phase, stepIndex: failure.stepIndex, message: failure.detail },
                capture: await capturePage(this.deps.executor.page),
                previousProblems: problems,
            });
            const reply = await this.deps.model.complete(prompt);
            try {
                const proposal = parseRepair(reply);
                const next = applyRepair(candidate, operation, proposal);
                const invalid = validateRoute(next);
                if (invalid.length > 0) throw new RepairParseError(`The steps broke these rules: ${invalid.join('; ')}`);
                for (const name of Object.keys(proposal.states)) changedStates.add(name);
                if (proposal.notes) notes.push(proposal.notes);
                candidate = next;
            } catch (error) {
                if (!(error instanceof RepairParseError)) throw error;
                problems.push(error.message);
                this.deps.log(`relearn ${operation}: unusable reply: ${error.message}`);
            }
        }
        throw new Error('unreachable');
    }

    private async resetPage(route: Route): Promise<void> {
        try {
            await this.deps.executor.page.goto(route.home_url, { waitUntil: 'domcontentloaded' });
        } catch (error) {
            throw new NavigationError(`Could not load ${route.home_url}: ${(error as Error).message}`);
        }
        this.deps.executor.checkSignedIn(route);
    }

    /** Test every other operation that uses a changed state: the first that fails, and those that could not be tested. */
    private async checkDependents(route: Route, input: RelearnInput, changedStates: Set<string>): Promise<{ broken: string | null; untested: OperationName[] }> {
        const untested: OperationName[] = [];
        for (const other of OPERATION_NAMES) {
            if (other === input.operation || changedStates.size === 0) continue;
            const text = JSON.stringify(route.operations[other]);
            if (![...changedStates].some((state) => text.includes(`"${state}"`))) continue;
            const params = input.params[other];
            if (params === undefined) {
                this.deps.log(`relearn ${input.operation}: ${other} uses a changed state but has no test parameters; not tested`);
                untested.push(other);
                continue;
            }
            await this.resetPage(route);
            try {
                input.checkResult(other, await this.deps.executor.run(route, other, params, 'test'));
            } catch (error) {
                if (error instanceof RouteError) return { broken: `${other} (${error.message})`, untested };
                throw error;
            }
        }
        return { broken: null, untested };
    }

    private async finish(route: Route): Promise<Route> {
        await this.resetPage(route);
        return {
            ...route,
            route_version: nextRouteVersion(route.route_version, this.deps.now()),
            learned_by: `learner:${this.deps.model.id}`,
            learned_at: this.deps.now().toISOString(),
            fingerprint: await computeFingerprint(this.deps.executor.page),
        };
    }
}
