export {
    EMAIL_ACTION_FORWARD,
    EMAIL_ACTION_REPLY,
    EMAIL_ACTION_SEND,
    EMAIL_ACTION_TYPES,
} from './actions.js';
export { NullEmailClient } from './client.js';

export type { EmailActionType } from './actions.js';
export type { EmailClient } from './client.js';
export type {
    EmailAccount,
    EmailApprovalPolicy,
    EmailAttachment,
    EmailDeliveryOptions,
    EmailMessage,
    EmailProvider,
    EmailStatus,
    ForwardEmailInput,
    ListEmailMessagesInput,
    ListEmailMessagesResult,
    QueuedEmailResult,
    ReplyEmailInput,
    SendEmailInput,
} from './types.js';
