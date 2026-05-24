import type { Express, Router } from 'express';

export interface ModuleSpec {
  name: string;
  router?: Router;
  apiPrefix?: string;     // defaults to '/api/<name>'
}

export class ModuleRegistry {
  private modules: ModuleSpec[] = [];

  register(m: ModuleSpec): void {
    this.modules.push(m);
  }

  list(): string[] {
    return this.modules.map(m => m.name);
  }

  mount(app: Express, modulesFlags: Record<string, boolean>): void {
    for (const m of this.modules) {
      if (!modulesFlags[m.name]) continue;
      if (!m.router) continue;
      app.use(m.apiPrefix ?? `/api/${m.name}`, m.router);
    }
  }
}
