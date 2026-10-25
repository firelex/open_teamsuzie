import type { ProviderKey, Route } from '@teamsuzie/webmail-routes';
import { GMAIL_SEED_ROUTE } from './gmail.js';
import { OUTLOOK_SEED_ROUTE } from './outlook.js';

/** The route each provider starts with on a fresh install. Replaced (never merged) when relearned. */
export const SEED_ROUTES: Record<ProviderKey, Route> = {
    gmail: GMAIL_SEED_ROUTE,
    outlook: OUTLOOK_SEED_ROUTE,
};
