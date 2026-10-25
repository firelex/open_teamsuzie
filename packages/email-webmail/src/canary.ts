import { RouteError, UnreadableValueError, type ExtractedRecord } from '@teamsuzie/webmail-browser';
import { OPERATION_NAMES, type OperationName, type Params } from '@teamsuzie/webmail-routes';
import { checkOutput, type WebmailEmailClient } from './client.js';

export interface CanaryResult {
    operation: OperationName;
    /**
     * passed; failed with a route error; unreadable when the route worked but a value (such as a date) could not be
     * read, which relearning cannot fix; or skipped because an operation it needs input from failed or the inbox is empty.
     */
    outcome: 'passed' | 'failed' | 'unreadable' | 'skipped';
    error?: { code: string; message: string };
    reason?: string;
}

// Short, so test runs have little to type; "Route check" makes any draft a failed test leaves easy to find.
export const CANARY_SUBJECT = 'Route check';
const CANARY_BODY = 'Route check.';

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
            if (error instanceof UnreadableValueError) {
                return { result: { operation, outcome: 'unreadable', error: { code: 'unreadable_value', message: error.message } }, records: null };
            }
            throw error;
        }
    }
}

export interface TestParams {
    params: Partial<Record<OperationName, Params>>;
    /**
     * The same operations' parameters for a second, different message (another subject and sender where the inbox
     * has one), so a repair can be checked to work for any message, not only the one it was tested on.
     */
    alternate: Partial<Record<OperationName, Params>>;
    /** Why the inbox could not be listed, when it could not; operations that need a message then have no parameters. */
    inboxError: RouteError | UnreadableValueError | null;
}

/**
 * Test parameters for every operation, taken from the live inbox (read only). When the inbox cannot be listed, or
 * is empty, operations that need a message are left out.
 */
export async function buildTestParams(client: WebmailEmailClient): Promise<TestParams> {
    let first: ExtractedRecord | null = null;
    let second: ExtractedRecord | null = null;
    let inboxError: RouteError | UnreadableValueError | null = null;
    try {
        const listing = await client.testOperation('list_inbox', {});
        checkOutput('list_inbox', listing);
        const messages = listing.extracted.messages as ExtractedRecord[];
        first = messages[0] ?? null;
        // Prefer a message that differs from the first in both subject and sender.
        second = messages.slice(1).find((m) => m.subject !== first!.subject && m.from !== first!.from)
            ?? messages.slice(1).find((m) => m.subject !== first!.subject)
            ?? null;
    } catch (error) {
        if (!(error instanceof RouteError || error instanceof UnreadableValueError)) throw error;
        inboxError = error;
    }
    const params: Partial<Record<OperationName, Params>> = {};
    const alternate: Partial<Record<OperationName, Params>> = {};
    for (const operation of OPERATION_NAMES) {
        const p = paramsFor(operation, first, client.account.address);
        if (p !== null) params[operation] = p;
        if (!MESSAGE_OPERATIONS.has(operation)) continue;
        const a = paramsFor(operation, second, client.account.address);
        if (a !== null) alternate[operation] = a;
    }
    return { params, alternate, inboxError };
}

/** Operations whose parameters come from a particular message. */
const MESSAGE_OPERATIONS = new Set<OperationName>(['open_message', 'read_thread', 'search', 'reply']);

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
