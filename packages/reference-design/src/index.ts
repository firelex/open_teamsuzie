export type { ReferenceDoc, DocType } from './types.js';
export { decomposeDocx } from './decompose-docx.js';
export type { DecomposeDocxOptions } from './decompose-docx.js';
export { decomposePptx } from './decompose-pptx.js';
export type { DecomposePptxOptions } from './decompose-pptx.js';
export { decomposeXlsx } from './decompose-xlsx.js';
export type { DecomposeXlsxOptions } from './decompose-xlsx.js';
export { useReferenceDesignInPrompt } from './prompt.js';
export type { ReferenceDocStore } from './storage.js';

// Added Phase 3a — concrete SQLite impl + Express router + migration.
export { createReferenceStore, ReferenceStore } from './storage-sqlite.js';
export type { ReferenceStoreOptions } from './storage-sqlite.js';
export { REFERENCE_DESIGN_MIGRATIONS } from './migrations.js';
export { createReferencesRouter } from './router.js';

// Tool builder — extracted from suzie_pe_drafter Phase 3a Task 3
export { buildDecomposeReferenceTool } from './tool.js';
export type { DecomposeReferenceStoreLike } from './tool.js';
