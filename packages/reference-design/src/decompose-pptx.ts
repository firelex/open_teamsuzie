import { convertToMarkdown } from '@teamsuzie/document-conversion';
import type { ReferenceDoc, DocType } from './types.js';

export interface DecomposePptxOptions {
  docType: DocType;
  displayName: string;
  sourceFilePath: string;
  markitdownAgentBaseUrl: string;
  /**
   * Optional LLM call to tag slide continuations. Receives a prompt with
   * the slide-by-slide markdown; must return JSON of shape
   * `{ continuations: [{ slideIndex, continuesFrom }] }`.
   * Indices are 0-based.
   *
   * If omitted, continuations are not detected and slides are returned
   * as-is.
   */
  llmFn?: (prompt: string) => Promise<string>;
}

interface Continuation { slideIndex: number; continuesFrom: number }

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export async function decomposePptx(
  bytes: Buffer | Uint8Array,
  options: DecomposePptxOptions,
): Promise<ReferenceDoc> {
  const { markdown } = await convertToMarkdown(bytes, {
    mime: PPTX_MIME,
    filename: options.displayName,
    markitdownAgentBaseUrl: options.markitdownAgentBaseUrl,
  });

  let annotated = markdown;
  if (options.llmFn) {
    const continuations = await detectContinuations(markdown, options.llmFn);
    annotated = annotateContinuations(markdown, continuations);
  }

  return {
    id: makeId(options.displayName),
    docType: options.docType,
    displayName: options.displayName,
    sourceFilePath: options.sourceFilePath,
    sourceMime: PPTX_MIME,
    contentMarkdown: annotated,
    designUsable: false,
    ingestedAt: new Date().toISOString(),
    warnings: [],
  };
}

async function detectContinuations(
  markdown: string,
  llmFn: (p: string) => Promise<string>,
): Promise<Continuation[]> {
  const prompt = [
    'You are analysing a slide deck transcribed as markdown.',
    'Each slide begins with an H1 (`# Slide N`) or a heading.',
    'Identify which slides are continuations of the previous slide',
    '(same topic, just a second/third page — e.g. "Financials" → "Financials cont.").',
    '',
    'Return JSON: { "continuations": [{ "slideIndex": <N>, "continuesFrom": <N-1> }] }.',
    'Indices are 0-based. If none, return { "continuations": [] }. No prose.',
    '',
    '=== DECK ===',
    markdown,
  ].join('\n');

  const raw = await llmFn(prompt);
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleaned) as { continuations?: Continuation[] };
  return Array.isArray(parsed.continuations) ? parsed.continuations : [];
}

function annotateContinuations(markdown: string, conts: Continuation[]): string {
  if (conts.length === 0) return markdown;
  const slides = markdown.split(/(?=^# )/m);
  for (const c of conts) {
    if (c.slideIndex >= slides.length) continue;
    const headerEnd = slides[c.slideIndex].indexOf('\n');
    if (headerEnd < 0) continue;
    slides[c.slideIndex] =
      slides[c.slideIndex].slice(0, headerEnd) +
      ` <!-- continues Slide ${c.continuesFrom + 1} -->` +
      slides[c.slideIndex].slice(headerEnd);
  }
  return slides.join('');
}

function makeId(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
