# @teamsuzie/email-insights

Model-written text about an email conversation, checked before use:

- `summariseThread`: one sentence on where it stands (at most 120 characters), a short form for glasses and speech (at most 40), and what it asks of the reader (`reply_needed`, `review_attachment`, `signature`, `decision` or `fyi`).
- `threadIssues`: up to 8 points under discussion, each with a status and the ids of the messages it comes from.

Bring any model through `InsightModel` (`json(system, user)`). Quoted history is left out of what the model sees. A reply that fails the checks goes back to the model once with the problems listed; a second failure throws `InsightError` with the reasons. Nothing is invented in its place.
