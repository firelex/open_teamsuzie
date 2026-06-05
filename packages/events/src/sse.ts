import type { Response } from 'express';
import type { EventBus } from './bus.js';
import type { DepartmentEvent } from './types.js';

export interface SubscribeSseOptions {
    res: Response;
    bus: EventBus;
    /** Chat to subscribe to. `null` registers a wildcard listener. */
    chatId: string | null;
    /** Events to flush to the client before live subscription begins. */
    backfill: DepartmentEvent[];
    /** Heartbeat interval in ms. Set to 0 to disable. Default 15s. */
    heartbeatMs?: number;
    /** Serializer override — defaults to JSON.stringify of the event. */
    serialize?: (event: DepartmentEvent) => string;
}

/**
 * Wire up the SSE protocol for one client: set headers, flush backfill,
 * subscribe to the bus, send heartbeats, and clean up on close. Returns
 * an unsubscribe function so the caller can tear the subscription down
 * early if needed.
 *
 * The host route is responsible for resolving `chatId` and computing
 * `backfill` from its store — this helper stays neutral about where the
 * data comes from.
 */
export function subscribeSse(opts: SubscribeSseOptions): () => void {
    const { res, bus, chatId, backfill } = opts;
    const heartbeatMs = opts.heartbeatMs ?? 15_000;
    const serialize = opts.serialize ?? ((e) => JSON.stringify(e));

    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    for (const ev of backfill) {
        res.write(`data: ${serialize(ev)}\n\n`);
    }

    const unsub = bus.subscribe(chatId, (ev) => {
        res.write(`data: ${serialize(ev)}\n\n`);
    });

    const heartbeat = heartbeatMs > 0
        ? setInterval(() => res.write(`: ping\n\n`), heartbeatMs)
        : null;

    const cleanup = () => {
        if (heartbeat) clearInterval(heartbeat);
        unsub();
    };

    res.req?.on('close', cleanup);
    return cleanup;
}
