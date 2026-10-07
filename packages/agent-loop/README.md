# @teamsuzie/agent-loop

Headless OpenAI-compatible tool-use loop, with a skills bridge and an MCP
client, shared by Team Suzie's chat starters. Use it when you're building a
chat/agent server and need the request/stream/tool-call/repeat loop without
pulling in a specific framework.

```ts
import {
  runChatTurn,
  resolveAgentTarget,
  tools,
  type AgentTarget,
  type ChatMessage,
} from '@teamsuzie/agent-loop';
import { ApprovalQueue, InMemoryApprovalStore } from '@teamsuzie/approvals';

const defaultAgent: AgentTarget = {
  baseUrl: 'https://api.openai.com',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4.1',
};

const agent = resolveAgentTarget(requestedModelId, registry, defaultAgent);

const messages: ChatMessage[] = [{ role: 'user', content: 'Summarise this file.' }];

for await (const event of runChatTurn({
  agent,
  messages,
  tools,
  toolCtx: {
    approvals: new ApprovalQueue({ store: new InMemoryApprovalStore() }),
    vectorDbBaseUrl: 'http://localhost:7000',
  },
})) {
  if (event.type === 'chunk') process.stdout.write(event.text);
}
```

## Main exports

- `runChatTurn` — the loop itself: streams model text, executes tool calls
  against a `tools` list + `ToolContext`, feeds results back, and repeats up
  to `maxIterations` (default 6).
- `streamChatCompletion` / `readChatStream` — the lower-level pieces
  `runChatTurn` is built from, for callers who want their own loop.
- `resolveAgentTarget`, `stripIncompatibleExtraBody` — pick the right
  `AgentTarget` (baseUrl/apiKey/model) for a requested model id from an
  `AgentTargetRegistry`, and strip provider-specific `extraBody` knobs (e.g.
  Qwen's `enable_thinking`) that another provider would 400 on.
- `LOCAL_MODELS`, `buildLocalAgentRegistry` (import from
  `@teamsuzie/agent-loop/local-models`) — starter set of locally-hosted
  models and a helper that builds an `AgentTargetRegistry` from
  `${appPrefix}_LOCAL_${envSuffix}_BASE_URL` / `_API_KEY` env vars.
- `loadSkills` — loads installed skills from a local directory and/or a
  remote catalog (`HttpSkillSource` from `@teamsuzie/skills`), renders
  `{{TOKEN}}` placeholders from a context map, and builds a system prompt.
- `connectMcpServers`, `parseMcpConfigFile`, `parseMcpConfigText` — connect to
  stdio or HTTP MCP servers and expose their tools as `AnyToolDefinition`s
  (named `<serverName>__<toolName>`).
- `tools`, `findTool`, `toOpenAITools` — the built-in tool registry
  (`vectorSearchTool`, `proposeActionTool`, `httpRequestTool`) and a
  converter to the OpenAI `tools` request shape.
- `validateLocalAgentUrl`, `validateProviderUrl` — SSRF-aware URL policy
  checks (`'local-only'` vs `'public-only'`) for "point this at my own
  server" and "point this at my own LLM provider" settings UIs.

## Configuration

- `allowedHttpHosts` on `ToolContext` allow-lists hosts the built-in
  `http_request` tool may call; with no allow-list the tool always throws.
- `${appPrefix}_LOCAL_${envSuffix}_BASE_URL` / `_API_KEY` — read by
  `buildLocalAgentRegistry` per entry in `LOCAL_MODELS` (e.g.
  `SUZIELAW_LOCAL_QWEN_BASE_URL`).

## Notable behaviour

- `runChatTurn` yields an `error` event (not a throw) once the iteration cap
  is hit, and a `tool_error` event per failed/unknown tool call rather than
  aborting the loop.
- `resolveAgentTarget` falls back to the default agent, unchanged, for a
  prefixed model id (`provider/model`) with no registry entry — sending a
  prefixed id as the wire model would 404 against the default provider.
- This package is used throughout `apps/starters/*` and by several packages
  as the shared tool-calling contract (`@teamsuzie/agent-runtime`,
  `@teamsuzie/document-conversion`, `@teamsuzie/markdown-document`,
  `@teamsuzie/docx`, `@teamsuzie/model-settings`, `@teamsuzie/platform-bridge`,
  `@teamsuzie/reference-design`, `@teamsuzie/legal-research`). The `kb_search`
  tool built by `@teamsuzie/kb`'s `createKbSearchTool` is also shaped to drop
  straight into this package's tool registry, though `kb` itself doesn't
  depend on it.
