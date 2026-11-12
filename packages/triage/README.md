# @teamsuzie/triage

Sorting incoming email with the model, ported from Jeff Desk (`jeff_desk/triage.py`); the prompts are Jeff Desk's,
word for word, in `src/prompts/triage/`.

- `classifyEmail` sorts an email into `ignore`, `reply_user`, `reply_draft` or `other`, with a reason and whether a
  person wrote it to the user. `parseVerdict` refuses any answer that is not well formed, and "ignore" for personal
  correspondence.
- `draftReply` (from the email and the last four of its conversation) and `forwardNote` write in the user's voice;
  the host holds them for the user to edit and send.
- `emailText`: an email as the model reads it (headers, body cut at 6,000 characters, marked).

The host keeps the results, applies the user's filters before asking the model, and sends nothing without the user.
