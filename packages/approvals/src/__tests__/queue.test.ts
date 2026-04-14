import { describe, it, expect, beforeEach } from 'vitest';
import {
    ApprovalQueue,
    ApprovalQueueError,
    InMemoryApprovalStore,
    type ApprovalDispatcher,
} from '../index.js';

interface EmailPayload {
    to: string;
    subject: string;
    body: string;
}

let store: InMemoryApprovalStore;
let queue: ApprovalQueue;

beforeEach(() => {
    store = new InMemoryApprovalStore();
    queue = new ApprovalQueue({ store });
});

function makeDispatcher(
    behavior: 'success' | 'failure' | 'throw' = 'success',
): { dispatcher: ApprovalDispatcher<EmailPayload>; called: { count: number; lastItem: unknown } } {
    const called = { count: 0, lastItem: undefined as unknown };
    return {
        called,
        dispatcher: {
            action_type: 'email.send',
            async dispatch(item) {
                called.count += 1;
                called.lastItem = item;
                if (behavior === 'success') return { success: true };
                if (behavior === 'failure') return { success: false, error: 'provider rejected' };
                throw new Error('dispatcher blew up');
            },
        },
    };
}

describe('propose', () => {
    it('creates a pending item with assigned id and timestamps', async () => {
        const item = await queue.propose<EmailPayload>({
            subject_id: 'agent-1',
            action_type: 'email.send',
            payload: { to: 'a@b.com', subject: 'hi', body: 'hello' },
        });
        expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(item.status).toBe('pending');
        expect(item.created_at).toBeInstanceOf(Date);
    });

    it('rejects empty subject_id / action_type', async () => {
        await expect(queue.propose({ subject_id: '', action_type: 'x', payload: {} }))
            .rejects.toThrow(ApprovalQueueError);
        await expect(queue.propose({ subject_id: 'a', action_type: '', payload: {} }))
            .rejects.toThrow(ApprovalQueueError);
    });
});

describe('review', () => {
    it('transitions pending → approved', async () => {
        const item = await queue.propose<EmailPayload>({
            subject_id: 'agent-1',
            action_type: 'email.send',
            payload: { to: 'a@b.com', subject: 'hi', body: 'hello' },
        });
        const reviewed = await queue.review<EmailPayload>(item.id, {
            reviewer_id: 'user-1',
            verdict: 'approve',
        });
        expect(reviewed.status).toBe('approved');
        expect(reviewed.review?.verdict).toBe('approve');
    });

    it('transitions pending → rejected', async () => {
        const item = await queue.propose<EmailPayload>({
            subject_id: 'agent-1',
            action_type: 'email.send',
            payload: { to: 'a@b.com', subject: 'hi', body: 'hello' },
        });
        const reviewed = await queue.review<EmailPayload>(item.id, {
            reviewer_id: 'user-1',
            verdict: 'reject',
            reason: 'off-policy',
        });
        expect(reviewed.status).toBe('rejected');
        expect(reviewed.review?.reason).toBe('off-policy');
    });

    it('applies edited_payload on approve', async () => {
        const item = await queue.propose<EmailPayload>({
            subject_id: 'agent-1',
            action_type: 'email.send',
            payload: { to: 'a@b.com', subject: 'original', body: 'hello' },
        });
        const reviewed = await queue.review<EmailPayload>(item.id, {
            reviewer_id: 'user-1',
            verdict: 'approve',
            edited_payload: { to: 'a@b.com', subject: 'edited', body: 'hello' },
        });
        expect(reviewed.payload.subject).toBe('edited');
    });

    it('refuses to re-review a non-pending item', async () => {
        const item = await queue.propose<EmailPayload>({
            subject_id: 'agent-1',
            action_type: 'email.send',
            payload: { to: 'a@b.com', subject: 'hi', body: 'hello' },
        });
        await queue.review<EmailPayload>(item.id, { reviewer_id: 'u', verdict: 'approve' });
        const err = await queue
            .review<EmailPayload>(item.id, { reviewer_id: 'u', verdict: 'reject' })
            .catch(e => e);
        expect(err).toBeInstanceOf(ApprovalQueueError);
        expect(err.code).toBe('INVALID_STATE');
    });

    it('404s on unknown id', async () => {
        const err = await queue
            .review('00000000-0000-4000-8000-000000000000', { reviewer_id: 'u', verdict: 'approve' })
            .catch(e => e);
        expect(err).toBeInstanceOf(ApprovalQueueError);
        expect(err.code).toBe('NOT_FOUND');
    });
});

