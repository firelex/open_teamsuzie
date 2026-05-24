import type { Express, Router } from 'express';
import type { RegistrationMeta } from '../extensions/types.js';

export interface ModuleSpec {
  name: string;
  router?: Router;
  apiPrefix?: string;     // defaults to '/api/<name>'
}

interface Entry { spec: ModuleSpec; meta: RegistrationMeta; }

export class ModuleRegistry {
  private modules: Entry[] = [];

  register(spec: ModuleSpec, meta: RegistrationMeta = { source: 'core' }): void {
    this.modules.push({ spec, meta });
  }

  metaFor(name: string): RegistrationMeta | undefined {
    return this.modules.find(m => m.spec.name === name)?.meta;
  }

  list(): string[] {
    return this.modules.map(m => m.spec.name);
  }

  mount(app: Express, flags: Record<string, boolean>): void {
    for (const { spec } of this.modules) {
      if (!flags[spec.name]) continue;
      if (!spec.router) continue;
      app.use(spec.apiPrefix ?? `/api/${spec.name}`, spec.router);
    }
  }
}
