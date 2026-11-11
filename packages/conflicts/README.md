# @teamsuzie/conflicts

Parties register and conflict checks for professional-services apps.

- Parties (organisations or people) with aliases, linked to subjects such as matters by a host-defined role
  (e.g. `client`, `adverse`, `related`). `findOrCreate` reuses a party with the same normalised name.
- Name matching ignores case, accents, punctuation, a leading "the" and legal-form words (Ltd, LLC, GmbH, S.A., ...),
  matches words in any order with typo tolerance, and treats a name contained in another as a possible match.
- `check(queries, by, { subject })` saves a snapshot of every hit and where each party appears; `decide` records
  `clear`, `waived` (a note is required) or `declined`, once. Hosts classify hits (conflict, review, info) by role.
