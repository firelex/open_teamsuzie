export { addressOf, splitAddressList } from './addresses.js';
export {
    EMAIL_ACTION_FORWARD,
    EMAIL_ACTION_REPLY,
    EMAIL_ACTION_REPLY_ALL,
    EMAIL_ACTION_SEND,
    EMAIL_ACTION_TYPES,
} from './actions.js';
export { NullEmailClient } from './client.js';

export type { EmailActionType } from './actions.js';
export type { EmailClient } from './client.js';
export type {
    ChangesResult,
    CreateDraftInput,
    EmailChange,
    EmailThread,
    EmailThreadDetail,
    ListThreadsInput,
    ListThreadsResult,
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
export { EmailAuthError, EmailCursorExpiredError, EmailNotFoundError, EmailRateLimitError } from './errors.js';
