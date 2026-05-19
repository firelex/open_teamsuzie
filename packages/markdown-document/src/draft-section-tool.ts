import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import { InMemoryDocumentStore } from './store.js';
import { MarkdownDocument } from './document.js';

/** Pluggable LLM call. Same shape as @teamsuzie/playbook's LlmCall. */
export type LlmCall = (prompt: string) => Promise<string>;

export interface BuildDraftSectionOptions {
  llmCall: LlmCall;
  /**
   * Optional document accumulator. When wired, repeated draft_section calls
   * within the same chat+workflow append into a single working draft so the
   * client artifact panel can lift the whole document via `_doc_state`.
   *
   * When omitted (legacy callers / unit tests), the tool stays stateless and
   * just returns `{ prose }`.
   */
  docStore?: InMemoryDocumentStore;
  /** Resolves the active session id for this turn. Required if docStore is set. */
  getSessionId?: () => string;
  /**
   * Resolves a stable per-workflow doc key. Multiple draft_section calls with
   * the same key append into the same MarkdownDocument. Typical impl returns
   * `draft-<sessionId>-<workflowId ?? 'default'>`. Required if docStore is set.
   */
  getDocKey?: () => string;
}

function buildDocState(doc: MarkdownDocument, docId: string) {
  return { doc_id: docId, title: doc.title, markdown: doc.getMarkdown() };
}

/**
 * Drafts a single document section in prose. Used by Offer Letter and IC
 * Memo workflows section-by-section. Caller provides the section prompt
 * (typically built up from reference-design context + deal context); tool
 * returns the prose.
 *
 * When wired with a docStore, sessions, and a doc-key resolver, successive
 * calls accumulate prose into a single MarkdownDocument (creating a new one
 * the first time it's called per workflow). The accumulated doc is stamped
 * onto the result as `_doc_state` so the chat client can surface it in a
 * right-hand artifact panel without polling.
 *
 * NOTE: This is *not* a wrapper around draftColumnPrompt — that function
 * drafts COLUMN PROMPTS for a tabular review tool, a different domain.
 * Section drafting is a thin LLM-call shim instead.
 */
export function buildDraftSectionTool(opts: BuildDraftSectionOptions): AnyToolDefinition {
  return {
    name: 'draft_section',
    description:
      'Draft a single document section in prose. Provide the section prompt (purpose, key data, voice); tool returns the drafted prose. When repeated within a workflow, sections accumulate into a single Working Draft document — pass `heading` to label each section, and optionally `doc_id` to target an existing draft.',
    parameters: {
      type: 'object',
      properties: {
        section_prompt: {
          type: 'string',
          description:
            'Prompt describing what this section should contain. Include deal context, voice/length hints, anything the LLM needs.',
        },
        max_words: { type: 'integer', description: 'Approximate word target (default 250).' },
        heading: {
          type: 'string',
          description:
            'Optional ## heading to prepend before this section. Omit to append as a plain paragraph.',
        },
        doc_id: {
          type: 'string',
          description:
            'Optional. Target an existing working draft by id. Omit to append to the active per-workflow draft (auto-created on first call).',
        },
      },
      required: ['section_prompt'],
    },
    async execute(args) {
      const sectionPrompt = String(args.section_prompt ?? '');
      if (!sectionPrompt) return { error: 'Missing section_prompt' };
      const maxWords = typeof args.max_words === 'number' ? args.max_words : 250;
      const heading = typeof args.heading === 'string' && args.heading.trim()
        ? args.heading.trim()
        : undefined;
      const requestedDocId = typeof args.doc_id === 'string' && args.doc_id.trim()
        ? args.doc_id.trim()
        : undefined;

      const fullPrompt = [
        'You are drafting a single section of a finance / legal document.',
        `Target length: about ${maxWords} words.`,
        'Output prose only — no surrounding markdown headings, no commentary, no preamble.',
        '',
        '=== SECTION BRIEF ===',
        sectionPrompt,
      ].join('\n');

      const rawProse = await opts.llmCall(fullPrompt);
      const prose = rawProse.trim();

      // Stateless fallback for legacy callers that didn't wire the store.
      if (!opts.docStore || !opts.getSessionId || !opts.getDocKey) {
        return { prose };
      }

      const sessionId = opts.getSessionId();
      const docId = requestedDocId ?? opts.getDocKey();

      let doc = opts.docStore.get(sessionId, docId);
      if (!doc) {
        doc = new MarkdownDocument('', 'Working Draft');
      }

      const existingMd = doc.getMarkdown();
      const trimmed = existingMd.replace(/\s+$/, '');
      const headingBlock = heading ? `## ${heading}\n\n` : '';
      const separator = trimmed.length > 0 ? '\n\n' : '';
      const updatedMd = `${trimmed}${separator}${headingBlock}${prose}\n`;
      doc.setMarkdown(updatedMd);
      opts.docStore.put(sessionId, doc, docId);

      return {
        prose,
        doc_id: docId,
        _doc_state: buildDocState(doc, docId),
      };
    },
  };
}
