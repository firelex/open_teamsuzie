import { convertDocxToMarkdown } from '@teamsuzie/markdown-document';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface ConvertOptions {
  /** Source MIME type. Drives backend selection. */
  mime: string;
  /** Original filename. Passed to markitdown-agent so it picks the right path. */
  filename: string;
  /**
   * Base URL of the markitdown-agent service (no trailing slash).
   * Typically `process.env.MARKITDOWN_AGENT_BASE_URL ?? 'http://localhost:3013'`.
   */
  markitdownAgentBaseUrl: string;
  /** Override the default Turndown configuration when using the mammoth path. */
  turndownOptions?: import('@teamsuzie/markdown-document').ConvertDocxOptions['turndown'];
}

export interface ConvertResult {
  markdown: string;
  /** Backend used — useful for telemetry and debugging. */
  backend: 'mammoth' | 'markitdown-agent';
  /** Mammoth's conversion warnings, when present. */
  warnings?: Array<{ type: string; message: string }>;
}

/**
 * Convert a binary document to Markdown. DOCX goes through mammoth+turndown
 * (best table fidelity); everything else routes to markitdown-agent's
 * /convert endpoint.
 */
export async function convertToMarkdown(
  bytes: Buffer | Uint8Array,
  options: ConvertOptions,
): Promise<ConvertResult> {
  if (options.mime === DOCX_MIME || options.filename.toLowerCase().endsWith('.docx')) {
    const { markdown, messages } = await convertDocxToMarkdown(bytes, {
      turndown: options.turndownOptions,
    });
    return { markdown, backend: 'mammoth', warnings: messages };
  }
  return convertViaMarkitdownAgent(bytes, options);
}

async function convertViaMarkitdownAgent(
  bytes: Buffer | Uint8Array,
  options: ConvertOptions,
): Promise<ConvertResult> {
  const url = `${options.markitdownAgentBaseUrl}/convert`;
  const formData = new FormData();
  // Use Blob so fetch sets the multipart boundaries correctly.
  formData.append(
    'file',
    new Blob([bytes], { type: options.mime || 'application/octet-stream' }),
    options.filename,
  );
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    throw new Error(`markitdown-agent ${url} returned ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { filename: string; markdown: string };
  return { markdown: body.markdown, backend: 'markitdown-agent' };
}
