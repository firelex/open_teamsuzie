import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PdfNativeResult {
  markdown: string;
  pages: number;
  /** Characters of text found, excluding whitespace. */
  textChars: number;
}

/** Thrown for a PDF without a text layer, typically a scan. */
export class PdfHasNoTextError extends Error {
  constructor(readonly pages: number) {
    super(
      `This PDF has no text layer (${pages} page${pages === 1 ? '' : 's'}, almost no extractable text). It is probably a scan or an image export. Run it through OCR (e.g. "Make searchable" in Acrobat or "OCR text" in Preview) and upload it again.`,
    );
    this.name = 'PdfHasNoTextError';
  }
}

/** Below this many text characters per page, a PDF counts as a scan. */
const MIN_CHARS_PER_PAGE = 20;

interface TextItem {
  str: string;
  hasEOL?: boolean;
}

/**
 * Native PDF -> text via pdf.js, page by page, with a `[page N]` marker
 * before each page (the citations package recognises these). No external
 * service. A document averaging under 20 characters of text per page is
 * refused with `PdfHasNoTextError` rather than returned as empty text, so
 * callers can tell the user to OCR it.
 */
export async function convertPdfToMarkdown(bytes: Buffer | Uint8Array): Promise<PdfNativeResult> {
  const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice();
  const doc = await getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise;
  try {
    const parts: string[] = [];
    let textChars = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items as TextItem[]) {
        if (typeof item.str !== 'string') continue;
        text += item.str;
        text += item.hasEOL ? '\n' : item.str.endsWith(' ') ? '' : ' ';
      }
      const cleaned = text
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      textChars += cleaned.replace(/\s/g, '').length;
      parts.push(`[page ${n}]\n\n${cleaned}`);
      page.cleanup();
    }
    if (doc.numPages > 0 && textChars < MIN_CHARS_PER_PAGE * doc.numPages) {
      throw new PdfHasNoTextError(doc.numPages);
    }
    return { markdown: parts.join('\n\n'), pages: doc.numPages, textChars };
  } finally {
    await doc.destroy();
  }
}
