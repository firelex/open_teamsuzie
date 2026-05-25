import type { ApprovalQueue } from '@teamsuzie/approvals';

export interface ToolContext {
  approvals: ApprovalQueue;
  vectorDbBaseUrl: string;
  vectorDbApiKey?: string;
  /** Hostnames the http_request tool is permitted to call. */
  allowedHttpHosts?: string[];
  fetchImpl?: typeof fetch;
  /**
   * Per-turn session id. Optional so existing tools that don't need it
   * continue to compile. Tools that read files via a session-scoped
   * store (convert_to_markdown, propose_document_edits) require it and
   * must throw a clear error when undefined.
   */
  sessionId?: string;
}

export interface ToolDefinition<TArgs = Record<string, unknown>, TResult = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: TArgs, ctx: ToolContext): Promise<TResult>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any, unknown>;

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export function toOpenAITools(tools: AnyToolDefinition[]): OpenAITool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
