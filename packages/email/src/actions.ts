export const EMAIL_ACTION_SEND = 'email.send';
export const EMAIL_ACTION_REPLY = 'email.reply';
export const EMAIL_ACTION_FORWARD = 'email.forward';

export const EMAIL_ACTION_TYPES = [
    EMAIL_ACTION_SEND,
    EMAIL_ACTION_REPLY,
    EMAIL_ACTION_FORWARD,
] as const;

export type EmailActionType = typeof EMAIL_ACTION_TYPES[number];
