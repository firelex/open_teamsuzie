/**
 * Cross-package integration test: records + pipelines + activity.
 *
 * Proves the three primitives compose without any host wiring — a
 * record is created, placed in a pipeline, moved through stages, and
 * each interaction is mirrored as an activity entry. All three stores
 * share a single SQLite database and a single org id, the way a host
 * app would use them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import { ACTIVITY_MIGRATIONS, ActivityStore } from '@teamsuzie/activity';
import { PIPELINES_MIGRATIONS, PipelinesStore } from '@teamsuzie/pipelines';

import { RECORDS_MIGRATIONS } from '../migrations.js';
import { RecordsStore } from '../store.js';

const ORG_ID = 'org-1';

let db: DatabaseInstance;
let records: RecordsStore;
let pipelines: PipelinesStore;
let activity: ActivityStore;
let nextId = 0;
let nextTime = 1700000000000;

beforeEach(() => {
    db = openDb({
        path: ':memory:',
        migrations: [
            ...RECORDS_MIGRATIONS,
            ...PIPELINES_MIGRATIONS,
            ...ACTIVITY_MIGRATIONS,
        ],
    });
    nextId = 0;
    nextTime = 1700000000000;
    const idFactory = () => `i${++nextId}`;
    const now = () => ++nextTime;
    records = new RecordsStore({ db, idFactory, now });
    pipelines = new PipelinesStore({ db, idFactory, now });
    activity = new ActivityStore({ db, idFactory, now });
});

afterEach(() => {
    db.close();
});

describe('records + pipelines + activity', () => {
    it('lets a host compose all three around the same subject', () => {
        // 1. Define a record type + create a record.
        const assetType = records.createRecordType({
            orgId: ORG_ID,
            key: 'asset',
            name: 'Asset',
        });
        const record = records.createRecord({
            orgId: ORG_ID,
            typeId: assetType.id,
            title: 'Pump Alpha',
            customFields: { serial: 'X-9' },
            createdBy: 'alice@x',
        });
        const subject = { type: 'record', id: record.id };
        activity.append({
            orgId: ORG_ID,
            subject,
            kind: 'record.created',
            summary: `Created ${record.title}`,
            actor: { id: 'alice@x', type: 'user' },
        });

        // 2. Define a pipeline + stages and place the record on it.
        const pipeline = pipelines.createPipeline({
            orgId: ORG_ID,
            key: 'commissioning',
            name: 'Commissioning',
            subjectType: 'record',
        });
        const inspect = pipelines.addStage({
            pipelineId: pipeline.id,
            key: 'inspect',
            name: 'Inspect',
        });
        const install = pipelines.addStage({
            pipelineId: pipeline.id,
            key: 'install',
            name: 'Install',
        });
        const live = pipelines.addStage({
            pipelineId: pipeline.id,
            key: 'live',
            name: 'Live',
        });

        pipelines.placeSubject({
            pipelineId: pipeline.id,
            subject,
            stageId: inspect.id,
            actorId: 'alice@x',
        });
        activity.append({
            orgId: ORG_ID,
            subject,
            kind: 'stage.placed',
            summary: `Placed on ${pipeline.name} at ${inspect.name}`,
            actor: { id: 'alice@x', type: 'user' },
            metadata: { pipelineId: pipeline.id, stageId: inspect.id },
        });

        // 3. Move through the pipeline; record each transition as activity.
        for (const toStage of [install, live]) {
            const move = pipelines.moveSubject({
                pipelineId: pipeline.id,
                subject,
                toStageId: toStage.id,
                actorId: 'bob@x',
            });
            activity.append({
                orgId: ORG_ID,
                subject,
                kind: 'stage.moved',
                summary: `Moved to ${toStage.name}`,
                actor: { id: 'bob@x', type: 'user' },
                metadata: {
                    pipelineId: pipeline.id,
                    stageId: move.stageId,
                },
            });
        }

        // 4. A regular comment touches activity but neither store.
        activity.append({
            orgId: ORG_ID,
            subject,
            kind: 'comment.added',
            summary: 'Commissioned and online',
            body: 'Passed all acceptance checks.',
            actor: { id: 'bob@x', type: 'user' },
        });

        // --- Verify composed state -------------------------------------
        // Record is now at the final stage; pipeline history covers the
        // initial placement plus both moves.
        const placement = pipelines.getPlacement(pipeline.id, subject);
        expect(placement?.stageId).toBe(live.id);

        const transitions = pipelines.listTransitions({
            pipelineId: pipeline.id,
            subject,
        });
        expect(
            transitions.map((t) => [t.fromStageId, t.toStageId]),
        ).toEqual([
            [install.id, live.id],
            [inspect.id, install.id],
            [null, inspect.id],
        ]);

        // Activity timeline mirrors the lifecycle. Newest first.
        const timeline = activity.listBySubject({ orgId: ORG_ID, subject });
        expect(timeline.map((e) => e.kind)).toEqual([
            'comment.added',
            'stage.moved',
            'stage.moved',
            'stage.placed',
            'record.created',
        ]);
        // Pipeline-aware events carry the stage id in metadata.
        const stageMoves = timeline.filter((e) => e.kind === 'stage.moved');
        expect(stageMoves.map((e) => e.metadata.stageId)).toEqual([
            live.id,
            install.id,
        ]);

        // Record edits are independent of pipeline state — the record
        // is still readable by id and round-trips its custom fields.
        const fresh = records.getRecord(record.id);
        expect(fresh?.customFields).toEqual({ serial: 'X-9' });
    });

    it('host cleanup: deleting a record cascades records-side, and host calls activity + pipelines explicitly', () => {
        // Per the loose-coupling pattern: there is no FK across packages,
        // so the host owns cross-store cleanup.
        const type = records.createRecordType({
            orgId: ORG_ID,
            key: 'asset',
            name: 'Asset',
        });
        const record = records.createRecord({
            orgId: ORG_ID,
            typeId: type.id,
            title: 'Pump 1',
        });
        const subject = { type: 'record', id: record.id };

        const pipeline = pipelines.createPipeline({
            orgId: ORG_ID,
            key: 'commissioning',
            name: 'Commissioning',
            subjectType: 'record',
        });
        const stage = pipelines.addStage({
            pipelineId: pipeline.id,
            key: 'inspect',
            name: 'Inspect',
        });
        pipelines.placeSubject({
            pipelineId: pipeline.id,
            subject,
            stageId: stage.id,
        });
        activity.append({
            orgId: ORG_ID,
            subject,
            kind: 'record.created',
            summary: 'created',
        });

        // Host-side delete sequence.
        records.deleteRecord(record.id);
        pipelines.removeSubject(pipeline.id, subject);
        activity.removeForSubject(ORG_ID, subject);

        expect(records.getRecord(record.id)).toBeNull();
        expect(pipelines.getPlacement(pipeline.id, subject)).toBeNull();
        expect(activity.countBySubject(ORG_ID, subject)).toBe(0);
        // Pipeline transitions intentionally retained — activity log is
        // authoritative if hosts want a full delete trail; the host can
        // also drop them by calling the relevant package APIs.
        expect(
            pipelines.listTransitions({ pipelineId: pipeline.id, subject }),
        ).toHaveLength(1);
    });
});
