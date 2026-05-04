export { parseResponse } from './parser.js';
export {
    citationProtocolFragment,
    SENTINEL_OPEN,
    SENTINEL_CLOSE,
    MARKER_REGEX,
    SENTINEL_BLOCK_REGEX,
} from './protocol.js';
export type { ProtocolDoc, ProtocolFragmentOptions } from './protocol.js';
export {
    prepareDocumentForPrompt,
    prepareDocumentFromPages,
    PAGE_MARKER_REGEX,
} from './document.js';
export type {
    PreparedDocument,
    PrepareDocumentOptions,
} from './document.js';
export { validateCitation, validateCitations } from './validator.js';
export type { CitationValidation } from './validator.js';
export { normalize, normalizeWithMap } from './normalize.js';
export type { NormalizedWithMap } from './normalize.js';
export { findHighlightRange } from './highlight-match.js';
export type {
    HighlightRange,
    FindHighlightRangeOptions,
} from './highlight-match.js';
export {
    remarkCitations,
    parseCiteUrl,
    CITE_URL_SCHEME,
} from './remark-plugin.js';
export type {
    Citation,
    CitationWarning,
    CitationWarningKind,
    DocHandle,
    ParseOptions,
    ParseResult,
} from './types.js';
