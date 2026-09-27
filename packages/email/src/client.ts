import type {
    ChangesResult,
    CreateDraftInput,
    EmailAttachment,
    EmailThreadDetail,
    ListThreadsInput,
    ListThreadsResult,
    EmailAccount,
    EmailMessage,
    EmailStatus,
    ForwardEmailInput,
    ListEmailMessagesInput,
    ListEmailMessagesResult,
    QueuedEmailResult,
    ReplyEmailInput,
    SendEmailInput,
} from './types.js';

export interface EmailClient {
    status(): EmailStatus;
    probe?(): Promise<boolean>;
    listAccounts?(): Promise<EmailAccount[]>;
    listMessages?(input?: ListEmailMessagesInput): Promise<ListEmailMessagesResult>;
    getMessage?(id: string): Promise<EmailMessage>;
    send(input: SendEmailInput): Promise<QueuedEmailResult>;
    reply?(input: ReplyEmailInput): Promise<QueuedEmailResult>;
    forward?(input: ForwardEmailInput): Promise<QueuedEmailResult>;
    /** Reply to the sender and every other recipient of the message. */
    replyAll?(input: ReplyEmailInput): Promise<QueuedEmailResult>;

    // Thread-level members, for hosts that keep a local copy of a mailbox.
    listThreads?(input?: ListThreadsInput): Promise<ListThreadsResult>;
    getThread?(id: string): Promise<EmailThreadDetail>;
    setRead?(messageIds: string[], read: boolean): Promise<void>;
    modifyLabels?(threadId: string, add: string[], remove: string[]): Promise<void>;
    /** Changes after `cursor`. A null cursor starts now: no changes, and the current cursor. */
    changesSince?(cursor: string | null): Promise<ChangesResult>;
    /** One attachment of a message, by its `id`, with its base64 `content`. */
    openAttachment?(messageId: string, attachmentId: string): Promise<EmailAttachment>;
    createDraft?(input: CreateDraftInput): Promise<{ draftId: string }>;
}

export class NullEmailClient implements EmailClient {
    status(): EmailStatus {
        return {
            configured: false,
            reachable: false,
            lastError: 'No email client configured',
        };
    }

    async probe(): Promise<boolean> {
        return false;
    }

    async send(_input: SendEmailInput): Promise<QueuedEmailResult> {
        throw new Error('No email client configured');
    }
}
