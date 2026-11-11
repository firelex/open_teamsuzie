import { randomUUID } from 'node:crypto';
import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import {
    AGENT_ACTOR,
    TASK_STATUSES,
    type AgentTask,
    type CreateTaskInput,
    type ListTasksFilter,
    type TaskEvent,
    type TaskEventKind,
    type TaskOutput,
    type TaskStatus,
} from './types.js';

/** A request that the task's current status does not allow. */
export class TaskTransitionError extends Error {
    readonly code = 'invalid_transition';
    constructor(
        readonly taskId: string,
        readonly status: TaskStatus,
        action: string,
    ) {
        super(`The task is ${status.replace('_', ' ')}, so it cannot ${action}.`);
    }
}

export class TaskNotFoundError extends Error {
    readonly code = 'task_not_found';
    constructor(readonly taskId: string) {
        super(`No task with id ${taskId}.`);
    }
}

export interface AgentTaskStoreOptions {
    db: DatabaseInstance;
    idFactory?: () => string;
    now?: () => number;
}

interface TaskRow {
    id: string;
    subject_type: string;
    subject_id: string;
    title: string;
    instructions: string;
    owner_id: string;
    created_by: string;
    agent: string;
    model: string | null;
    sign_off_required: number;
    status: TaskStatus;
    conversation_id: string | null;
    next_prompt: string;
    blocker: string | null;
    error: string | null;
    run_count: number;
    created_at: number;
    updated_at: number;
    started_at: number | null;
    finished_at: number | null;
    signed_off_by: string | null;
    signed_off_at: number | null;
}

interface EventRow {
    id: string;
    task_id: string;
    kind: TaskEventKind;
    actor: string;
    text: string;
    data: string | null;
    created_at: number;
}

function toTask(r: TaskRow): AgentTask {
    return {
        id: r.id,
        subjectType: r.subject_type,
        subjectId: r.subject_id,
        title: r.title,
        instructions: r.instructions,
        ownerId: r.owner_id,
        createdBy: r.created_by,
        agent: r.agent,
        model: r.model,
        signOffRequired: r.sign_off_required === 1,
        status: r.status,
        conversationId: r.conversation_id,
        nextPrompt: r.next_prompt,
        blocker: r.blocker,
        error: r.error,
        runCount: r.run_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        signedOffBy: r.signed_off_by,
        signedOffAt: r.signed_off_at,
    };
}

function toEvent(r: EventRow): TaskEvent {
    return {
        id: r.id,
        taskId: r.task_id,
        kind: r.kind,
        actor: r.actor,
        text: r.text,
        data: r.data ? (JSON.parse(r.data) as Record<string, unknown>) : null,
        createdAt: r.created_at,
    };
}

const required = (value: string, what: string): string => {
    const v = value.trim();
    if (!v) throw new Error(`${what} is required`);
    return v;
};

/**
 * Supervised agent tasks. Every change of status goes through one guarded
 * transition and leaves an entry in the task's timeline, so the record
 * shows who asked for what, what the agent did, and who signed it off.
 *
 * The store is also the queue: `claimNext` moves the oldest queued task to
 * `running` in one transaction. The host runs the agent and reports back
 * with `finishRun`, `block` or `fail`.
 */
export class AgentTaskStore {
    private readonly db: DatabaseInstance;
    private readonly newId: () => string;
    private readonly clock: () => number;

    constructor(opts: AgentTaskStoreOptions) {
        this.db = opts.db;
        this.newId = opts.idFactory ?? (() => randomUUID());
        this.clock = opts.now ?? (() => Date.now());
    }

