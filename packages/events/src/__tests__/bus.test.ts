import { describe, expect, it, vi } from 'vitest';

import { EventBus } from '../bus.js';
import type { DepartmentEvent } from '../types.js';

function event(over: Partial<DepartmentEvent> = {}): DepartmentEvent {
    return {
        id: 1,
        subjectId: 'p1',
        chatId: 'c1',
        ts: '2026-01-01T00:00:00.000Z',
        source: 'system',
        kind: 'status',
        payload: {},
        correlationId: null,
        ...over,
    };
}

describe('EventBus', () => {
    it('delivers an event only to listeners on its chatId', () => {
        const bus = new EventBus();
        const onC1 = vi.fn();
        const onC2 = vi.fn();
        bus.subscribe('c1', onC1);
        bus.subscribe('c2', onC2);

        bus.publish(event({ chatId: 'c1' }));
        expect(onC1).toHaveBeenCalledTimes(1);
        expect(onC2).not.toHaveBeenCalled();
    });

    it('delivers an event to wildcard listeners regardless of chat', () => {
        const bus = new EventBus();
        const wildcard = vi.fn();
        const onC1 = vi.fn();
        bus.subscribe(null, wildcard);
        bus.subscribe('c1', onC1);

        bus.publish(event({ chatId: 'c1' }));
        bus.publish(event({ chatId: 'c2' }));
        expect(wildcard).toHaveBeenCalledTimes(2);
        expect(onC1).toHaveBeenCalledTimes(1);
    });

    it('delivers a chat-less event only to wildcard listeners', () => {
        const bus = new EventBus();
        const wildcard = vi.fn();
        const onC1 = vi.fn();
        bus.subscribe(null, wildcard);
        bus.subscribe('c1', onC1);

        bus.publish(event({ chatId: null }));
        expect(wildcard).toHaveBeenCalledTimes(1);
        expect(onC1).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe function that stops further delivery', () => {
        const bus = new EventBus();
        const listener = vi.fn();
        const unsub = bus.subscribe('c1', listener);
        bus.publish(event({ chatId: 'c1' }));
        unsub();
        bus.publish(event({ chatId: 'c1' }));
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not let one throwing listener break the others', () => {
        const bus = new EventBus();
        const throwing = vi.fn(() => { throw new Error('boom'); });
        const other = vi.fn();
        bus.subscribe('c1', throwing);
        bus.subscribe('c1', other);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        bus.publish(event({ chatId: 'c1' }));
        expect(other).toHaveBeenCalledTimes(1);
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });
});
