import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Provider from 'oidc-provider';

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

export function buildInteractionsRouter(provider: Provider, verifyPassword: VerifyPassword): Router {
  const r = Router();

  r.get('/oauth/interaction/:uid', async (req: Request, res: Response) => {
    const details = await getInteractionDetails(provider, req, res);
    if (!details) return;
    const { prompt } = details;
    if (prompt.name === 'login') {
      res.type('html').send(LOGIN_HTML.replaceAll('{{uid}}', details.uid).replace('{{error}}', ''));
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
      res.status(401).type('html').send(
        LOGIN_HTML.replaceAll('{{uid}}', String(req.params.uid)).replace('{{error}}', 'Invalid email or password'),
      );
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
