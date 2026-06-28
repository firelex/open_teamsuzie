import AdmZip from 'adm-zip';

export interface PptxNativeResult {
  markdown: string;
  slides: number;
}

const SLIDE_ENTRY_RE = /^ppt\/slides\/slide(\d+)\.xml$/;

/**
 * Native pptx → markdown via in-memory zip + slide-xml extraction. No
 * external service required. Slides are emitted in numeric order; each
 * paragraph becomes a bullet. Slides with no <a:t> runs render as
 * `_(no text)_` so the slide count survives.
 */
export function convertPptxToMarkdown(bytes: Buffer | Uint8Array): PptxNativeResult {
  const zip = new AdmZip(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  const slides = zip
    .getEntries()
    .filter((e) => SLIDE_ENTRY_RE.test(e.entryName))
    .sort((a, b) => {
      const ai = Number(a.entryName.match(SLIDE_ENTRY_RE)?.[1] ?? 0);
      const bi = Number(b.entryName.match(SLIDE_ENTRY_RE)?.[1] ?? 0);
      return ai - bi;
    });

  if (slides.length === 0) {
    throw new Error('pptx: no slides found in archive');
  }

  const sections: string[] = [];
  for (let i = 0; i < slides.length; i += 1) {
    const xml = slides[i].getData().toString('utf8');
    const paragraphs: string[] = [];
    for (const para of xml.split(/<a:p\b[^>]*>/)) {
      const runs = Array.from(para.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
        .map((m) => decodeXmlEntities(m[1]).trim())
        .filter(Boolean);
      if (runs.length) paragraphs.push(runs.join(''));
    }
    const body = paragraphs.length ? paragraphs.map((p) => `- ${p}`).join('\n') : '_(no text)_';
    sections.push(`## Slide ${i + 1}\n\n${body}`);
  }

  return { markdown: sections.join('\n\n'), slides: slides.length };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
