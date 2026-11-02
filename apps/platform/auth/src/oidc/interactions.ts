import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Provider from 'oidc-provider';
import type { RegistrationMode } from '@teamsuzie/shared-auth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGIN_HTML = readFileSync(join(__dirname, 'views/login.html'), 'utf8');
const EXPIRED_HTML = `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign-in expired</title>
</head>
<body>
  <main>
    <h1>Sign-in expired</h1>
    <p>Please start sign-in again from Suzie.</p>
  </main>
</body>
</html>
`;

export type VerifyPassword = (email: string, password: string) => Promise<{ id: string } | null>;

export interface InteractionsOptions {
  /** Shown on the sign-in page: with 'closed' (the default) it says that an administrator creates accounts. */
  registration?: RegistrationMode;
}

const CLOSED_NOTE = 'Accounts are created by an administrator. Ask yours if you need one.';

export function buildInteractionsRouter(
  provider: Provider,
  verifyPassword: VerifyPassword,
  options: InteractionsOptions = {},
): Router {
  const r = Router();
  const note = (options.registration ?? 'closed') === 'closed' ? CLOSED_NOTE : '';
  const renderLogin = (uid: string, error = '') => LOGIN_HTML
    .replaceAll('{{uid}}', escapeHtml(uid))
    .replace('{{error}}', escapeHtml(error))
    .replace('{{note}}', escapeHtml(note));

  r.get('/oauth/interaction/:uid', async (req: Request, res: Response) => {
    const details = await getInteractionDetails(provider, req, res);
    if (!details) return;
    const { prompt } = details;
    if (prompt.name === 'login') {
      res.type('html').send(renderLogin(details.uid));
      return;
    }
    if (prompt.name === 'consent') {
      // First-party clients auto-approve the single 'tools' scope.
      // The grant is still recorded so revocation works.
      let { grantId } = details;
      if (!grantId) {
        const grant = new (provider.Grant as any)({
          accountId: (details.session as any).accountId,
          clientId: details.params.client_id,
        });
        grantId = await grant.save();
      }
      const grant = await provider.Grant.find(grantId!);
      grant!.addOIDCScope('openid profile email tools offline_access');
      const resources = Array.isArray(details.params.resource)
        ? details.params.resource
        : details.params.resource
          ? [details.params.resource]
          : [];
      for (const resource of resources) {
        grant!.addResourceScope(String(resource), 'tools');
      }
      await grant!.save();
      const result = { consent: { grantId } };
      await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: true });
      return;
    }
    res.status(400).send(`Unsupported prompt: ${prompt.name}`);
  });

  r.post('/oauth/interaction/:uid/login', async (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};
    const account = await verifyPassword(String(email ?? ''), String(password ?? ''));
    if (!account) {
      res.status(401).type('html').send(renderLogin(String(req.params.uid), 'Invalid email or password'));
      return;
    }
    await provider.interactionFinished(
      req, res,
      { login: { accountId: account.id } },
      { mergeWithLastSubmission: false },
    ).catch((err) => {
      if (isSessionNotFound(err)) {
        renderExpiredInteraction(res);
        return;
      }
      throw err;
    });
  });

  return r;
}

async function getInteractionDetails(provider: Provider, req: Request, res: Response) {
  try {
    return await provider.interactionDetails(req, res);
  } catch (err) {
    if (isSessionNotFound(err)) {
      renderExpiredInteraction(res);
      return null;
    }
    throw err;
  }
}

function isSessionNotFound(err: unknown): boolean {
  const e = err as { name?: string; error?: string; message?: string };
  return e?.name === 'SessionNotFound'
    || (e?.error === 'invalid_request' && String(e?.message ?? '').toLowerCase().includes('session'));
}

function renderExpiredInteraction(res: Response): void {
  if (!res.headersSent) {
    res.status(400).type('html').send(EXPIRED_HTML);
  }
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]!);
}
