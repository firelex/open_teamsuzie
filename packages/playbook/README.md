# @teamsuzie/playbook

Customer firm-preference playbooks applied to target documents to produce
deviation reports. A playbook is the firm's "house style" — preferred
contract terms, mandatory clauses, severity tiers — captured as markdown
plus structured metadata.

## v1 (current)

- `Playbook` = `{ id, title, body, source }` where `body` is markdown.
- `loadPlaybookFromMarkdown` for text inputs.
- `loadPlaybookFromBinary` routes DOCX / PDF / TXT through
  `@teamsuzie/document-conversion` first.
- `applyPlaybook` (Task B3) renders a `DeviationReport` against a target doc.

## v1.1+ (planned)

Structured rule metadata: each rule extracted at ingestion time with
`id`, `severity`, `appliesTo`, anchor text. The current markdown body is
a stepping stone — keep playbooks short until the structured layer lands.

See plan: `docs/superpowers/plans/2026-05-14-upstream-extraction-sweep.md`
(tasks A1, B1, B2, B3).
