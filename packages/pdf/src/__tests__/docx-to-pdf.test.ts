import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertDocxBufferToPdf, convertWithLibreOffice, isLibreOfficeAvailable } from '../docx-to-pdf.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_DOCX = path.join(here, 'fixtures', 'sample.docx');

describe('isLibreOfficeAvailable', () => {
  it('returns a boolean', () => {
    expect(typeof isLibreOfficeAvailable()).toBe('boolean');
  });
});

describe('convertDocxBufferToPdf', () => {
  // Skip the round-trip if soffice isn't available so tests stay green on
  // machines without LibreOffice (e.g. CI without the system dep).
  const maybeRoundTrip = isLibreOfficeAvailable() ? it : it.skip;

  maybeRoundTrip(
    'converts a real DOCX to PDF bytes',
    async () => {
      const docx = await readFile(SAMPLE_DOCX);
      const pdf = await convertDocxBufferToPdf(docx);
      expect(pdf.length).toBeGreaterThan(100);
      expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    },
    30_000, // soffice cold-start can be slow on first call
  );

  it('throws a clear error when soffice is missing', async () => {
    // Only exercise this branch if soffice ISN'T available; otherwise
    // we can't easily force the not-found path without monkey-patching.
    if (isLibreOfficeAvailable()) return;
    await expect(convertDocxBufferToPdf(Buffer.from([0x00]))).rejects.toThrow(/LibreOffice not found/);
  });
});

describe('convertWithLibreOffice', () => {
  const maybe = isLibreOfficeAvailable() ? it : it.skip;

  maybe(
    'round-trips DOCX through the legacy .doc format',
    async () => {
      const docx = await readFile(SAMPLE_DOCX);
      const doc = await convertWithLibreOffice(docx, 'docx', 'doc');
      // Legacy Word files are OLE compound documents.
      expect(doc.subarray(0, 4).toString('hex')).toBe('d0cf11e0');
      const back = await convertWithLibreOffice(doc, 'doc', 'docx');
      expect(back.subarray(0, 2).toString('ascii')).toBe('PK');
    },
    60_000,
  );

  it('rejects format names that are not plain extensions', async () => {
    await expect(convertWithLibreOffice(Buffer.from('x'), '../x', 'pdf')).rejects.toThrow(/invalid conversion/);
  });
});
