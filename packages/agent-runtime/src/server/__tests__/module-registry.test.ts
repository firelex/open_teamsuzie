import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ModuleRegistry } from '../module-registry.js';
import type { RegistrationMeta } from '../../extensions/types.js';

describe('ModuleRegistry', () => {
  let reg: ModuleRegistry;
  beforeEach(() => { reg = new ModuleRegistry(); });

  it('mounts a router only when the module flag is true', async () => {
    const r = express.Router();
    r.get('/ping', (_req, res) => res.json({ ok: true }));
    reg.register({ name: 'library', router: r });

    const app1 = express();
    reg.mount(app1, { library: true });
    let res = await request(app1).get('/api/library/ping');
    expect(res.status).toBe(200);

    const app2 = express();
    reg.mount(app2, { library: false });
    res = await request(app2).get('/api/library/ping');
    expect(res.status).toBe(404);
  });

  it('respects apiPrefix override', async () => {
    const r = express.Router();
    r.get('/ping', (_req, res) => res.json({ ok: true }));
    reg.register({ name: 'library', apiPrefix: '/api/workflows', router: r });

    const app = express();
    reg.mount(app, { library: true });
    const res = await request(app).get('/api/workflows/ping');
    expect(res.status).toBe(200);
  });

  it('lists registered module names', () => {
    reg.register({ name: 'library', router: express.Router() });
    reg.register({ name: 'reviews', router: express.Router() });
    expect(reg.list()).toEqual(['library', 'reviews']);
  });

  it('skips entries with no router (e.g. client-only modules)', () => {
    reg.register({ name: 'history' }); // router omitted
    const app = express();
    expect(() => reg.mount(app, { history: true })).not.toThrow();
  });

  it('tracks source per registration; defaults to core when omitted', () => {
    reg.register({ name: 'library', router: express.Router() });
    reg.register(
      { name: 'legal-research', router: express.Router() },
      { source: 'extension', extensionName: 'legal-research' },
    );
    expect(reg.metaFor('library')).toEqual({ source: 'core' });
    expect(reg.metaFor('legal-research')).toEqual({ source: 'extension', extensionName: 'legal-research' });
    expect(reg.metaFor('does-not-exist')).toBeUndefined();
  });
});
