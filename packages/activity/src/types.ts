export interface SubjectRef {
    type: string;
    id: string;
}

/**
 * Who (or what) performed the event. Both fields are optional so the
 * package supports system-emitted events with no human actor and
 * actor-only events where the type isn't known. Conventional
 * actor_type values: `user`, `agent`, `system`.
 */
export interface Actor {
    id?: string | null;
    type?: string | null;
}

/**
 * One activity row. Append-only: there is no `update` API. `kind` is
 * a free-form event tag the host uses for filtering and display
 * (e.g. `comment.added`, `stage.moved`, `email.sent`). `summary` is
 * a one-line headline; `body` is optional longer content; `metadata`
 * is arbitrary JSON for host-specific structured payloads.
 */
export interface ActivityEntry {
    id: string;
    orgId: string;
    subjectType: string;
    subjectId: string;
    actorId: string | null;
    actorType: string | null;
    kind: string;
    summary: string;
    body: string | null;
    metadata: Record<string, unknown>;
    at: number;
}

export interface AppendActivityInput {
    orgId: string;
    subject: SubjectRef;
    kind: string;
    summary: string;
    body?: string | null;
    actor?: Actor | null;
    metadata?: Record<string, unknown>;
    /** Defaults to `now()`. Pass to backfill or align with an upstream timestamp. */
    at?: number;
}

export interface ListBySubjectOptions {
    orgId: string;
    subject: SubjectRef;
    /** Default 100. Capped at 500. */
    limit?: number;
    /** Cursor — return entries strictly older than this timestamp. */
    before?: number;
    /** Restrict to a subset of `kind` values. */
    kinds?: string[];
}

export interface ListByOrgOptions {
    orgId: string;
    /** Default 100. Capped at 500. */
    limit?: number;
    before?: number;
    kinds?: string[];
}
