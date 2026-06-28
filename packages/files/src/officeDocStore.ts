import { AttachmentStore } from '@teamsuzie/artifacts';

export const OFFICE_DOC_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
] as const;

export type OfficeDocMimeType = (typeof OFFICE_DOC_MIME_TYPES)[number];

const DEFAULT_EXTENSION_BY_MIME: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/pdf': 'pdf',
};

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export interface OfficeDocStoreOptions {
  /** Filesystem root for stored docs. */
  root: string;
  /** Override the size cap. Defaults to 50 MiB. */
  maxBytes?: number;
}

export function createOfficeDocStore(options: OfficeDocStoreOptions): AttachmentStore {
  return new AttachmentStore({
    root: options.root,
    allowedMime: new Set<string>(OFFICE_DOC_MIME_TYPES),
    extensionByMime: DEFAULT_EXTENSION_BY_MIME,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
  });
}
