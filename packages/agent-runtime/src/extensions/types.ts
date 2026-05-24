// extensions/types.ts
import type { ModuleSpec } from '../server/module-registry.js';
import type { AnyToolDefinition } from '@teamsuzie/agent-loop';

export interface AiDraftKindHandler {
  systemPromptFor: (context: Record<string, unknown>) => string;
}

export interface Extension {
  name: string;
  version?: string;
  modules?: ModuleSpec[];
  tools?: AnyToolDefinition[];
  aiDraftKinds?: Record<string, AiDraftKindHandler>;
  seeds?: Record<string, unknown[]>;
}

export interface RegistrationMeta {
  source: 'core' | 'extension';
  extensionName?: string;
}
