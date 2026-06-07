export { convertToMarkdown, convertFileToMarkdown } from './convert.js';
export type { ConvertOptions, ConvertResult, ConvertFileRecord } from './convert.js';

export { convertPptxToMarkdown } from './pptx-native.js';
export type { PptxNativeResult } from './pptx-native.js';

export { exportMarkdownToDocx, exportMarkdownToPdf } from './export.js';
export type { ExportDocxOptions, ExportPdfOptions } from './export.js';

export { buildConvertToDocxTool } from './tools.js';
export type { BuildConvertToDocxToolOptions, ConvertFileStore } from './tools.js';

export { buildConvertToMarkdownTool } from './convert-tool.js';
export type { BuildConvertToMarkdownToolOptions } from './convert-tool.js';

export { buildGenerateDocxTool, buildGeneratePdfTool } from './output-tools.js';
export type { BuildGenerateOutputOptions, ReferenceLookupStoreLike } from './output-tools.js';

// PACKAGE_VERSION retained for compatibility; remove in 0.2.
export const PACKAGE_VERSION = '0.1.0';
