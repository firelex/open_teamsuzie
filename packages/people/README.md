# @teamsuzie/people

A people directory built from what an assistant reads: who each person in its owner's life is, their organisation,
role and relationship to the owner, how they are linked to each other, and lasting facts about them. Ported from Jeff
Desk (`jeff_desk/tools/people.py` and `jeff_desk/people.py`); the prompts are Jeff Desk's, word for word, as
plain-text files in `src/prompts/people/` (loaded with `@teamsuzie/prompt-files`). Every row belongs to an owner (the
person whose mail it came from) and every query is scoped by owner.

- `PeopleReader.email` (received or sent): the people on the address lines are placed in code (who wrote, who
  received); the model adds their organisation, role, relationship, how the contact started, postal address, phone,
  links between people and short lasting notes. Each must quote the exact words of the email that show it, and the code
  checks that they are really there; what is not is rejected and counted. A model answer that is not what was asked for
  throws `PeopleReadError` and nothing from it is kept; the email is marked failed so it can be read again. Mail that is
  not substantive (spam, pitches, newsletters, notifications) is skipped with the model's reason, and automated senders,
  shared mailboxes, organisations and the owner themselves never become people.
- `PeopleReader.chatFact`: something the owner said about a person, kept as a note when the words make clear who.
- `PeopleReader.summaries`: each changed person's short description, rewritten from their facts and links.
- `PeopleStore.place`: the person with this address or full name, made when there is none; names from address lines
  are tidied ("SMITH, John" is "John Smith"); the same full name at another organisation is a new person flagged as a
  possible duplicate. A second address is joined to a person only when it is evidently theirs (their surname in both
  mailboxes, or the same company domain; public mail services such as gmail say nothing).
- `PeopleStore.addFact`, `addLink`, `correct` (the owner's value always wins), `deleteFact`, `deleteLink`,
  `giveAddress`, `setSummary`, `ignore` (not relevant: forgotten, and never learned about again).
- `PeopleStore.duplicates`, `merge` (addresses, facts, links and emails move to the person kept), `mergeObvious`,
  `dismissDuplicate`; a possible duplicate found at the same organisation is merged at once.
- `PeopleStore.person`, `listing`, `find`, `mentioned` (people a chat message names), `line` (one line for prompts),
  `exchange`, `processed`, `mark`, `failed`.

```ts
import { openDb } from '@teamsuzie/db-sqlite';
import { PEOPLE_MIGRATIONS, PeopleReader, PeopleStore } from '@teamsuzie/people';

const store = new PeopleStore({ db: openDb({ path: 'people.db', migrations: PEOPLE_MIGRATIONS }) });
const reader = new PeopleReader({
    store,
    write: (prompt, maxTokens) => callModel(prompt, maxTokens),
    ownerId: 'jane@firm.test',
    ownerName: 'Jane Smith',
    ownerAddresses: ['jane@firm.test'],
    today: () => 'Thursday 12 November 2026 (2026-11-12)',
    about: () => 'Jane Smith is a partner at Firm LLP.',
});
await reader.email(message, false, 'jane@firm.test');
await reader.summaries();
```
