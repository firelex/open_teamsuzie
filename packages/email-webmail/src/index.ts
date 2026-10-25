export { OPERATION_GOALS, OPERATION_OUTPUTS, describeOutput, type OperationOutput } from './goals.js';
export { SEED_ROUTES } from './routes/index.js';
export { GMAIL_SEED_ROUTE } from './routes/gmail.js';
export { OUTLOOK_SEED_ROUTE } from './routes/outlook.js';
export { FileRouteStore } from './route-store.js';
export { WebmailEmailClient, WebmailUnsupportedError, checkOutput, type WebmailAccount, type WebmailClientDeps } from './client.js';
export { runCanary, CANARY_SUBJECT, type CanaryResult } from './canary.js';
