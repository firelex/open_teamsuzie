import type { DepartmentEvent, EventListener } from './types.js';

/**
 * In-memory fan-out keyed by chat. Each SSE subscriber listens on one chat,
 * so concurrent chats in the same subject don't cross-pollinate timelines.
 *
 * `subscribe(null, …)` registers a wildcard listener that receives every
 * event regardless of chat, useful for cross-chat dashboards.
 *
 * Listeners that throw are logged and swallowed so one buggy subscriber
 * can't break the publish loop for the others.
 */
export class EventBus {
    private byChat = new Map<string, Set<EventListener>>();
    private wildcards = new Set<EventListener>();

    subscribe(chatId: string | null, listener: EventListener): () => void {
        if (chatId === null) {
            this.wildcards.add(listener);
            return () => { this.wildcards.delete(listener); };
        }
        let set = this.byChat.get(chatId);
        if (!set) {
            set = new Set();
            this.byChat.set(chatId, set);
        }
        set.add(listener);
        return () => { set!.delete(listener); };
    }

    publish(event: DepartmentEvent): void {
        if (event.chatId) {
            const set = this.byChat.get(event.chatId);
            if (set) {
                for (const l of set) {
                    try { l(event); } catch (err) { console.error('[events] listener threw:', err); }
                }
            }
        }
        for (const l of this.wildcards) {
            try { l(event); } catch (err) { console.error('[events] wildcard listener threw:', err); }
        }
    }
}
