import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import { exportMarkdownToDocx, exportMarkdownToPdf } from './export.js';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ReferenceLookupStoreLike {
  get(id: string): {
    sourceFilePath: string;
    displayName: string;
    designUsable: boolean;
  } | null;
}

export interface BuildGenerateOutputOptions {
  store: ReferenceLookupStoreLike;
  markitdownAgentBaseUrl: string;
  outputsDir: string;
}

export function buildGenerateDocxTool(opts: BuildGenerateOutputOptions): AnyToolDefinition {
  return {
    name: 'generate_docx',
    description:
      'Render markdown to a DOCX file. Optionally apply a reference design as the pandoc reference-doc (firm styling).',
    parameters: {
      type: 'object',
      properties: {
        markdown: { type: 'string', description: 'Markdown body to render.' },
        filename: { type: 'string', description: 'Base filename (no extension).' },
        reference_doc_id: {
          type: 'string',
          description: 'Optional reference_doc id for pandoc --reference-doc.',
        },
      },
      required: ['markdown', 'filename'],
    },
    async execute(args) {
      const markdown = String(args.markdown ?? '');
      const filename = String(args.filename ?? 'output');
      if (!markdown) return { error: 'Missing markdown' };

      let referenceDoc: { bytes: Uint8Array; filename: string } | undefined;
      if (typeof args.reference_doc_id === 'string') {
        const ref = opts.store.get(args.reference_doc_id);
        if (ref && ref.designUsable) {
          const bytes = await readFile(ref.sourceFilePath);
          referenceDoc = { bytes: new Uint8Array(bytes), filename: ref.displayName };
        }
      }
      const docxBytes = await exportMarkdownToDocx({
        markdown,
        filename,
        referenceDoc,
        markitdownAgentBaseUrl: opts.markitdownAgentBaseUrl,
      });
      await mkdir(opts.outputsDir, { recursive: true });
      const outPath = path.join(opts.outputsDir, `${filename}-${Date.now()}.docx`);
      await writeFile(outPath, docxBytes);
      return { ok: true, path: outPath, bytes: docxBytes.byteLength };
    },
  };
}

export function buildGeneratePdfTool(opts: BuildGenerateOutputOptions): AnyToolDefinition {
  return {
    name: 'generate_pdf',
    description:
      'Render markdown to a PDF file. Pipeline: markdown → DOCX (markitdown-agent) → PDF (local LibreOffice). Optional reference design styles the intermediate DOCX.',
    parameters: {
      type: 'object',
      properties: {
        markdown: { type: 'string' },
        filename: { type: 'string' },
        reference_doc_id: {
          type: 'string',
          description: 'Optional reference_doc id for the intermediate DOCX styling.',
        },
      },
      required: ['markdown', 'filename'],
    },
    async execute(args) {
      const markdown = String(args.markdown ?? '');
      const filename = String(args.filename ?? 'output');
      if (!markdown) return { error: 'Missing markdown' };

      let referenceDoc: { bytes: Uint8Array; filename: string } | undefined;
      if (typeof args.reference_doc_id === 'string') {
        const ref = opts.store.get(args.reference_doc_id);
        if (ref && ref.designUsable) {
          const bytes = await readFile(ref.sourceFilePath);
          referenceDoc = { bytes: new Uint8Array(bytes), filename: ref.displayName };
        }
      }
      const pdfBytes = await exportMarkdownToPdf({
        markdown,
        filename,
        referenceDoc,
        markitdownAgentBaseUrl: opts.markitdownAgentBaseUrl,
      });
      await mkdir(opts.outputsDir, { recursive: true });
      const outPath = path.join(opts.outputsDir, `${filename}-${Date.now()}.pdf`);
      await writeFile(outPath, pdfBytes);
      return { ok: true, path: outPath, bytes: pdfBytes.byteLength };
    },
  };
}
