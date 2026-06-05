/**
 * Source of an event. The well-known values are the only ones a generic
 * consumer needs to special-case; any other string is allowed (and stored
 * verbatim) so a host can plug in agent identities like `claude`, `codex`,
 * `executive_assistant`, etc. without changes here.
 */
export type EventSource = 'user' | 'system' | 'agent' | (string & {});

/**
 * One event in a department's append-only log.
 *
 * - `subjectId` is the top-level scope a host owns. In a project-shaped app
 *   it's the project id; in an EA-shaped app it could be the user id. The
 *   generic store doesn't care — it's an opaque string.
 * - `chatId` is the optional finer scope used for fan-out and SSE delivery.
 *   Events that don't belong to a chat (e.g. background system events) can
 *   leave it null.
 * - `correlationId` links related events across a single agent turn or
 *   workflow — useful for "show me everything caused by this user message"
 *   queries without scanning the whole log.
 */
export interface DepartmentEvent {
    id: number;
    subjectId: string;
    chatId: string | null;
    ts: string;
    source: EventSource;
    kind: string;
    payload: unknown;
    correlationId: string | null;
}

export interface AppendEventInput {
    subjectId: string;
    chatId?: string | null;
    source: EventSource;
    kind: string;
    payload: unknown;
    correlationId?: string | null;
}

export type EventListener = (event: DepartmentEvent) => void;
