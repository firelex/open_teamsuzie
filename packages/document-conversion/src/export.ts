import { convertDocxBufferToPdf } from '@teamsuzie/pdf';

export interface ExportDocxOptions {
  markdown: string;
  filename?: string;
  /** Optional reference .docx that styles the output via pandoc --reference-doc. */
  referenceDoc?: { bytes: Buffer | Uint8Array; filename: string };
  markitdownAgentBaseUrl: string;
}

export interface ExportPdfOptions {
  markdown: string;
  filename?: string;
  /**
   * Optional reference .docx applied to the intermediate DOCX so the PDF
   * inherits firm/template styles.
   */
  referenceDoc?: { bytes: Buffer | Uint8Array; filename: string };
  markitdownAgentBaseUrl: string;
}

/** Convert markdown → DOCX bytes via markitdown-agent. */
export async function exportMarkdownToDocx(options: ExportDocxOptions): Promise<Uint8Array> {
  const url = `${options.markitdownAgentBaseUrl}/export/docx`;
  let response: Response;
  if (options.referenceDoc) {
    const formData = new FormData();
    formData.append('markdown', options.markdown);
    if (options.filename) formData.append('filename', options.filename);
    formData.append(
      'reference_doc',
      new Blob([options.referenceDoc.bytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      options.referenceDoc.filename,
    );
    response = await fetch(url, { method: 'POST', body: formData });
  } else {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: options.markdown, filename: options.filename }),
    });
  }
  if (!response.ok) {
    throw new Error(`markitdown-agent /export/docx returned ${response.status}: ${await response.text()}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Convert markdown → PDF bytes.
 *
 * Pipeline: markdown → DOCX (via markitdown-agent + pandoc, optionally with a
 * reference doc for styling) → PDF (via @teamsuzie/pdf using headless
 * LibreOffice on the local host).
 *
 * Requires LibreOffice (`soffice`) on the caller's PATH. See @teamsuzie/pdf's
 * `isLibreOfficeAvailable` to probe.
 */
export async function exportMarkdownToPdf(options: ExportPdfOptions): Promise<Uint8Array> {
  const docxBytes = await exportMarkdownToDocx({
    markdown: options.markdown,
    filename: options.filename,
    referenceDoc: options.referenceDoc,
    markitdownAgentBaseUrl: options.markitdownAgentBaseUrl,
  });
  const pdfBuffer = await convertDocxBufferToPdf(Buffer.from(docxBytes));
  return new Uint8Array(pdfBuffer);
}
