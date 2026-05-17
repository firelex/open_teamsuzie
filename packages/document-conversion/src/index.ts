export { convertToMarkdown } from './convert.js';
export type { ConvertOptions, ConvertResult } from './convert.js';

export { exportMarkdownToDocx, exportMarkdownToPdf } from './export.js';
export type { ExportDocxOptions, ExportPdfOptions } from './export.js';

export { buildConvertToDocxTool } from './tools.js';
export type { BuildConvertToDocxToolOptions, ConvertFileStore } from './tools.js';

// PACKAGE_VERSION retained for compatibility; remove in 0.2.
export const PACKAGE_VERSION = '0.1.0';
