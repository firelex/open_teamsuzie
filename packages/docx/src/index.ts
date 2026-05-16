export { DocxFile, loadDocx, saveDocx } from './docx-file.js';
export { parseXml, serializeXml } from './xml.js';
export type { XmlAttributes, XmlNode, XmlTree } from './types.js';
export {
    TrackedChangesEditor,
    bodyParagraphInfos,
    bodyParagraphTexts,
    computeNextRevisionId,
} from './tracked-changes.js';
export type {
    BodyParagraphInfo,
    RevisionAuthor,
    WordDiffOp,
} from './tracked-changes.js';
export {
    acceptAllRevisions,
    acceptRevision,
    listRevisions,
    rejectAllRevisions,
    rejectRevision,
} from './revisions.js';
export { applyContentKeyedEdits } from './content-keyed-edits.js';
export { generateDocx } from './generate.js';
export type {
    GenerateDocxSpec,
    GenerateDocxSection,
} from './generate.js';
export type {
    AppliedEditResult,
    AppliedEditStatus,
    ContentKeyedEdit,
} from './content-keyed-edits.js';
export type { Revision, AcceptRejectOptions } from './revisions.js';
export { composeRedline, redlineDownloadFilename } from './compose-redline.js';
export type { ComposeRedlineOptions } from './compose-redline.js';
export {
    extractRedlineParagraphs,
    findEditParagraphIndex,
} from './redline-view.js';
export type { RedlineRun, RedlineParagraph } from './redline-view.js';
