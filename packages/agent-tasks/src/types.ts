/**
 * Where a task is in its life.
 *
 * - `queued`     waiting for the host's runner to claim it.
 * - `running`    the agent is working on it.
 * - `blocked`    the agent stopped to ask its supervisor something.
 * - `in_review`  the agent finished; its supervisor must sign off.
 * - `done`       finished (signed off, or no sign-off was required).
 * - `failed`     the run broke; the supervisor can retry.
 * - `cancelled`  stopped by a person.
 */
export type TaskStatus = 'queued' | 'running' | 'blocked' | 'in_review' | 'done' | 'failed' | 'cancelled';

export const TASK_STATUSES: readonly TaskStatus[] = [
    'queued',
    'running',
    'blocked',
    'in_review',
    'done',
    'failed',
    'cancelled',
];

/** Statuses a task never leaves. */
export const FINAL_STATUSES: readonly TaskStatus[] = ['done', 'cancelled'];

export interface AgentTask {
    id: string;
    /** What the task is about, e.g. ('matter', matterId). Opaque to the package. */
    subjectType: string;
    subjectId: string;
    title: string;
    /** The original instructions from the person who set the task. */
    instructions: string;
    /** The supervising person: answers blockers and signs off. */
    ownerId: string;
    createdBy: string;
    /** Which agent does the work; a host-defined reference (e.g. a persona id). */
    agent: string;
    model: string | null;
    /** When true the task only reaches `done` through the supervisor's sign-off. */
    signOffRequired: boolean;
    status: TaskStatus;
    /** The host's conversation holding the agent's messages and tool calls. */
    conversationId: string | null;
    /** What the agent is told on its next run: the instructions, an answer, or requested changes. */
    nextPrompt: string;
    /** The agent's open question while `blocked`. */
    blocker: string | null;
    /** Why the last run failed, while `failed`. */
    error: string | null;
    runCount: number;
    createdAt: number;
    updatedAt: number;
    startedAt: number | null;
    finishedAt: number | null;
    signedOffBy: string | null;
    signedOffAt: number | null;
}

export type TaskEventKind =
    | 'created'
    | 'run_started'
    | 'run_finished'
    | 'blocked'
    | 'answered'
    | 'output'
    | 'changes_requested'
    | 'signed_off'
    | 'failed'
    | 'retried'
    | 'cancelled'
    | 'comment';

/** One entry in a task's append-only timeline. */
export interface TaskEvent {
    id: string;
    taskId: string;
    kind: TaskEventKind;
    actor: string;
    text: string;
    data: Record<string, unknown> | null;
    createdAt: number;
}

/** Something the agent produced, e.g. a file. `kind` and `id` are host-defined. */
export interface TaskOutput {
    kind: string;
    id: string;
    name: string;
}

export interface CreateTaskInput {
    subjectType: string;
    subjectId: string;
    title: string;
    instructions: string;
    ownerId: string;
    createdBy: string;
    agent: string;
    model?: string | null;
    signOffRequired: boolean;
}

export interface ListTasksFilter {
    subjectType?: string;
    subjectId?: string;
    ownerId?: string;
    createdBy?: string;
    status?: TaskStatus | TaskStatus[];
    limit?: number;
}

/** The actor recorded for things the agent or the runner does. */
export const AGENT_ACTOR = 'agent';
