import { RouteError, type ExtractedRecord } from '@teamsuzie/webmail-browser';
import { OPERATION_NAMES, type OperationName, type Params } from '@teamsuzie/webmail-routes';
import { checkOutput, type WebmailEmailClient } from './client.js';

export interface CanaryResult {
    operation: OperationName;
    /** passed; failed with a route error; or skipped because an operation it needs input from failed or the inbox is empty. */
    outcome: 'passed' | 'failed' | 'skipped';
    error?: { code: string; message: string };
    reason?: string;
}

export const CANARY_SUBJECT = 'Route check (draft discarded automatically)';
const CANARY_BODY = 'This draft was written by an automatic check and is discarded without being sent.';

/**
 * Run operations in test mode against the live account: nothing is sent, every draft is discarded. Route errors are
 * reported per operation; sign-out and page-load errors are thrown, since they say nothing about the route.
 */
export async function runCanary(client: WebmailEmailClient, only?: OperationName[]): Promise<CanaryResult[]> {
    const wanted = new Set(only ?? OPERATION_NAMES);
    const results: CanaryResult[] = [];
    let first: ExtractedRecord | null = null;
    let inboxReadable = true;

    // The inbox listing supplies the message ids, sender and subject the other operations are tested with.
    const needsInbox = (['list_inbox', 'open_message', 'read_thread', 'search', 'reply'] as OperationName[]).some((op) => wanted.has(op));
    if (needsInbox) {
        const listing = await attempt('list_inbox', {});
        if (wanted.has('list_inbox')) results.push(listing.result);
        if (listing.records) first = listing.records[0] ?? null;
        else inboxReadable = false;
    }

    for (const operation of OPERATION_NAMES) {
        if (operation === 'list_inbox' || !wanted.has(operation)) continue;
        const params = paramsFor(operation, first, client.account.address);
        if (params === null) {
            results.push({ operation, outcome: 'skipped', reason: inboxReadable ? 'the inbox is empty' : 'list_inbox failed, so there is no message to test with' });
            continue;
        }
        results.push((await attempt(operation, params)).result);
    }
    return results;

    async function attempt(operation: OperationName, params: Params): Promise<{ result: CanaryResult; records: ExtractedRecord[] | null }> {
        try {
            const result = await client.testOperation(operation, params);
            checkOutput(operation, result);
            const records = operation === 'list_inbox' ? result.extracted.messages as ExtractedRecord[] : null;
            return { result: { operation, outcome: 'passed' }, records };
        } catch (error) {
            if (error instanceof RouteError) {
                return { result: { operation, outcome: 'failed', error: { code: error.code, message: error.message } }, records: null };
            }
            throw error;
        }
    }
}

function paramsFor(operation: OperationName, first: ExtractedRecord | null, account: string): Params | null {
    switch (operation) {
        case 'read_account':
        case 'check_sent':
            return {};
        case 'compose_send':
            return { '$draft.to': account, '$draft.subject': CANARY_SUBJECT, '$draft.body': CANARY_BODY };
        case 'open_message':
            return first ? { $message_id: first.id! } : null;
        case 'read_thread':
            return first ? { $thread_id: first.thread_id ?? first.id! } : null;
        case 'search':
            return first ? { $query: first.subject!.split(/\s+/).slice(0, 3).join(' ') } : null;
        case 'reply':
            return first ? { $message_id: first.id!, '$draft.to': first.from!, '$draft.body': CANARY_BODY } : null;
        case 'list_inbox':
            return {};
    }
}
