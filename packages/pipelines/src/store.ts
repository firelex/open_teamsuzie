import { randomUUID } from 'node:crypto';
import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import type {
    AddStageInput,
    CreatePipelineInput,
    ListPlacementsOptions,
    ListTransitionsOptions,
    MoveSubjectInput,
    Pipeline,
    PipelinePlacement,
    PipelineStage,
    PipelineTransition,
    PlaceSubjectInput,
    SubjectRef,
    UpdatePipelineInput,
    UpdateStageInput,
} from './types.js';

interface PipelineRow {
    id: string;
    org_id: string;
    key: string;
    name: string;
    description: string;
    subject_type: string;
    created_at: number;
    updated_at: number;
}

interface StageRow {
    id: string;
    pipeline_id: string;
    key: string;
    name: string;
    position: number;
    created_at: number;
}

interface PlacementRow {
    id: string;
    pipeline_id: string;
    org_id: string;
    subject_type: string;
    subject_id: string;
    stage_id: string;
    entered_at: number;
}

interface TransitionRow {
    id: string;
    pipeline_id: string;
    org_id: string;
    subject_type: string;
    subject_id: string;
    from_stage_id: string | null;
    to_stage_id: string;
    actor_id: string | null;
    note: string | null;
    at: number;
}

const MAX_TRANSITION_LIMIT = 500;
const DEFAULT_TRANSITION_LIMIT = 100;
/** Gap between stages when appending — leaves room for `reorderStages` to insert without renumbering everything. */
const STAGE_POSITION_STRIDE = 1000;

export interface PipelinesStoreOptions {
    db: DatabaseInstance;
    idFactory?: () => string;
    now?: () => number;
}

/**
 * CRUD over the four `pipeline_*` tables. Authentication context lives
 * in the host — every write takes `orgId` explicitly. The store does
 * not enforce that the subject `type` matches the pipeline's
 * `subjectType`; that's an advisory field for admin UIs.
 */
export class PipelinesStore {
    private readonly db: DatabaseInstance;
    private readonly newId: () => string;
    private readonly clock: () => number;

    constructor(opts: PipelinesStoreOptions) {
        this.db = opts.db;
        this.newId = opts.idFactory ?? (() => randomUUID());
        this.clock = opts.now ?? (() => Date.now());
    }

    // --- Pipelines ------------------------------------------------------

    createPipeline(input: CreatePipelineInput): Pipeline {
        const id = this.newId();
        const now = this.clock();
        prepareCached<
            [string, string, string, string, string, string, number, number]
        >(
            this.db,
            `INSERT INTO pipelines
                (id, org_id, key, name, description, subject_type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            input.orgId,
            input.key,
            input.name,
            input.description ?? '',
            input.subjectType,
            now,
            now,
        );
        return this.getPipeline(id)!;
    }

    getPipeline(id: string): Pipeline | null {
        const row = prepareCached<[string], PipelineRow>(
            this.db,
            `SELECT * FROM pipelines WHERE id = ?`,
        ).get(id);
        return row ? rowToPipeline(row) : null;
    }

    getPipelineByKey(orgId: string, key: string): Pipeline | null {
        const row = prepareCached<[string, string], PipelineRow>(
            this.db,
            `SELECT * FROM pipelines WHERE org_id = ? AND key = ?`,
        ).get(orgId, key);
        return row ? rowToPipeline(row) : null;
    }

    listPipelines(orgId: string): Pipeline[] {
        return prepareCached<[string], PipelineRow>(
            this.db,
            `SELECT * FROM pipelines WHERE org_id = ? ORDER BY name COLLATE NOCASE`,
        )
            .all(orgId)
            .map(rowToPipeline);
    }

    updatePipeline(id: string, patch: UpdatePipelineInput): Pipeline | null {
        const existing = this.getPipeline(id);
        if (!existing) return null;
        const now = this.clock();
        prepareCached<[string, string, number, string]>(
            this.db,
            `UPDATE pipelines SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
        ).run(
            patch.name ?? existing.name,
            patch.description ?? existing.description,
            now,
            id,
        );
        return this.getPipeline(id);
    }

