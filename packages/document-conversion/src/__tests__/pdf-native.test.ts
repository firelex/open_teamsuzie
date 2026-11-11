import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertPdfToMarkdown, PdfHasNoTextError } from '../pdf-native.js';
import { convertToMarkdown } from '../convert.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(here, 'fixtures', name));

describe('convertPdfToMarkdown', () => {
  it('extracts page-marked text from a PDF with a text layer', async () => {
    const out = await convertPdfToMarkdown(fixture('sample.pdf'));
    expect(out.pages).toBeGreaterThan(0);
    expect(out.markdown.startsWith('[page 1]')).toBe(true);
    expect(out.textChars).toBeGreaterThan(20);
  });

  it('refuses a scanned PDF (no text layer) with a message telling the user to OCR it', async () => {
    await expect(convertPdfToMarkdown(fixture('scanned.pdf'))).rejects.toBeInstanceOf(PdfHasNoTextError);
    await expect(convertPdfToMarkdown(fixture('scanned.pdf'))).rejects.toThrow(/OCR/);
  });

  it('is the path convertToMarkdown takes for PDFs, without the markitdown agent', async () => {
    const out = await convertToMarkdown(fixture('sample.pdf'), {
      filename: 'sample.pdf',
      mime: 'application/pdf',
      markitdownAgentBaseUrl: 'http://127.0.0.1:1',
    });
    expect(out.backend).toBe('pdf-native');
  });
});
