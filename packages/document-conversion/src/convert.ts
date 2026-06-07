import { convertDocxToMarkdown, isDocxMimeType } from '@teamsuzie/markdown-document';
import { convertPptxToMarkdown } from './pptx-native.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

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
  /** Optional fetch override (tests). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export interface ConvertResult {
  markdown: string;
  /** Backend used — useful for telemetry and debugging. */
  backend: 'mammoth' | 'markitdown-agent' | 'pptx-native';
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
  if (options.mime === PPTX_MIME || options.filename.toLowerCase().endsWith('.pptx')) {
    // Native path only. No fallback to markitdown — parse errors surface
    // to the caller verbatim so a malformed deck doesn't silently re-route.
    const { markdown } = convertPptxToMarkdown(bytes);
    return { markdown, backend: 'pptx-native' };
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
  const fetchFn = options.fetchImpl ?? fetch;
  const response = await fetchFn(url, { method: 'POST', body: formData });
  if (!response.ok) {
    throw new Error(`markitdown-agent ${url} returned ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { filename: string; markdown: string };
  return { markdown: body.markdown, backend: 'markitdown-agent' };
}

export interface ConvertFileRecord {
  name: string;
  mimeType: string;
  bytes: Buffer | Uint8Array;
}

/**
 * High-level helper: convert any uploaded file record to markdown.
 * DOCX flows through the in-process mammoth path (no markitdown-agent
 * needed); everything else routes to markitdown-agent and errors with a
 * friendly message when the agent isn't configured. Tool wrappers use
 * this so they don't have to repeat the DOCX-vs-other split each time.
 */
export async function convertFileToMarkdown(
  record: ConvertFileRecord,
  opts: { markitdownAgentBaseUrl: string; fetchImpl?: typeof fetch },
): Promise<string> {
  const isDocx =
    isDocxMimeType(record.mimeType) || record.name.toLowerCase().endsWith('.docx');
  const isPptx =
    record.mimeType === PPTX_MIME || record.name.toLowerCase().endsWith('.pptx');
  if (!opts.markitdownAgentBaseUrl && !isDocx && !isPptx) {
    throw new Error(
      `Cannot convert ${record.mimeType || record.name}: markitdown-agent is not configured. Only DOCX and PPTX are supported in standalone mode.`,
    );
  }
  const { markdown } = await convertToMarkdown(record.bytes, {
    mime: record.mimeType,
    filename: record.name,
    markitdownAgentBaseUrl: opts.markitdownAgentBaseUrl,
    fetchImpl: opts.fetchImpl,
  });
  return markdown;
}
