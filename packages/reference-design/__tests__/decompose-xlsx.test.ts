import { describe, it, expect } from 'vitest';
import { decomposeXlsx } from '../src/decompose-xlsx.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('decomposeXlsx', () => {
  it('returns a ReferenceDoc with xlsx mime and empty markdown', async () => {
    const bytes = Buffer.from('PK\x03\x04fake-xlsx-bytes');
    const ref = await decomposeXlsx(bytes, {
      docType: 'lbo_template',
      displayName: 'Blixt v1.xlsx',
      sourceFilePath: '/tmp/uploads/blixt.xlsx',
    });
    expect(ref.docType).toBe('lbo_template');
    expect(ref.displayName).toBe('Blixt v1.xlsx');
    expect(ref.sourceFilePath).toBe('/tmp/uploads/blixt.xlsx');
    expect(ref.sourceMime).toBe(XLSX_MIME);
    expect(ref.contentMarkdown).toBe('');
    expect(ref.designUsable).toBe(false);
    expect(ref.warnings).toEqual([]);
    expect(ref.id.length).toBeGreaterThan(0);
    expect(Date.parse(ref.ingestedAt)).toBeGreaterThan(0);
  });

  it('produces unique ids on repeated calls with the same name', async () => {
    const bytes = Buffer.from('PK\x03\x04');
    const a = await decomposeXlsx(bytes, { docType: 'lbo_template', displayName: 'x.xlsx', sourceFilePath: '/tmp/a' });
    const b = await decomposeXlsx(bytes, { docType: 'lbo_template', displayName: 'x.xlsx', sourceFilePath: '/tmp/b' });
    expect(a.id).not.toBe(b.id);
  });
});
