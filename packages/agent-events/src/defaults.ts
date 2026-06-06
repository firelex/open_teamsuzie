import type { AgentAction, AgentUpdate } from './types.js';

/**
 * Generic default action menus per update kind. Hosts can use this verbatim
 * or compose with their own actions — e.g. an IT-shaped app may append
 * `open_preview` / `push` to the `result` menu. Nothing here is host-specific;
 * domain actions live in the consuming app.
 */
export function defaultActionsFor(update: AgentUpdate): AgentAction[] {
    switch (update.kind) {
        case 'result':
            return [
                { id: 'approve', label: 'Approve', intent: 'approve' },
                { id: 'ask_for_changes', label: 'Ask for changes', intent: 'ask_for_changes' },
            ];
        case 'progress':
            return [
                { id: 'continue', label: 'Continue', intent: 'continue' },
                { id: 'replan', label: 'Replan', intent: 'replan' },
            ];
        case 'question':
            return [
                { id: 'replan', label: 'Replan', intent: 'replan' },
            ];
        case 'error':
            return [
                { id: 'continue', label: 'Try again', intent: 'continue' },
                { id: 'replan', label: 'Replan', intent: 'replan' },
            ];
    }
}

/**
 * Resolve which actions a presenter should render for `update`: prefer
 * caller-provided `actions` when non-empty; otherwise fall back to
 * `defaultActionsFor`. Helpful so callers don't have to repeat the
 * "non-empty?" check at every emit site.
 */
export function resolveActions(update: AgentUpdate): AgentAction[] {
    return update.actions && update.actions.length > 0
        ? update.actions
        : defaultActionsFor(update);
}
