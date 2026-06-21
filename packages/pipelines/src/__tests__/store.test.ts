import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import { PIPELINES_MIGRATIONS } from '../migrations.js';
import { PipelinesStore } from '../store.js';

let db: DatabaseInstance;
let store: PipelinesStore;
let nextId = 0;
let nextTime = 1700000000000;

beforeEach(() => {
    db = openDb({ path: ':memory:', migrations: PIPELINES_MIGRATIONS });
    nextId = 0;
    nextTime = 1700000000000;
    store = new PipelinesStore({
        db,
        idFactory: () => `p${++nextId}`,
        now: () => ++nextTime,
    });
});

afterEach(() => {
    db.close();
});

function seedPipeline() {
    const p = store.createPipeline({
        orgId: 'org-1',
        key: 'hire',
        name: 'Hiring',
        subjectType: 'candidate',
    });
    const s1 = store.addStage({
        pipelineId: p.id,
        key: 'applied',
        name: 'Applied',
    });
    const s2 = store.addStage({
        pipelineId: p.id,
        key: 'interview',
        name: 'Interview',
    });
    const s3 = store.addStage({ pipelineId: p.id, key: 'offer', name: 'Offer' });
    return { p, s1, s2, s3 };
}

describe('pipelines', () => {
    it('creates pipelines and reads them by id and (org, key)', () => {
        const p = store.createPipeline({
            orgId: 'org-1',
            key: 'hire',
            name: 'Hiring',
            subjectType: 'candidate',
        });
        expect(store.getPipeline(p.id)).toEqual(p);
        expect(store.getPipelineByKey('org-1', 'hire')).toEqual(p);
        expect(store.getPipelineByKey('org-2', 'hire')).toBeNull();
    });

    it('rejects duplicate (org, key) pipelines', () => {
        store.createPipeline({
            orgId: 'org-1',
            key: 'hire',
            name: 'A',
            subjectType: 'x',
        });
        expect(() =>
            store.createPipeline({
                orgId: 'org-1',
                key: 'hire',
                name: 'B',
                subjectType: 'x',
            }),
        ).toThrow();
    });

    it('cascades stages/placements/transitions when a pipeline is deleted', () => {
        const { p, s1 } = seedPipeline();
        store.placeSubject({
            pipelineId: p.id,
            subject: { type: 'candidate', id: 'c-1' },
            stageId: s1.id,
        });
        expect(store.listStages(p.id)).toHaveLength(3);
        expect(store.listPlacements({ pipelineId: p.id })).toHaveLength(1);
        expect(store.listTransitions({ pipelineId: p.id })).toHaveLength(1);
        store.deletePipeline(p.id);
        expect(store.listStages(p.id)).toEqual([]);
        expect(store.listPlacements({ pipelineId: p.id })).toEqual([]);
        expect(store.listTransitions({ pipelineId: p.id })).toEqual([]);
    });
});

describe('stages', () => {
    it('appends stages in order with strided positions', () => {
        const { p, s1, s2, s3 } = seedPipeline();
        const stages = store.listStages(p.id);
        expect(stages.map((s) => s.id)).toEqual([s1.id, s2.id, s3.id]);
        // Positions should be strictly increasing.
        expect(stages[0].position).toBeLessThan(stages[1].position);
        expect(stages[1].position).toBeLessThan(stages[2].position);
    });

    it('rejects duplicate (pipeline, key) stages', () => {
        const { p } = seedPipeline();
        expect(() =>
            store.addStage({ pipelineId: p.id, key: 'applied', name: 'Dup' }),
        ).toThrow();
    });

    it('reorderStages renumbers and returns the new order', () => {
        const { p, s1, s2, s3 } = seedPipeline();
        const reordered = store.reorderStages(p.id, [s3.id, s1.id, s2.id]);
        expect(reordered.map((s) => s.id)).toEqual([s3.id, s1.id, s2.id]);
    });

    it('removeStage refuses while placements still reference it', () => {
        const { p, s1 } = seedPipeline();
        store.placeSubject({
            pipelineId: p.id,
            subject: { type: 'candidate', id: 'c-1' },
            stageId: s1.id,
        });
        expect(() => store.removeStage(s1.id)).toThrow(/still reference/);
        store.removeSubject(p.id, { type: 'candidate', id: 'c-1' });
        expect(store.removeStage(s1.id)).toBe(true);
    });
});