    create(input: CreateTaskInput): AgentTask {
        const id = this.newId();
        const now = this.clock();
        const instructions = required(input.instructions, 'instructions');
        prepareCached(
            this.db,
            `INSERT INTO agent_tasks (id, subject_type, subject_id, title, instructions, owner_id, created_by, agent, model,
               sign_off_required, status, next_prompt, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
        ).run(
            id,
            required(input.subjectType, 'subjectType'),
            required(input.subjectId, 'subjectId'),
            required(input.title, 'title'),
            instructions,
            required(input.ownerId, 'ownerId'),
            required(input.createdBy, 'createdBy'),
            required(input.agent, 'agent'),
            input.model ?? null,
            input.signOffRequired ? 1 : 0,
            instructions,
            now,
            now,
        );
        this.addEvent(id, 'created', input.createdBy, instructions, {
            ownerId: input.ownerId,
            agent: input.agent,
            model: input.model ?? null,
            signOffRequired: input.signOffRequired,
        });
        return this.mustGet(id);
    }

    get(id: string): AgentTask | null {
        const row = prepareCached<[string], TaskRow>(this.db, `SELECT * FROM agent_tasks WHERE id = ?`).get(id);
        return row ? toTask(row) : null;
    }

    list(filter: ListTasksFilter = {}): AgentTask[] {
        const where: string[] = [];
        const params: unknown[] = [];
        if (filter.subjectType) {
            where.push('subject_type = ?');
            params.push(filter.subjectType);
        }
        if (filter.subjectId) {
            where.push('subject_id = ?');
            params.push(filter.subjectId);
        }
        if (filter.ownerId) {
            where.push('lower(owner_id) = lower(?)');
            params.push(filter.ownerId);
        }
        if (filter.createdBy) {
            where.push('lower(created_by) = lower(?)');
            params.push(filter.createdBy);
        }
        if (filter.status) {
            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
            for (const s of statuses) {
                if (!TASK_STATUSES.includes(s)) throw new Error(`unknown task status: ${s}`);
            }
            where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
            params.push(...statuses);
        }
        const sql = `SELECT * FROM agent_tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                     ORDER BY created_at DESC, rowid DESC LIMIT ?`;
        params.push(filter.limit ?? 200);
        return (this.db.prepare(sql).all(...params) as TaskRow[]).map(toTask);
    }

    events(taskId: string): TaskEvent[] {
        return prepareCached<[string], EventRow>(
            this.db,
            `SELECT * FROM agent_task_events WHERE task_id = ? ORDER BY created_at ASC, rowid ASC`,
        )
            .all(taskId)
            .map(toEvent);
    }

    /** Every output recorded on the task, oldest first, once each. */
    outputs(taskId: string): TaskOutput[] {
        const seen = new Map<string, TaskOutput>();
        for (const e of this.events(taskId)) {
            if (e.kind !== 'output' || !e.data) continue;
            const o = e.data as unknown as TaskOutput;
            seen.set(`${o.kind}:${o.id}`, { kind: o.kind, id: o.id, name: o.name });
        }
        return [...seen.values()];
    }

    /**
     * Claim the oldest queued task for a run: it becomes `running` and the
     * timeline records the prompt the agent is about to be given.
     */
    claimNext(): AgentTask | null {
        const tx = this.db.transaction((): AgentTask | null => {
            const row = prepareCached<[], { id: string }>(
                this.db,
                `SELECT id FROM agent_tasks WHERE status = 'queued' ORDER BY updated_at ASC, rowid ASC LIMIT 1`,
            ).get();
            if (!row) return null;
            const now = this.clock();
            prepareCached(
                this.db,
                `UPDATE agent_tasks SET status = 'running', run_count = run_count + 1, started_at = ?, finished_at = NULL,
                   blocker = NULL, error = NULL, updated_at = ? WHERE id = ? AND status = 'queued'`,
            ).run(now, now, row.id);
            const task = this.mustGet(row.id);
            this.addEvent(task.id, 'run_started', AGENT_ACTOR, task.nextPrompt, { run: task.runCount });
            return task;
        });
        return tx();
    }

    setConversation(id: string, conversationId: string): void {
        prepareCached(this.db, `UPDATE agent_tasks SET conversation_id = ?, updated_at = ? WHERE id = ?`).run(
            conversationId,
            this.clock(),
            id,
        );
    }

    addOutput(id: string, output: TaskOutput): void {
        this.mustGet(id);
        this.addEvent(id, 'output', AGENT_ACTOR, output.name, { ...output });
    }

    /** The agent finished its run: to review, or done when no sign-off is required. */
    finishRun(id: string, summary: string): AgentTask {
        const task = this.mustGet(id);
        return this.transition(task, ['running'], task.signOffRequired ? 'in_review' : 'done', 'finish', {
            kind: 'run_finished',
            actor: AGENT_ACTOR,
            text: summary,
            set: task.signOffRequired ? {} : { finished_at: this.clock() },
        });
    }

    /** The agent stopped to ask its supervisor something. */
    block(id: string, question: string): AgentTask {
        const q = required(question, 'question');
        return this.transition(this.mustGet(id), ['running'], 'blocked', 'stop to ask a question', {
            kind: 'blocked',
            actor: AGENT_ACTOR,
            text: q,
            set: { blocker: q },
        });
    }

    fail(id: string, error: string): AgentTask {
        const message = required(error, 'error');
        return this.transition(this.mustGet(id), ['running'], 'failed', 'fail', {
            kind: 'failed',
            actor: AGENT_ACTOR,
            text: message,
            set: { error: message, finished_at: this.clock() },
        });
    }

    /** The supervisor answers the agent's question; the task is queued to continue. */
    answer(id: string, actor: string, text: string): AgentTask {
        const a = required(text, 'answer');
        return this.transition(this.mustGet(id), ['blocked'], 'queued', 'take an answer', {
            kind: 'answered',
            actor,
            text: a,
            set: { blocker: null, next_prompt: a },
        });
    }

    /** The supervisor sends the work back with what to change. */
    requestChanges(id: string, actor: string, text: string): AgentTask {
        const c = required(text, 'the requested changes');
        return this.transition(this.mustGet(id), ['in_review'], 'queued', 'take requested changes', {
            kind: 'changes_requested',
            actor,
            text: c,
            set: { next_prompt: c },
        });
    }

    /**
     * The supervisor signs the work off. `attested` is what they signed
     * (e.g. each output with a content hash), kept in the timeline.
     */
    signOff(id: string, actor: string, note: string, attested: Record<string, unknown>): AgentTask {
        const now = this.clock();
        return this.transition(this.mustGet(id), ['in_review'], 'done', 'be signed off', {
            kind: 'signed_off',
            actor,
            text: note.trim(),
            data: attested,
            set: { signed_off_by: actor, signed_off_at: now, finished_at: now },
        });
    }

    /** Run a failed task again with the same prompt. */
    retry(id: string, actor: string): AgentTask {
        return this.transition(this.mustGet(id), ['failed'], 'queued', 'be retried', {
            kind: 'retried',
            actor,
            text: '',
            set: { error: null },
        });
    }

    /** Stop a task. A running task's host must abort its run too. */
    cancel(id: string, actor: string, reason: string): AgentTask {
        return this.transition(
            this.mustGet(id),
            ['queued', 'running', 'blocked', 'in_review', 'failed'],
            'cancelled',
            'be cancelled',
            { kind: 'cancelled', actor, text: reason.trim(), set: { blocker: null, finished_at: this.clock() } },
        );
    }

    comment(id: string, actor: string, text: string): TaskEvent {
        this.mustGet(id);
        return this.addEvent(id, 'comment', actor, required(text, 'comment'), null);
    }

    /**
     * Fail every task left `running`, e.g. after a restart cut its run off.
     * Runs are not resumed automatically: the agent may have half-finished,
     * and the supervisor decides whether to retry. Returns the tasks failed.
     */
    failInterrupted(message: string): AgentTask[] {
        const running = prepareCached<[], { id: string }>(
            this.db,
            `SELECT id FROM agent_tasks WHERE status = 'running'`,
        ).all();
        return running.map(({ id }) => this.fail(id, message));
    }

    /** Remove every task (and its timeline) about a subject, e.g. when it is deleted. */
    deleteFor(subjectType: string, subjectId: string): number {
        return prepareCached(this.db, `DELETE FROM agent_tasks WHERE subject_type = ? AND subject_id = ?`).run(
            subjectType,
            subjectId,
        ).changes;
    }

    private mustGet(id: string): AgentTask {
        const task = this.get(id);
        if (!task) throw new TaskNotFoundError(id);
        return task;
    }

    private transition(
        task: AgentTask,
        from: TaskStatus[],
        to: TaskStatus,
        action: string,
        change: {
            kind: TaskEventKind;
            actor: string;
            text: string;
            data?: Record<string, unknown> | null;
            set?: Record<string, string | number | null>;
        },
    ): AgentTask {
        const tx = this.db.transaction((): AgentTask => {
            const set = { ...(change.set ?? {}), status: to, updated_at: this.clock() };
            const cols = Object.keys(set);
            const result = this.db
                .prepare(
                    `UPDATE agent_tasks SET ${cols.map((c) => `${c} = ?`).join(', ')}
                     WHERE id = ? AND status IN (${from.map(() => '?').join(', ')})`,
                )
                .run(...cols.map((c) => set[c as keyof typeof set]), task.id, ...from);
            if (result.changes === 0) {
                throw new TaskTransitionError(task.id, this.mustGet(task.id).status, action);
            }
            this.addEvent(task.id, change.kind, change.actor, change.text, change.data ?? { from: task.status, to });
            return this.mustGet(task.id);
        });
        return tx();
    }

    private addEvent(
        taskId: string,
        kind: TaskEventKind,
        actor: string,
        text: string,
        data: Record<string, unknown> | null,
    ): TaskEvent {
        const event: TaskEvent = { id: this.newId(), taskId, kind, actor, text, data, createdAt: this.clock() };
        prepareCached(
            this.db,
            `INSERT INTO agent_task_events (id, task_id, kind, actor, text, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(event.id, taskId, kind, actor, text, data ? JSON.stringify(data) : null, event.createdAt);
        return event;
    }
}
