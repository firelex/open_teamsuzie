/**
 * Structured updates an orchestration layer emits for a user-facing presenter
 * to render. Keeping these as plain data (not free text) lets the presenter
 * attach app actions while preserving the original intent.
 *
 * These types are intentionally generic: no assumptions about the underlying
 * agent identities (Claude / Codex / Qwen / a local model), the host's
 * subject vocabulary (project / matter / chat), or the host's action menus.
 * Hosts extend `AgentActionIntent` with their own string literals and override
 * `defaultActionsFor` to add domain-specific actions (e.g. open_preview, push).
 */

export type AgentUpdateKind = 'progress' | 'question' | 'result' | 'error';

export type AgentUpdateSeverity = 'info' | 'warning' | 'blocking';

/**
 * Built-in intents every presenter understands. Hosts can pass any other
 * string (the `(string & {})` arm preserves autocomplete for the built-ins
 * while still accepting custom values like `'open_preview'`).
 */
export type AgentActionIntent =
    | 'continue'
    | 'approve'
    | 'reject'
    | 'run_tests'
    | 'replan'
    | 'ask_for_changes'
    | (string & {});

export interface AgentAction {
    id: string;
    label: string;
    intent: AgentActionIntent;
    payload?: unknown;
}

/**
 * `subjectId` is the top-level scope the host owns (project id, matter id,
 * user id for an EA-shaped app, …). This package treats it as opaque; the
 * host gives it meaning. Mirrors `DepartmentEvent.subjectId` in
 * `@teamsuzie/events`.
 */
export interface AgentUpdate {
    kind: AgentUpdateKind;
    summary: string;
    details?: string;
    severity?: AgentUpdateSeverity;
    subjectId: string;
    correlationId?: string;
    actions?: AgentAction[];
}