    /**
     * Delete a pipeline. Cascades to stages, placements, and
     * transitions via FK constraints.
     */
    deletePipeline(id: string): boolean {
        const result = prepareCached<[string]>(
            this.db,
            `DELETE FROM pipelines WHERE id = ?`,
        ).run(id);
        return result.changes > 0;
    }

    // --- Stages ---------------------------------------------------------

    addStage(input: AddStageInput): PipelineStage {
        const id = this.newId();
        const now = this.clock();
        const position = input.position ?? this.nextStagePosition(input.pipelineId);
        prepareCached<[string, string, string, string, number, number]>(
            this.db,
            `INSERT INTO pipeline_stages
                (id, pipeline_id, key, name, position, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, input.pipelineId, input.key, input.name, position, now);
        return this.getStage(id)!;
    }

    getStage(id: string): PipelineStage | null {
        const row = prepareCached<[string], StageRow>(
            this.db,
            `SELECT * FROM pipeline_stages WHERE id = ?`,
        ).get(id);
        return row ? rowToStage(row) : null;
    }

    listStages(pipelineId: string): PipelineStage[] {
        return prepareCached<[string], StageRow>(
            this.db,
            `SELECT * FROM pipeline_stages
             WHERE pipeline_id = ?
             ORDER BY position ASC, created_at ASC`,
        )
            .all(pipelineId)
            .map(rowToStage);
    }

    updateStage(id: string, patch: UpdateStageInput): PipelineStage | null {
        const existing = this.getStage(id);
        if (!existing) return null;
        prepareCached<[string, number, string]>(
            this.db,
            `UPDATE pipeline_stages SET name = ?, position = ? WHERE id = ?`,
        ).run(
            patch.name ?? existing.name,
            patch.position ?? existing.position,
            id,
        );
        return this.getStage(id);
    }

    /**
     * Renumber stages according to `orderedStageIds`. Stages omitted
     * from the list are left untouched. The store doesn't reject moves
     * that put two stages at the same position — but `reorderStages`
     * assigns strided positions so callers don't need to think about it.
     */
    reorderStages(pipelineId: string, orderedStageIds: string[]): PipelineStage[] {
        const tx = this.db.transaction(() => {
            const upd = prepareCached<[number, string, string]>(
                this.db,
                `UPDATE pipeline_stages SET position = ?
                 WHERE id = ? AND pipeline_id = ?`,
            );
            orderedStageIds.forEach((stageId, index) => {
                upd.run((index + 1) * STAGE_POSITION_STRIDE, stageId, pipelineId);
            });
        });
        tx();
        return this.listStages(pipelineId);
    }

    /**
     * Remove a stage. Refuses to remove a stage that still holds
     * placements — callers should move those subjects out first or
     * archive the whole pipeline. Returns true when a row was removed.
     */
    removeStage(id: string): boolean {
        const placed = prepareCached<[string], { c: number }>(
            this.db,
            `SELECT COUNT(*) AS c FROM pipeline_placements WHERE stage_id = ?`,
        ).get(id);
        if ((placed?.c ?? 0) > 0) {
            throw new Error(
                `cannot remove stage ${id}: ${placed?.c} placement(s) still reference it`,
            );
        }
        const result = prepareCached<[string]>(
            this.db,
            `DELETE FROM pipeline_stages WHERE id = ?`,
        ).run(id);
        return result.changes > 0;
    }

    // --- Placements + transitions --------------------------------------

    /**
     * Place a subject onto a stage. If the subject is already placed in
     * this pipeline, the existing placement is updated and a
     * `from -> to` transition is appended; otherwise the placement is
     * created and the transition has `fromStageId = null`. The
     * subject's record + the transition row are written in a single
     * transaction.
     */
    placeSubject(input: PlaceSubjectInput): PipelinePlacement {
        const stage = this.getStage(input.stageId);
        if (!stage || stage.pipelineId !== input.pipelineId) {
            throw new Error(
                `stage ${input.stageId} does not belong to pipeline ${input.pipelineId}`,
            );
        }
        const pipeline = this.getPipeline(input.pipelineId);
        if (!pipeline) {
            throw new Error(`pipeline ${input.pipelineId} not found`);
        }
        const existing = this.getPlacement(input.pipelineId, input.subject);
        const now = this.clock();
        const transitionId = this.newId();
        const tx = this.db.transaction(() => {
            if (existing) {
                prepareCached<[string, number, string]>(
                    this.db,
                    `UPDATE pipeline_placements SET stage_id = ?, entered_at = ?
                     WHERE id = ?`,
                ).run(input.stageId, now, existing.id);
                this.insertTransition({
                    id: transitionId,
                    pipelineId: input.pipelineId,
                    orgId: pipeline.orgId,
                    subject: input.subject,
                    fromStageId: existing.stageId,
                    toStageId: input.stageId,
                    actorId: input.actorId ?? null,
                    note: input.note ?? null,
                    at: now,
                });
            } else {
                const placementId = this.newId();
                prepareCached<
                    [string, string, string, string, string, string, number]
                >(
                    this.db,
                    `INSERT INTO pipeline_placements
                        (id, pipeline_id, org_id, subject_type, subject_id, stage_id, entered_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ).run(
                    placementId,
                    input.pipelineId,
                    pipeline.orgId,
                    input.subject.type,
                    input.subject.id,
                    input.stageId,
                    now,
                );
                this.insertTransition({
                    id: transitionId,
                    pipelineId: input.pipelineId,
                    orgId: pipeline.orgId,
                    subject: input.subject,
                    fromStageId: null,
                    toStageId: input.stageId,
                    actorId: input.actorId ?? null,
                    note: input.note ?? null,
                    at: now,
                });
            }
        });
        tx();
        return this.getPlacement(input.pipelineId, input.subject)!;
    }

    /**
     * Move an already-placed subject. Fails if the subject has no
     * existing placement in this pipeline — call `placeSubject` first
     * if you want upsert semantics.
     */
    moveSubject(input: MoveSubjectInput): PipelinePlacement {
        const existing = this.getPlacement(input.pipelineId, input.subject);
        if (!existing) {
            throw new Error(
                `subject (${input.subject.type}, ${input.subject.id}) is not placed in pipeline ${input.pipelineId}`,
            );
        }
        return this.placeSubject({
            pipelineId: input.pipelineId,
            subject: input.subject,
            stageId: input.toStageId,
            actorId: input.actorId,
            note: input.note,
        });
    }

    getPlacement(
        pipelineId: string,
        subject: SubjectRef,
    ): PipelinePlacement | null {
        const row = prepareCached<[string, string, string], PlacementRow>(
            this.db,
            `SELECT * FROM pipeline_placements
             WHERE pipeline_id = ? AND subject_type = ? AND subject_id = ?`,
        ).get(pipelineId, subject.type, subject.id);
        return row ? rowToPlacement(row) : null;
    }

    /** Remove a subject from a pipeline. The transition history is retained. */
    removeSubject(pipelineId: string, subject: SubjectRef): boolean {
        const result = prepareCached<[string, string, string]>(
            this.db,
            `DELETE FROM pipeline_placements
             WHERE pipeline_id = ? AND subject_type = ? AND subject_id = ?`,
        ).run(pipelineId, subject.type, subject.id);
        return result.changes > 0;
    }

    listPlacements(opts: ListPlacementsOptions): PipelinePlacement[] {
        if (opts.stageId) {
            return prepareCached<[string, string], PlacementRow>(
                this.db,
                `SELECT * FROM pipeline_placements
                 WHERE pipeline_id = ? AND stage_id = ?
                 ORDER BY entered_at ASC`,
            )
                .all(opts.pipelineId, opts.stageId)
                .map(rowToPlacement);
        }
        return prepareCached<[string], PlacementRow>(
            this.db,
            `SELECT * FROM pipeline_placements
             WHERE pipeline_id = ?
             ORDER BY entered_at ASC`,
        )
            .all(opts.pipelineId)
            .map(rowToPlacement);
    }

    /**
     * Transition history. Newest first. When `subject` is omitted,
     * returns history for all subjects in this pipeline (capped by
     * `limit`).
     */
    listTransitions(opts: ListTransitionsOptions): PipelineTransition[] {
        const limit = Math.min(
            Math.max(1, opts.limit ?? DEFAULT_TRANSITION_LIMIT),
            MAX_TRANSITION_LIMIT,
        );
        if (opts.subject) {
            return prepareCached<
                [string, string, string, number],
                TransitionRow
            >(
                this.db,
                `SELECT * FROM pipeline_transitions
                 WHERE pipeline_id = ? AND subject_type = ? AND subject_id = ?
                 ORDER BY at DESC, ROWID DESC
                 LIMIT ?`,
            )
                .all(opts.pipelineId, opts.subject.type, opts.subject.id, limit)
                .map(rowToTransition);
        }
        return prepareCached<[string, number], TransitionRow>(
            this.db,
            `SELECT * FROM pipeline_transitions
             WHERE pipeline_id = ?
             ORDER BY at DESC, ROWID DESC
             LIMIT ?`,
        )
            .all(opts.pipelineId, limit)
            .map(rowToTransition);
    }

    // --- internals ------------------------------------------------------

    private nextStagePosition(pipelineId: string): number {
        const row = prepareCached<[string], { max_pos: number | null }>(
            this.db,
            `SELECT MAX(position) AS max_pos FROM pipeline_stages WHERE pipeline_id = ?`,
        ).get(pipelineId);
        const max = row?.max_pos ?? null;
        return max == null ? STAGE_POSITION_STRIDE : max + STAGE_POSITION_STRIDE;
    }

    private insertTransition(args: {
        id: string;
        pipelineId: string;
        orgId: string;
        subject: SubjectRef;
        fromStageId: string | null;
        toStageId: string;
        actorId: string | null;
        note: string | null;
        at: number;
    }): void {
        prepareCached<
            [
                string,
                string,
                string,
                string,
                string,
                string | null,
                string,
                string | null,
                string | null,
                number,
            ]
        >(
            this.db,
            `INSERT INTO pipeline_transitions
                (id, pipeline_id, org_id, subject_type, subject_id,
                 from_stage_id, to_stage_id, actor_id, note, at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            args.id,
            args.pipelineId,
            args.orgId,
            args.subject.type,
            args.subject.id,
            args.fromStageId,
            args.toStageId,
            args.actorId,
            args.note,
            args.at,
        );
    }
}

function rowToPipeline(row: PipelineRow): Pipeline {
    return {
        id: row.id,
        orgId: row.org_id,
        key: row.key,
        name: row.name,
        description: row.description,
        subjectType: row.subject_type,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToStage(row: StageRow): PipelineStage {
    return {
        id: row.id,
        pipelineId: row.pipeline_id,
        key: row.key,
        name: row.name,
        position: row.position,
        createdAt: row.created_at,
    };
}

function rowToPlacement(row: PlacementRow): PipelinePlacement {
    return {
        id: row.id,
        pipelineId: row.pipeline_id,
        orgId: row.org_id,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        stageId: row.stage_id,
        enteredAt: row.entered_at,
    };
}

function rowToTransition(row: TransitionRow): PipelineTransition {
    return {
        id: row.id,
        pipelineId: row.pipeline_id,
        orgId: row.org_id,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        fromStageId: row.from_stage_id,
        toStageId: row.to_stage_id,
        actorId: row.actor_id,
        note: row.note,
        at: row.at,
    };
}
