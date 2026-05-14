import { describe, it, expect } from 'vitest';
import { composeRedline, redlineDownloadFilename } from '../compose-redline.js';

describe('composeRedline (extracted from suzielaw)', () => {
  it('is exported', () => {
    expect(typeof composeRedline).toBe('function');
  });

  it('redlineDownloadFilename slugifies names', () => {
    expect(redlineDownloadFilename('Lease v1.docx', 'Lease v2.docx')).toBe(
      'Lease_v1__vs__Lease_v2__redline.docx',
    );
  });
});
