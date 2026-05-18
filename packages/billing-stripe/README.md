# @teamsuzie/billing-stripe

Stripe credit-balance billing for Team Suzie orgs. Lives in its own package by
design — `@teamsuzie/shared-auth`'s README explicitly excludes billing models
from the OSS auth layer, so this package builds on top of shared-auth rather
than inside it.

## What's here

- **Models:** `OrgBilling` (per-org credit balance + Stripe customer/payment-method
  refs), `BillingTransaction` (audit log of every credit movement).
- **Service:** `BillingService` — Stripe customer + Checkout session creation
  for signup and top-up, webhook handlers for `checkout.session.completed` and
  `payment_intent.{succeeded,failed}`, atomic `deductCredits` (FOR UPDATE row
  lock + cache + auto-recharge trigger), `getBillingStatus`, `getTransactions`,
  `setAutoRecharge`.
- **Router:** `createBillingRouter({ service, requireAuth })` — mounts at any
  prefix and yields `/setup`, `/topup`, `/status`, `/auto-recharge`,
  `/transactions`. The Stripe webhook route is separate
  (`createBillingWebhookRouter`) because it needs `express.raw()` body parsing,
  not `express.json()`.
- **Middleware:** `createRequireCreditedOrg({ service })` — gates a route on the
  caller's org having `credit_balance > 0`. Returns HTTP 402 with the
  checkout URL when blocked.

## What's explicitly *not* here

- **BYOK mode.** The upstream private build supports per-org "bring-your-own
  Anthropic/OpenAI key" billing that skips Stripe entirely. This package is
  Stripe-only — apps that want BYOK can layer it on top.
- **Multi-currency.** Everything is USD cents. Multi-currency adds enough
  schema churn that it's worth a separate package.
- **A `ConfigService`.** The upstream version reads top-up amounts and the
  low-balance threshold from a DB-backed config table. Here the same values
  come from the `BillingService` constructor — apps wire them from env or
  their own config layer.

## Wiring

```ts
import { Sequelize } from 'sequelize-typescript';
import { SequelizeService, User, Organization, OrganizationMember } from '@teamsuzie/shared-auth';
import {
  OrgBilling,
  BillingTransaction,
  BillingService,
  createBillingRouter,
  createBillingWebhookRouter,
  createRequireCreditedOrg,
} from '@teamsuzie/billing-stripe';

// 1. Register billing models alongside shared-auth's so sync() creates everything.
const sequelizeService = new SequelizeService(sharedAuthConfig, [
  User, Organization, OrganizationMember,
  OrgBilling, BillingTransaction,
]);

// 2. Instantiate the service.
const billingService = new BillingService({
  redisUrl: 'redis://localhost:6380/0',
  sequelize: sequelizeService.getSequelize(),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY!,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  initialCreditsUsd: 20,
  topUpAmountUsd: 20,
  lowBalanceThresholdUsd: 5,
});

// 3. Mount the webhook BEFORE express.json() — raw body needed for signature check.
app.use('/api/billing/webhook', createBillingWebhookRouter({ service: billingService }));
app.use(express.json());

// 4. Mount the billing routes (after express.json()).
app.use('/api/billing', createBillingRouter({ service: billingService, requireAuth }));

// 5. Gate cost-incurring endpoints.
const requireCreditedOrg = createRequireCreditedOrg({ service: billingService });
app.post('/api/chat', requireAuth, requireCreditedOrg, /* … */);
```

## Status

v0.1 — first OSS extract from the suzie_monorepo admin app. Webhook surface
covers the common flows; subscription mode and refunds still come later.
