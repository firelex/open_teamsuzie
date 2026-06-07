import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { convertPptxToMarkdown } from '../pptx-native.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixture = readFileSync(join(__dirname, 'fixtures/sample.pptx'));

describe('convertPptxToMarkdown', () => {
  it('returns markdown with one section per slide', () => {
    const result = convertPptxToMarkdown(fixture);
    expect(result.slides).toBeGreaterThan(0);
    expect(result.markdown).toMatch(/## Slide 1\b/);
    expect(result.markdown.split('## Slide').length - 1).toBe(result.slides);
  });

  it('throws on a buffer that is not a zip archive', () => {
    expect(() => convertPptxToMarkdown(Buffer.from('not a zip'))).toThrow();
  });

  it('throws when the archive has no slide entries', () => {
    const zip = new AdmZip();
    zip.addFile('hello.txt', Buffer.from('hi'));
    expect(() => convertPptxToMarkdown(zip.toBuffer())).toThrow(/no slides/);
  });

  it('renders empty slides with a placeholder', () => {
    const zip = new AdmZip();
    zip.addFile(
      'ppt/slides/slide1.xml',
      Buffer.from(`<?xml version="1.0"?><p:sld xmlns:p="x" xmlns:a="x"></p:sld>`),
    );
    const result = convertPptxToMarkdown(zip.toBuffer());
    expect(result.slides).toBe(1);
    expect(result.markdown).toContain('_(no text)_');
  });
});
