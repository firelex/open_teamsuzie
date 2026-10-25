import type { Operation, OperationName, PageState, Route, Step } from '@teamsuzie/webmail-routes';

/** A model's proposed replacement for one operation, plus any states it adds or changes. */
export interface RepairProposal {
    steps: Step[];
    test_end?: Step[];
    states: Record<string, PageState>;
    notes: string;
}

export class RepairParseError extends Error {
    override readonly name = 'RepairParseError';
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the model's reply. It must be one JSON object (a ```json fence around it is tolerated) with `steps`, and
 * optionally `test_end`, `states` and `notes`. Anything else is a RepairParseError whose message is fed back to
 * the model.
 */
export function parseRepair(text: string): RepairProposal {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    const body = (fenced ? fenced[1]! : text).trim();
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start === -1 || end <= start) throw new RepairParseError('The reply did not contain a JSON object.');
    let parsed: unknown;
    try {
        parsed = JSON.parse(body.slice(start, end + 1));
    } catch (error) {
        throw new RepairParseError(`The reply was not valid JSON: ${(error as Error).message}`);
    }
    if (!isObject(parsed)) throw new RepairParseError('The reply must be a JSON object.');
    for (const key of Object.keys(parsed)) {
        if (!['steps', 'test_end', 'states', 'notes'].includes(key)) throw new RepairParseError(`The reply has an unexpected key "${key}".`);
    }
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) throw new RepairParseError('"steps" must be a non-empty array.');
    if (parsed.test_end !== undefined && !Array.isArray(parsed.test_end)) throw new RepairParseError('"test_end" must be an array when given.');
    if (parsed.states !== undefined && !isObject(parsed.states)) throw new RepairParseError('"states" must be an object when given.');
    if (parsed.notes !== undefined && typeof parsed.notes !== 'string') throw new RepairParseError('"notes" must be a string when given.');
    return {
        steps: parsed.steps as Step[],
        ...(parsed.test_end !== undefined ? { test_end: parsed.test_end as Step[] } : {}),
        states: (parsed.states ?? {}) as Record<string, PageState>,
        notes: (parsed.notes ?? '') as string,
    };
}

/** A copy of `route` with the operation replaced and the proposal's states added or replaced. Not validated here. */
export function applyRepair(route: Route, operation: OperationName, proposal: RepairProposal): Route {
    const next = structuredClone(route);
    const replaced: Operation = { steps: structuredClone(proposal.steps) };
    if (proposal.test_end !== undefined) replaced.test_end = structuredClone(proposal.test_end);
    next.operations[operation] = replaced;
    for (const [name, state] of Object.entries(proposal.states)) next.states[name] = structuredClone(state);
    return next;
}
