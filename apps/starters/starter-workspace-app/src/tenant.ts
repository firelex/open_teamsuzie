import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

/**
 * Request-scoped tenant context. Every authenticated request runs inside a
 * tenant scope so domain repos can read `currentTenantId()` and scope their
 * Postgres queries by tenant_id without threading the id through every call.
 *
 * The template resolves the tenant from the session (or the default tenant in
 * single-tenant dev). The build agent replaces resolveTenantId with real
 * mapping (e.g. an OIDC org claim → tenant) when the app needs it.
 */
const storage = new AsyncLocalStorage<{ tenantId: string }>();

export function currentTenantId(): string {
  const store = storage.getStore();
  if (!store) throw new Error('No tenant context — call inside tenantContext() middleware.');
  return store.tenantId;
}

/** Runs each request inside the caller's tenant scope. Mount AFTER attachSession. */
export function tenantContext(defaultTenantId: string): RequestHandler {
  return (req, _res, next) => {
    const tenantId = req.user?.tenantId ?? defaultTenantId;
    req.tenantId = tenantId;
    storage.run({ tenantId }, () => next());
  };
}
