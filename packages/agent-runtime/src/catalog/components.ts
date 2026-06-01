import type { ComponentKey, FeatureDescriptor } from './index.js';

/**
 * Canonical list of component keys — in-chat features layered on top of the
 * main Assistant surface. Mirrors the keys of `ManifestComponents`
 * (manifest/schema.ts). See ./modules.ts for the same contract notes.
 *
 * Components vs modules:
 *   - Modules are NAV ROWS (sidebar items, dedicated routes).
 *   - Components are IN-CHAT FEATURES (file attachments inside the chat,
 *     citation markers in responses, KB hooks during retrieval). No route;
 *     they enrich an existing surface.
 *
 * The `knowledgeBase` key appears in BOTH catalogs because the system has
 * a management module (route) AND an in-chat retrieval component (hook).
 * They can be enabled independently — a brainstorm agent might enable KB
 * retrieval without exposing the management UI.
 */
export const COMPONENT_KEYS = [
  'chat',
  'toolActivity',
  'approvals',
  'knowledgeBase',
  'files',
  'citations',
  'workspace',
] as const satisfies readonly ComponentKey[];

export const COMPONENT_CATALOG: Record<ComponentKey, FeatureDescriptor> = {
  chat: {
    key: 'chat',
    label: 'Chat',
    purpose:
      'The conversational surface itself — message list, composer, streaming ' +
      'replies, tool-call rendering. The base component every agent needs; ' +
      'turning it off effectively disables the agent.',
    upstreamPackages: [],
    addsRoutes: [],
    dependsOn: [],
    worksWellWith: [],
    examples: ['the chat itself', 'message thread'],
  },
  toolActivity: {
    key: 'toolActivity',
    label: 'Tool activity',
    purpose:
      'Live indicator showing which tool the agent is running during a turn ' +
      '(“searching the KB…”, “drafting section 3…”). Makes long-running ' +
      'tool calls observable rather than appearing as a hung chat. On by default.',
    upstreamPackages: [],
    addsRoutes: [],
    dependsOn: ['chat'],
    worksWellWith: [],
    examples: ['tool spinner', 'see what the agent is doing'],
  },
  approvals: {
    key: 'approvals',
    label: 'Approvals',
    purpose:
      'Human-in-the-loop approval prompts. When a tool is configured to require ' +
      'approval (e.g. sending email, modifying a doc), the user gets a yes/no ' +
      'prompt in the chat before the tool fires. Backed by the approvals package.',
    upstreamPackages: ['@teamsuzie/approvals'],
    addsRoutes: [],
    dependsOn: ['chat'],
    worksWellWith: [],
    examples: ['approve before sending', 'human in the loop', 'confirm before acting'],
  },
  knowledgeBase: {
    key: 'knowledgeBase',
    label: 'Knowledge base (retrieval)',
    purpose:
      'In-chat RAG retrieval. When enabled, the agent runs a vector search over ' +
      'the configured KB on each turn and surfaces matching passages as context ' +
      'and inline citations. Distinct from the `knowledgeBase` MODULE (which is ' +
      'the management UI for the same store).',
    upstreamPackages: ['@teamsuzie/kb'],
    addsRoutes: [],
    dependsOn: ['chat'],
    worksWellWith: ['citations'],
    examples: ['RAG over my docs', 'cite from the knowledge base', 'retrieve before answering'],
  },
  files: {
    key: 'files',
    label: 'File attachments',
    purpose:
      'File upload in the composer. Attach images, PDFs, DOCX, spreadsheets; the ' +
      'agent receives them as tool input. Required for any feature that operates ' +
      'on user-provided documents (redline, summarize-this-pdf, review row docs).',
    upstreamPackages: [],
    addsRoutes: [],
    dependsOn: ['chat'],
    worksWellWith: ['redline', 'reviews', 'citations'],
    examples: ['upload a file', 'attach a PDF', 'drag a Word doc in'],
  },
  citations: {
    key: 'citations',
    label: 'Citations',
    purpose:
      'Inline citation markers in responses ([1], [2], …) that link back to the ' +
      'source passage (KB chunk, uploaded file, retrieved doc). The wire format ' +
      'is shared across Team Suzie agents; backed by the citations package.',
    upstreamPackages: ['@teamsuzie/citations'],
    addsRoutes: [],
    dependsOn: ['chat'],
    worksWellWith: ['knowledgeBase', 'files'],
    examples: ['cite sources', 'inline references', 'link back to the document'],
  },
  workspace: {
    key: 'workspace',
    label: 'Workspace context bar',
    purpose:
      'Header strip showing the current matter / deal / project the chat is ' +
      'scoped to, with a quick-switch dropdown. Only useful when matters is also ' +
      'enabled — without matters there\'s nothing to scope to.',
    upstreamPackages: [],
    addsRoutes: [],
    dependsOn: ['matters'],
    worksWellWith: ['history'],
    examples: ['current matter banner', 'switch workspace', 'scope to a case'],
  },
};
