/**
 * Opaque (type, id) reference to whatever the pipeline operates on. The
 * package does not enforce a fixed enum — host apps decide subject types
 * (e.g. `record`, `matter`, `candidate`, `ticket`). Convention is that a
 * single pipeline pins itself to one subject_type via `Pipeline.subjectType`,
 * but the placement table doesn't require it — host apps can mix if they
 * really need to, at their own risk.
 */
export interface SubjectRef {
    type: string;
    id: string;
}

/**
 * A stage-based workflow. Stages are ordered separately in the
 * {@link PipelineStage} table; the pipeline owns the namespace.
 * `subjectType` is advisory metadata so admin UIs can pre-filter
 * placement candidates; nothing in the store enforces it.
 */
export interface Pipeline {
    id: string;
    orgId: string;
    key: string;
    name: string;
    description: string;
    subjectType: string;
    createdAt: number;
    updatedAt: number;
}

export interface CreatePipelineInput {
    orgId: string;
    key: string;
    name: string;
    description?: string;
    subjectType: string;
}

export interface UpdatePipelineInput {
    name?: string;
    description?: string;
}

export interface PipelineStage {
    id: string;
    pipelineId: string;
    key: string;
    name: string;
    /** Integer rank; lower is earlier. Gaps are allowed and used by `reorderStages`. */
    position: number;
    createdAt: number;
}

export interface AddStageInput {
    pipelineId: string;
    key: string;
    name: string;
    /** Defaults to the end of the pipeline. */
    position?: number;
}

export interface UpdateStageInput {
    name?: string;
    position?: number;
}

/**
 * Current location of one subject inside one pipeline. There is at most
 * one placement per (pipelineId, subjectType, subjectId) — moving the
 * subject updates this row and appends a row to
 * {@link PipelineTransition}.
 */
export interface PipelinePlacement {
    id: string;
    pipelineId: string;
    orgId: string;
    subjectType: string;
    subjectId: string;
    stageId: string;
    enteredAt: number;
}

/**
 * One transition row. `fromStageId` is null on the initial placement.
 * `at` is when the transition was recorded.
 */
export interface PipelineTransition {
    id: string;
    pipelineId: string;
    orgId: string;
    subjectType: string;
    subjectId: string;
    fromStageId: string | null;
    toStageId: string;
    actorId: string | null;
    note: string | null;
    at: number;
}

export interface PlaceSubjectInput {
    pipelineId: string;
    subject: SubjectRef;
    stageId: string;
    actorId?: string | null;
    note?: string | null;
}

export interface MoveSubjectInput {
    pipelineId: string;
    subject: SubjectRef;
    toStageId: string;
    actorId?: string | null;
    note?: string | null;
}

export interface ListPlacementsOptions {
    pipelineId: string;
    /** Filter to a specific stage. */
    stageId?: string;
}

export interface ListTransitionsOptions {
    pipelineId: string;
    subject?: SubjectRef;
    /** Default 100. Capped at 500. */
    limit?: number;
}
