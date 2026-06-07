import { AttachmentStore } from '@teamsuzie/artifacts';

export const IMAGE_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export type ImageAttachmentMimeType = (typeof IMAGE_ATTACHMENT_MIME_TYPES)[number];

const DEFAULT_EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;

export interface ImageAttachmentStoreOptions {
  /** Filesystem root for stored images. */
  root: string;
  /** Override the size cap. Defaults to 15 MiB. */
  maxBytes?: number;
}

export function createImageAttachmentStore(options: ImageAttachmentStoreOptions): AttachmentStore {
  return new AttachmentStore({
    root: options.root,
    allowedMime: new Set<string>(IMAGE_ATTACHMENT_MIME_TYPES),
    extensionByMime: DEFAULT_EXTENSION_BY_MIME,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
  });
}
