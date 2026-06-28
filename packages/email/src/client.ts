import type {
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

    async send(): Promise<QueuedEmailResult> {
        throw new Error('No email client configured');
    }
}
