import type { FeatureDescriptor, ModuleKey } from './index.js';

/**
 * Canonical list of module keys — the sidebar nav rows. Mirrors the keys of
 * `ManifestModules` (manifest/schema.ts). Adding a new module means:
 *   1. Add the field to ManifestModules.
 *   2. Add the key to MODULE_KEYS here.
 *   3. Add a descriptor to MODULE_CATALOG below.
 *   4. Add the markdown stanza to agent-config-docs.md.
 *
 * Steps 2-3 are enforced at type-level (Record<ModuleKey, ...>) and runtime
 * (catalog coverage test). Steps 1 and 4 are not enforced — auditing for
 * those is on the author.
 */
export const MODULE_KEYS = [
  'assistant',
  'history',
  'personas',
  'settings',
  'matters',
  'library',
  'knowledgeBase',
  'admin',
  'reviews',
  'billing',
  'redline',
  'drafting',
] as const satisfies readonly ModuleKey[];

export const MODULE_CATALOG: Record<ModuleKey, FeatureDescriptor> = {
  assistant: {
    key: 'assistant',
    label: 'Assistant',
    purpose:
      'The main chat surface. Conversational interface to the agent\'s persona, ' +
      'tools, and any enabled components (files, citations, KB hooks). Essentially ' +
      'every agent should have this on — turning it off leaves the agent without ' +
      'its primary entry point.',
    upstreamPackages: [],
    addsRoutes: ['/'],
    dependsOn: [],
    worksWellWith: ['history', 'personas'],
    examples: ['the chat', 'main conversation surface', 'where users talk to the agent'],
  },
  history: {
    key: 'history',
    label: 'History',
    purpose:
      'List and resume past conversations across all of the user\'s sessions with ' +
      'this agent. Backed by the chats package — each row is a saved chat thread, ' +
      'sortable by recency, optionally scoped to the current workspace (matter, ' +
      'deal, project) when matters is also enabled.',
    upstreamPackages: ['@teamsuzie/chats'],
    addsRoutes: ['/history'],
    dependsOn: ['assistant'],
    worksWellWith: ['matters'],
    examples: ['past conversations', 'previous chats', 'chat history'],
  },
  personas: {
    key: 'personas',
    label: 'Personas',
    purpose:
      'Persona switcher + editor. Lets the user switch between multiple personas ' +
      '(distinct voices / system prompts / tool subsets) within the same agent, ' +
      'and create custom personas. Backed by the personas package which merges ' +
      'file-based built-ins with SQLite-stored user personas at runtime. ' +
      'Built-in personas live in the build as `personas/<slug>/PERSONA.md` — ' +
      'count them with `find_files({ root: "build", namePattern: "PERSONA\\\\.md$" })`. ' +
      'Avatar library (selectable when creating a persona) lives upstream at ' +
      '`apps/platform/admin/client/public/avatars/{male,female}/*.webp` and ' +
      'is seeded into the build at `client/public/avatars/`.',
    upstreamPackages: ['@teamsuzie/personas'],
    addsRoutes: ['/personas'],
    dependsOn: ['assistant'],
    worksWellWith: [],
    examples: ['multiple voices', 'persona editor', 'pick a different agent personality'],
  },
  settings: {
    key: 'settings',
    label: 'Settings',
    purpose:
      'Per-user settings page. Theme override, model preferences, font size, ' +
      'and any feature-specific toggles the agent ships with. Implemented inside ' +
      'agent-runtime — no upstream package dependency.',
    upstreamPackages: [],
    addsRoutes: ['/settings'],
    dependsOn: [],
    worksWellWith: [],
    examples: ['settings page', 'user preferences', 'change theme'],
  },
  matters: {
    key: 'matters',
    label: 'Matters',
    purpose:
      'Workspace / case / deal / project list. Each "matter" is a scoped container ' +
      'for chats, documents, and reviews. Legal agents call these "matters", M&A ' +
      'agents call them "deals", consulting agents call them "projects" — the term ' +
      'is configurable via manifest.matters.label. Backed by the matters package ' +
      '(workspaces + sharing + chats glued together).',
    upstreamPackages: ['@teamsuzie/matters', '@teamsuzie/workspaces', '@teamsuzie/sharing'],
    addsRoutes: ['/matters', '/matters/:id'],
    dependsOn: [],
    worksWellWith: ['history', 'redline', 'reviews', 'drafting'],
    examples: ['cases', 'deals', 'projects', 'workspaces per client'],
  },
  library: {
    key: 'library',
    label: 'Library',
    purpose:
      'Workflow + prompt library. A curated catalog of pre-baked prompts and ' +
      'multi-step workflows the user can launch from a single click — grouped by ' +
      'practice area or task type. Backed by the workflows package (SQLite-backed ' +
      'workflows-as-data, system and user workflows in one table).',
    upstreamPackages: ['@teamsuzie/workflows'],
    addsRoutes: ['/library'],
    dependsOn: ['assistant'],
    worksWellWith: ['personas'],
    examples: ['prompt library', 'saved workflows', 'one-click templates', 'starter prompts'],
  },
  knowledgeBase: {
    key: 'knowledgeBase',
    label: 'Knowledge Base',
    purpose:
      'Knowledge base management UI. Upload documents into a sqlite-vec RAG store, ' +
      'browse the corpus, manage embeddings. Distinct from the `knowledgeBase` ' +
      'COMPONENT — this is the management surface (CRUD over the KB), the ' +
      'component is the in-chat retrieval hook.',
    upstreamPackages: ['@teamsuzie/kb'],
    addsRoutes: ['/kb'],
    dependsOn: [],
    worksWellWith: ['citations'],
    examples: ['upload knowledge', 'document corpus', 'RAG admin'],
  },
  admin: {
    key: 'admin',
    label: 'Admin',
    purpose:
      'Admin-only configuration surface. Multi-tenant settings, organization ' +
      'membership, usage caps, billing config. Off unless the deployment is ' +
      'multi-tenant; single-user / single-org agents almost never want this.',
    upstreamPackages: [],
    addsRoutes: ['/admin'],
    dependsOn: [],
    worksWellWith: ['billing'],
    examples: ['admin panel', 'org config', 'tenant management'],
  },
  reviews: {
    key: 'reviews',
    label: 'Reviews',
    purpose:
      'Grid reviews — tabular document audits where each row is a document and ' +
      'each column is a prompted question. Cells are model-generated answers ' +
      'with citations back to the source. Used for diligence checklists, ' +
      'contract clause audits, QA workflows. Backed by reviews + grid-review + ' +
      'grid-review-rag packages.',
    upstreamPackages: ['@teamsuzie/reviews', '@teamsuzie/grid-review', '@teamsuzie/grid-review-rag'],
    addsRoutes: ['/reviews', '/reviews/:id'],
    dependsOn: [],
    worksWellWith: ['matters', 'citations', 'files'],
    examples: ['diligence checklist', 'document audit', 'tabular review', 'contract clause review'],
  },
  billing: {
    key: 'billing',
    label: 'Billing',
    purpose:
      'Billing + usage tracking UI. Per-org credit balances, usage charts, Stripe ' +
      'integration for top-ups. Usually off for internal / single-user agents; ' +
      'on for marketplace agents that charge per use. Backed by billing-stripe + ' +
      'usage-tracker.',
    upstreamPackages: ['@teamsuzie/billing-stripe', '@teamsuzie/usage-tracker'],
    addsRoutes: ['/billing'],
    dependsOn: [],
    worksWellWith: ['admin'],
    examples: ['usage tracking', 'Stripe top-up', 'credit balance', 'billing dashboard'],
  },
  redline: {
    key: 'redline',
    label: 'Redline',
    purpose:
      'DOCX redline workflow. Upload a Word doc, generate or accept/reject ' +
      'tracked-change proposals, save versions, export back to DOCX with the ' +
      'edits applied. Round-trips lossless OOXML so formatting is preserved. ' +
      'Core surface for transactional law and contract review.',
    upstreamPackages: ['@teamsuzie/docx', '@teamsuzie/docx-diff', '@teamsuzie/document-versions'],
    addsRoutes: ['/redline'],
    dependsOn: ['files'],
    worksWellWith: ['matters', 'playbook'],
    examples: ['contract redline', 'tracked changes on Word docs', 'accept-reject UI'],
  },
  drafting: {
    key: 'drafting',
    label: 'Drafting',
    purpose:
      'Drafting workspace. Compose long-form documents with section-by-section ' +
      'AI assistance; export to DOCX/PDF. Memos, briefs, white papers, agreements ' +
      'authored from scratch (vs. redline which edits existing docs).',
    upstreamPackages: ['@teamsuzie/markdown-document', '@teamsuzie/docx', '@teamsuzie/pdf'],
    addsRoutes: ['/drafting'],
    dependsOn: [],
    worksWellWith: ['matters', 'library'],
    examples: ['write a memo', 'draft an agreement', 'compose long-form output'],
  },
};
