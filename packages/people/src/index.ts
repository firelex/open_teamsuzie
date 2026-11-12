export {
    FIELDS,
    LINKS,
    LOOKUP_MATCHES,
    NOTE_LIMIT,
    PEOPLE_MIGRATIONS,
    PUBLIC_MAIL,
    PeopleError,
    PeopleStore,
    RELATIONSHIPS,
    TOP,
    companyDomain,
    fullName,
    norm,
    organisationName,
    sameMailbox,
    sameOrganisation,
    sameText,
    similarNote,
    tidyName,
} from './store.js';
export type { Activity, AddFact, AddLink, Duplicate, Fact, FactField, Field, Link, LinkKind, Person, PersonBrief, PersonSource, PlacePerson, Processed, Relationship } from './store.js';
export { MASS, MAX_TEXT, NOTES_SHOWN, PeopleReadError, PeopleReader, SHORTEST, automated, nameFromAddress, plain, shared } from './reader.js';
export type { EmailPerson, ReadResult, ReaderEmail, ReaderOptions } from './reader.js';
export { fill, prompt } from './prompts.js';
