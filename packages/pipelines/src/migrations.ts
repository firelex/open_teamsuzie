import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * Four tables:
 *
 * - `pipelines` — one row per pipeline. (org_id, key) is unique.
 * - `pipeline_stages` — ordered stages owned by a pipeline; deletion
 *   cascades from `pipelines`.
 * - `pipeline_placements` — current location of one subject in one
 *   pipeline. UNIQUE(pipeline_id, subject_type, subject_id) so a
 *   subject can't be in two stages of the same pipeline at once.
 * - `pipeline_transitions` — append-only history. `from_stage_id`
 *   is null on first placement.
 *
 * Subjects are opaque (subject_type, subject_id) pairs; no FK to other
 * packages, matching the loose-coupling pattern used by
 * `@teamsuzie/sharing`.
 */
export const PIPELINES_MIGRATIONS: Migration[] = [
    {
        name: '20260607_create_pipelines',
        up: `
            CREATE TABLE IF NOT EXISTS pipelines (
                id            TEXT PRIMARY KEY,
                org_id        TEXT NOT NULL,
                key           TEXT NOT NULL,
                name          TEXT NOT NULL,
                description   TEXT NOT NULL DEFAULT '',
                subject_type  TEXT NOT NULL,
                created_at    INTEGER NOT NULL,
                updated_at    INTEGER NOT NULL,
                UNIQUE (org_id, key)
            );
            CREATE INDEX IF NOT EXISTS idx_pipelines_org
                ON pipelines(org_id);

            CREATE TABLE IF NOT EXISTS pipeline_stages (
                id           TEXT PRIMARY KEY,
                pipeline_id  TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
                key          TEXT NOT NULL,
                name         TEXT NOT NULL,
                position     INTEGER NOT NULL,
                created_at   INTEGER NOT NULL,
                UNIQUE (pipeline_id, key)
            );
            CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline
                ON pipeline_stages(pipeline_id, position);

            CREATE TABLE IF NOT EXISTS pipeline_placements (
                id            TEXT PRIMARY KEY,
                pipeline_id   TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
                org_id        TEXT NOT NULL,
                subject_type  TEXT NOT NULL,
                subject_id    TEXT NOT NULL,
                stage_id      TEXT NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
                entered_at    INTEGER NOT NULL,
                UNIQUE (pipeline_id, subject_type, subject_id)
            );
            CREATE INDEX IF NOT EXISTS idx_pipeline_placements_pipeline_stage
                ON pipeline_placements(pipeline_id, stage_id);
            CREATE INDEX IF NOT EXISTS idx_pipeline_placements_subject
                ON pipeline_placements(subject_type, subject_id);

            CREATE TABLE IF NOT EXISTS pipeline_transitions (
                id             TEXT PRIMARY KEY,
                pipeline_id    TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
                org_id         TEXT NOT NULL,
                subject_type   TEXT NOT NULL,
                subject_id     TEXT NOT NULL,
                from_stage_id  TEXT,
                to_stage_id    TEXT NOT NULL,
                actor_id       TEXT,
                note           TEXT,
                at             INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pipeline_transitions_subject
                ON pipeline_transitions(pipeline_id, subject_type, subject_id, at DESC);
            CREATE INDEX IF NOT EXISTS idx_pipeline_transitions_pipeline
                ON pipeline_transitions(pipeline_id, at DESC);
        `,
    },
];
