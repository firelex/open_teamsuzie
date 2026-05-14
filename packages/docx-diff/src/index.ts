export { alignParagraphs } from './align.js';
export {
    containmentWeightedSimilarity,
    tokenLcsLength,
    tokenize,
    fingerprint,
} from './similarity.js';
export { diffWords } from './word-diff.js';
export type { WordDiffKind, WordDiffOp } from './word-diff.js';
export type {
    AlignmentResult,
    ParagraphMatch,
    ParagraphMatchStatus,
} from './types.js';
export type {
    DocumentDiffResult,
    ParagraphDiffEvent,
} from './document-diff-result.js';
