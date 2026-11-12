# @teamsuzie/commitments

Commitments found in what an assistant reads: promises made to its owner (`owed_to_you`), by its owner (`you_owe`),
and things the owner asked the assistant to track (`assistant_owes`). Ported from Jeff Desk
(`jeff_desk/commitments.py`, `tools/commitments.py`, `followups.py`); the prompts are Jeff Desk's, word for word, as
plain-text files in `src/prompts/` (the assistant's name is a placeholder).

- `CommitmentFinder.email` (received or sent), `.chatMessages` (Teams, WhatsApp) and `.assistantChat`: each
  commitment must quote the exact words it came from, and the code checks they are really in the source (in a chat,
  in that side's own new messages); open commitments the source shows are done are closed. A model answer that is not
  what was asked for throws `CommitmentFindError` and nothing is kept.
- `CommitmentStore`: per owner, with an optional subject (e.g. a matter); the same open promise is never kept twice.
- `nextFollowUp` (a working day after the due date, or 7 working days after the promise; then weekly; at most 3
  automatic ones; never while one waits for approval) and `draftFollowUp` (written as the owner; the host holds it
  for approval).
