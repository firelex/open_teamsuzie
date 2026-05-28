import { randomUUID } from 'node:crypto';
import type { ReferenceDoc, DocType } from './types.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface DecomposeXlsxOptions {
  docType: DocType;
  displayName: string;
  sourceFilePath: string;
}

export async function decomposeXlsx(
  _bytes: Buffer | Uint8Array,
  options: DecomposeXlsxOptions,
): Promise<ReferenceDoc> {
  return {
    id: `${options.displayName.replace(/[^\w.-]/g, '_')}-${randomUUID()}`,
    docType: options.docType,
    displayName: options.displayName,
    sourceFilePath: options.sourceFilePath,
    sourceMime: XLSX_MIME,
    contentMarkdown: '',
    designUsable: false,
    ingestedAt: new Date().toISOString(),
    warnings: [],
  };
}