describe('dispatch', () => {
    it('runs the registered dispatcher and marks dispatched', async () => {
        const { dispatcher, called } = makeDispatcher('success');
        queue.registerDispatcher(dispatcher);

        const item = await queue.propose<EmailPayload>({
            subject_id: 'agent-1',
            action_type: 'email.send',
            payload: { to: 'a@b.com', subject: 'hi', body: 'hello' },
        });
        await queue.review<EmailPayload>(item.id, { reviewer_id: 'u', verdict: 'approve' });
        const dispatched = await queue.dispatch<EmailPayload>(item.id);

        expect(called.count).toBe(1);
        expect(dispatched.status).toBe('dispatched');
        expect(dispatched.dispatch?.result).toBe('success');
    });

    it('records failure when dispatcher returns failure', async () => {
        const { dispatcher } = makeDispatcher('failure');
        queue.registerDispatcher(dispatcher);

        const item = await queue.propose<EmailPayload>({
            subject_id: 'agent-1',
            action_type: 'email.send',
            payload: { to: 'a@b.com', subject: 'hi', body: 'hello' },
        });
        await queue.review<EmailPayload>(item.id, { reviewer_id: 'u', verdict: 'approve' });
        const dispatched = await queue.dispatch<EmailPayload>(item.id);

        expect(dispatched.status).toBe('failed');
        expect(dispatched.dispatch?.error).toBe('provider rejected');
    });

    it('catches thrown errors and marks failed', async () => {
        const { dispatcher } = makeDispatcher('throw');
        queue.registerDispatcher(dispatcher);

        const item = await queue.propose<EmailPayload>({
            subject_id: 'agent-1',
            action_type: 'email.send',
            payload: { to: 'a@b.com', subject: 'hi', body: 'hello' },
        });
        await queue.review<EmailPayload>(item.id, { reviewer_id: 'u', verdict: 'approve' });
        const dispatched = await queue.dispatch<EmailPayload>(item.id);

        expect(dispatched.status).toBe('failed');
        expect(dispatched.dispatch?.error).toBe('dispatcher blew up');
    });

    it('refuses to dispatch if no dispatcher is registered', async () => {
        const item = await queue.propose<EmailPayload>({
            subject_id: 'agent-1',
            action_type: 'email.send',
            payload: { to: 'a@b.com', subject: 'hi', body: 'hello' },
        });
        await queue.review<EmailPayload>(item.id, { reviewer_id: 'u', verdict: 'approve' });
        const err = await queue.dispatch<EmailPayload>(item.id).catch(e => e);
        expect(err).toBeInstanceOf(ApprovalQueueError);
        expect(err.code).toBe('NO_DISPATCHER');
    });

    it('refuses to dispatch non-approved items', async () => {
        const { dispatcher } = makeDispatcher('success');
        queue.registerDispatcher(dispatcher);

        const item = await queue.propose<EmailPayload>({
            subject_id: 'agent-1',
            action_type: 'email.send',
            payload: { to: 'a@b.com', subject: 'hi', body: 'hello' },
        });
        const err = await queue.dispatch<EmailPayload>(item.id).catch(e => e);
        expect(err).toBeInstanceOf(ApprovalQueueError);
        expect(err.code).toBe('INVALID_STATE');
    });

    it('refuses to re-dispatch a completed item', async () => {
        const { dispatcher } = makeDispatcher('success');
        queue.registerDispatcher(dispatcher);

        const item = await queue.propose<EmailPayload>({
            subject_id: 'agent-1',
            action_type: 'email.send',
            payload: { to: 'a@b.com', subject: 'hi', body: 'hello' },
        });
        await queue.review<EmailPayload>(item.id, { reviewer_id: 'u', verdict: 'approve' });
        await queue.dispatch<EmailPayload>(item.id);
        const err = await queue.dispatch<EmailPayload>(item.id).catch(e => e);
        expect(err).toBeInstanceOf(ApprovalQueueError);
        expect(err.code).toBe('INVALID_STATE');
    });
});

describe('dispatcher registry', () => {
    it('refuses duplicate action_type registration', () => {
        queue.registerDispatcher({
            action_type: 'x',
            async dispatch() { return { success: true }; },
        });
        try {
            queue.registerDispatcher({
                action_type: 'x',
                async dispatch() { return { success: true }; },
            });
            expect.fail('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(ApprovalQueueError);
            expect((err as ApprovalQueueError).code).toBe('DISPATCHER_CONFLICT');
        }
    });

    it('exposes registered action types', () => {
        queue.registerDispatcher({ action_type: 'a', async dispatch() { return { success: true }; } });
        queue.registerDispatcher({ action_type: 'b', async dispatch() { return { success: true }; } });
        expect(queue.listActionTypes().sort()).toEqual(['a', 'b']);
    });
});

describe('list', () => {
    it('filters by status', async () => {
        const a = await queue.propose({ subject_id: 'agent-1', action_type: 't', payload: {} });
        const b = await queue.propose({ subject_id: 'agent-1', action_type: 't', payload: {} });
        await queue.review(a.id, { reviewer_id: 'u', verdict: 'reject' });

        expect((await queue.list({ status: 'pending' })).map(i => i.id)).toEqual([b.id]);
        expect((await queue.list({ status: 'rejected' })).map(i => i.id)).toEqual([a.id]);
        expect((await queue.list({ status: ['pending', 'rejected'] })).length).toBe(2);
    });

    it('filters by subject_id and action_type', async () => {
        await queue.propose({ subject_id: 'agent-1', action_type: 'x', payload: {} });
        await queue.propose({ subject_id: 'agent-2', action_type: 'x', payload: {} });
        await queue.propose({ subject_id: 'agent-1', action_type: 'y', payload: {} });

        expect((await queue.list({ subject_id: 'agent-1' })).length).toBe(2);
        expect((await queue.list({ action_type: 'x' })).length).toBe(2);
        expect((await queue.list({ subject_id: 'agent-1', action_type: 'x' })).length).toBe(1);
    });

    it('applies limit and offset', async () => {
        for (let i = 0; i < 5; i++) {
            await queue.propose({ subject_id: 'a', action_type: 't', payload: { i } });
        }
        expect((await queue.list({ limit: 2 })).length).toBe(2);
        expect((await queue.list({ limit: 2, offset: 3 })).length).toBe(2);
    });
});
