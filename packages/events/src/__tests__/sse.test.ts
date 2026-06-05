import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { EventBus } from '../bus.js';
import { subscribeSse } from '../sse.js';
import type { DepartmentEvent } from '../types.js';

function event(over: Partial<DepartmentEvent> = {}): DepartmentEvent {
    return {
        id: 1,
        subjectId: 'p1',
        chatId: 'c1',
        ts: '2026-01-01T00:00:00.000Z',
        source: 'system',
        kind: 'status',
        payload: { ok: true },
        correlationId: null,
        ...over,
    };
}

interface FakeRes {
    req: EventEmitter;
    set: ReturnType<typeof vi.fn>;
    flushHeaders: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    writes: string[];
}

function makeFakeRes(): FakeRes {
    const writes: string[] = [];
    return {
        req: new EventEmitter(),
        set: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn((chunk: string) => { writes.push(chunk); return true; }),
        writes,
    };
}

describe('subscribeSse', () => {
    it('writes SSE headers, flushes backfill, and forwards published events', () => {
        const bus = new EventBus();
        const res = makeFakeRes();
        const backfill = [event({ id: 1, kind: 'a' }), event({ id: 2, kind: 'b' })];

        subscribeSse({
            // Cast through unknown — the helper only touches the fields the
            // fake provides.
            res: res as unknown as Parameters<typeof subscribeSse>[0]['res'],
            bus,
            chatId: 'c1',
            backfill,
            heartbeatMs: 0,
        });

        expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
            'Content-Type': 'text/event-stream',
        }));
        expect(res.flushHeaders).toHaveBeenCalled();
        expect(res.writes.map((s) => s.trim())).toEqual([
            `data: ${JSON.stringify(backfill[0])}`,
            `data: ${JSON.stringify(backfill[1])}`,
        ]);

        const live = event({ id: 3, kind: 'live' });
        bus.publish(live);
        expect(res.writes[2].trim()).toBe(`data: ${JSON.stringify(live)}`);
    });

    it('unsubscribes on the request close event', () => {
        const bus = new EventBus();
        const res = makeFakeRes();
        subscribeSse({
            res: res as unknown as Parameters<typeof subscribeSse>[0]['res'],
            bus,
            chatId: 'c1',
            backfill: [],
            heartbeatMs: 0,
        });

        res.req.emit('close');
        bus.publish(event({ id: 99 }));
        // No additional writes after close.
        expect(res.writes).toHaveLength(0);
    });

    it('uses the custom serializer when provided', () => {
        const bus = new EventBus();
        const res = makeFakeRes();
        subscribeSse({
            res: res as unknown as Parameters<typeof subscribeSse>[0]['res'],
            bus,
            chatId: 'c1',
            backfill: [event({ id: 1 })],
            heartbeatMs: 0,
            serialize: (e) => `id=${e.id}`,
        });
        expect(res.writes[0].trim()).toBe('data: id=1');
    });
});