describe('placements + transitions', () => {
    it('first placement records a transition with from = null', () => {
        const { p, s1 } = seedPipeline();
        const placement = store.placeSubject({
            pipelineId: p.id,
            subject: { type: 'candidate', id: 'c-1' },
            stageId: s1.id,
            actorId: 'recruiter@x',
        });
        expect(placement.stageId).toBe(s1.id);
        const history = store.listTransitions({
            pipelineId: p.id,
            subject: { type: 'candidate', id: 'c-1' },
        });
        expect(history).toHaveLength(1);
        expect(history[0].fromStageId).toBeNull();
        expect(history[0].toStageId).toBe(s1.id);
        expect(history[0].actorId).toBe('recruiter@x');
    });

    it('subsequent placeSubject updates the placement and appends a transition', () => {
        const { p, s1, s2 } = seedPipeline();
        const subject = { type: 'candidate', id: 'c-1' };
        store.placeSubject({ pipelineId: p.id, subject, stageId: s1.id });
        const moved = store.placeSubject({
            pipelineId: p.id,
            subject,
            stageId: s2.id,
            note: 'phone screen passed',
        });
        expect(moved.stageId).toBe(s2.id);
        const history = store.listTransitions({ pipelineId: p.id, subject });
        // Newest first.
        expect(history.map((t) => [t.fromStageId, t.toStageId])).toEqual([
            [s1.id, s2.id],
            [null, s1.id],
        ]);
        expect(history[0].note).toBe('phone screen passed');
    });

    it('moveSubject requires an existing placement', () => {
        const { p, s2 } = seedPipeline();
        expect(() =>
            store.moveSubject({
                pipelineId: p.id,
                subject: { type: 'candidate', id: 'ghost' },
                toStageId: s2.id,
            }),
        ).toThrow(/not placed/);
    });

    it('rejects placement with a stage from another pipeline', () => {
        const { s1: otherStage } = seedPipeline();
        const p2 = store.createPipeline({
            orgId: 'org-1',
            key: 'support',
            name: 'Support',
            subjectType: 'ticket',
        });
        expect(() =>
            store.placeSubject({
                pipelineId: p2.id,
                subject: { type: 'ticket', id: 't-1' },
                stageId: otherStage.id,
            }),
        ).toThrow(/does not belong/);
    });

    it('listPlacements filters by stage', () => {
        const { p, s1, s2 } = seedPipeline();
        store.placeSubject({
            pipelineId: p.id,
            subject: { type: 'candidate', id: 'a' },
            stageId: s1.id,
        });
        store.placeSubject({
            pipelineId: p.id,
            subject: { type: 'candidate', id: 'b' },
            stageId: s2.id,
        });
        store.placeSubject({
            pipelineId: p.id,
            subject: { type: 'candidate', id: 'c' },
            stageId: s2.id,
        });
        const stage2 = store.listPlacements({ pipelineId: p.id, stageId: s2.id });
        expect(stage2.map((pl) => pl.subjectId).sort()).toEqual(['b', 'c']);
    });

    it('removeSubject deletes the placement but keeps history', () => {
        const { p, s1, s2 } = seedPipeline();
        const subject = { type: 'candidate', id: 'c-1' };
        store.placeSubject({ pipelineId: p.id, subject, stageId: s1.id });
        store.placeSubject({ pipelineId: p.id, subject, stageId: s2.id });
        expect(store.removeSubject(p.id, subject)).toBe(true);
        expect(store.getPlacement(p.id, subject)).toBeNull();
        expect(
            store.listTransitions({ pipelineId: p.id, subject }),
        ).toHaveLength(2);
    });

    it('stage_id has an FK to pipeline_stages — invalid stage id rejected', () => {
        const { p } = seedPipeline();
        expect(() =>
            store.placeSubject({
                pipelineId: p.id,
                subject: { type: 'candidate', id: 'c-1' },
                stageId: 'does-not-exist',
            }),
        ).toThrow();
    });
});
