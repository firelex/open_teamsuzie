# @teamsuzie/playbook

Customer firm-preference playbooks applied to target documents to produce
deviation reports. A playbook is the firm's "house style" — preferred
contract terms, mandatory clauses, severity tiers — captured as markdown
plus structured metadata.

## Quick start

```ts
import {
  loadPlaybookFromBinary,
  applyPlaybook,
  type LlmCall,
} from '@teamsuzie/playbook';
import { readFile } from 'node:fs/promises';

// 1. Load a playbook from a DOCX/PDF/MD file. Binary inputs route through
//    @teamsuzie/document-conversion (markitdown) to markdown.
const playbookBytes = await readFile('Blixt_EL_Playbook_v3.docx');
const playbook = await loadPlaybookFromBinary(
  playbookBytes,
  'Blixt_EL_Playbook_v3.docx',
);

// 2. Provide a pluggable LLM call. Most agents pass a thin wrapper around
//    @teamsuzie/agent-loop's underlying chat function.
const llmCall: LlmCall = async (prompt) => {
  // ... call your model of choice; return the raw assistant text.
  return '{"deviations":[]}';
};

// 3. Apply the playbook to a target markdown document.
const targetMarkdown = '# Engagement Letter\n\n...';
const report = await applyPlaybook(playbook, targetMarkdown, llmCall);

console.log(report.deviations);   // structured Deviation[]
console.log(report.markdown);     // ready to export via @teamsuzie/document-conversion
```

## v1 (current)

- `Playbook` = `{ id, title, body, source }` where `body` is markdown.
- `loadPlaybookFromMarkdown` for text inputs.
- `loadPlaybookFromBinary` routes DOCX / PDF / TXT through
  `@teamsuzie/document-conversion` first.
- `applyPlaybook(playbook, targetMarkdown, llmCall)` returns a
  `DeviationReport` with structured `deviations: Deviation[]` plus a
  rendered `markdown` string ready for DOCX/PDF export.

## v1.1+ (planned)

Structured rule metadata: each rule extracted at ingestion time with
`id`, `severity`, `appliesTo`, anchor text. The current markdown body is
a stepping stone — keep playbooks short until the structured layer lands.

See plan: `docs/superpowers/plans/2026-05-14-upstream-extraction-sweep.md`
(tasks A1, B1, B2, B3).
