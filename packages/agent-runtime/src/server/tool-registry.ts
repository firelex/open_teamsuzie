import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import type { RegistrationMeta } from '../extensions/types.js';

interface Entry { tool: AnyToolDefinition; meta: RegistrationMeta; }

export class ToolRegistry {
  private tools: Entry[] = [];

  register(tool: AnyToolDefinition, meta: RegistrationMeta = { source: 'core' }): void {
    this.tools.push({ tool, meta });
  }

  list(): AnyToolDefinition[] {
    return this.tools.map((t) => t.tool);
  }

  metaFor(name: string): RegistrationMeta | undefined {
    return this.tools.find((t) => t.tool.name === name)?.meta;
  }
}
