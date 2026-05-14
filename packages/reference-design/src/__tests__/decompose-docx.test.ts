import { describe, it, expect } from 'vitest';
import { decomposeDocx } from '../decompose-docx.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DOCX = path.join(here, 'fixtures', 'sample-ic5.docx');

describe('decomposeDocx', () => {
  it('extracts markdown and reports designUsable based on mammoth warnings', async () => {
    const bytes = await readFile(FIXTURE_DOCX);
    const ref = await decomposeDocx(bytes, {
      docType: 'ic-5pager',
      displayName: 'IC5_Meridian.docx',
      sourceFilePath: FIXTURE_DOCX,
    });

    expect(ref.docType).toBe('ic-5pager');
    expect(ref.contentMarkdown.length).toBeGreaterThan(0);
    expect(typeof ref.designUsable).toBe('boolean');
    expect(ref.ingestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
