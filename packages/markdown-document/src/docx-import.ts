import mammoth from 'mammoth';
import TurndownService from 'turndown';
import * as turndownPluginGfm from 'turndown-plugin-gfm';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface ConvertDocxOptions {
  /** Override the default Turndown configuration. */
  turndown?: TurndownService.Options;
}

export interface ConvertDocxResult {
  markdown: string;
  /** Mammoth's conversion warnings (unsupported styles, missing images, etc.). */
  messages: { type: string; message: string }[];
}

/**
 * Convert a DOCX file (as a Buffer or Uint8Array) to markdown using mammoth +
 * turndown. Tables are flattened into GFM markdown via a custom rule that
 * walks the DOM directly — this handles header-less tables and rowspan/colspan
 * (the GFM plugin's tables rule keeps both as raw HTML, which sanitized
 * markdown viewers render as literal `<table>` text).
 *
 * Use this in preference to a generic file-conversion service for DOCX —
 * table fidelity is noticeably better than markitdown's Word path.
 */
export async function convertDocxToMarkdown(
  bytes: Buffer | Uint8Array,
  options: ConvertDocxOptions = {},
): Promise<ConvertDocxResult> {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const { value: html, messages } = await mammoth.convertToHtml({ buffer });

  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    ...options.turndown,
  });
  turndown.use(turndownPluginGfm.strikethrough);
  installCustomTableRules(turndown);

  return {
    markdown: turndown.turndown(html),
    messages: messages as { type: string; message: string }[],
  };
}

/** True for the OOXML .docx mime type. Use to gate the DOCX fast path. */
export function isDocxMimeType(mimeType: string): boolean {
  return mimeType === DOCX_MIME;
}

/**
 * Install table-handling rules. Walks the DOM directly so we get a usable GFM
 * table no matter what the source looks like — first row is treated as the
 * header even without `<thead>`/`<th>`, rowspan/colspan are flattened (cells
 * appear in their physical position), and cell content is reduced to a single
 * line so the row stays valid GFM. Inner table elements (`<thead>`, `<tbody>`,
 * `<tr>`, `<td>`, `<th>`) emit empty so they don't double-render.
 */
function installCustomTableRules(turndown: TurndownService): void {
  turndown.addRule('tableInner', {
    filter: ['thead', 'tbody', 'tfoot', 'tr', 'td', 'th'],
    replacement: () => '',
  });
  turndown.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => convertTable(node as unknown as TableNode),
  });
}

interface TableNode {
  rows: ArrayLike<RowNode>;
}
interface RowNode {
  children: ArrayLike<CellNode>;
}
interface CellNode {
  nodeName: string;
  childNodes: ArrayLike<DomNode>;
  getAttribute(name: string): string | null;
}
interface DomNode {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<DomNode>;
  getAttribute?(name: string): string | null;
}

function convertTable(table: TableNode): string {
  const rows = Array.from(table.rows);
  if (rows.length === 0) return '';

  const allRowCells: string[][] = rows.map((row) =>
    Array.from(row.children)
      .filter((c) => c.nodeName === 'TD' || c.nodeName === 'TH')
      .map(cellToInlineMarkdown),
  );
  const colCount = Math.max(...allRowCells.map((r) => r.length));
  if (colCount === 0) return '';

  const padRow = (cells: string[]): string[] =>
    cells.length >= colCount ? cells.slice(0, colCount) : cells.concat(Array(colCount - cells.length).fill(''));
  const formatRow = (cells: string[]): string => '| ' + padRow(cells).join(' | ') + ' |';

  const lines: string[] = [];
  lines.push(formatRow(allRowCells[0]));
  lines.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');
  for (let i = 1; i < allRowCells.length; i++) {
    lines.push(formatRow(allRowCells[i]));
  }

  return '\n\n' + lines.join('\n') + '\n\n';
}

function cellToInlineMarkdown(cell: CellNode): string {
  let result = '';
  for (const child of Array.from(cell.childNodes)) {
    result += nodeToInline(child);
  }
  return result.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function nodeToInline(node: DomNode): string {
  if (node.nodeType === TEXT_NODE) return node.nodeValue || '';
  if (node.nodeType !== ELEMENT_NODE) return '';

  const tag = node.nodeName.toUpperCase();
  const inner = Array.from(node.childNodes).map(nodeToInline).join('');

  switch (tag) {
    case 'STRONG':
    case 'B':
      return inner.trim() ? `**${inner.trim()}**` : '';
    case 'EM':
    case 'I':
      return inner.trim() ? `_${inner.trim()}_` : '';
    case 'CODE':
      return inner ? '`' + inner + '`' : '';
    case 'A': {
      const href = node.getAttribute?.('href');
      return href && inner ? `[${inner}](${href})` : inner;
    }
    case 'BR':
      return ' ';
    case 'P':
    case 'DIV':
      return inner.trim() ? inner.trim() + ' ' : '';
    case 'UL':
    case 'OL': {
      const items = Array.from(node.childNodes)
        .filter((n) => n.nodeType === ELEMENT_NODE && n.nodeName.toUpperCase() === 'LI')
        .map((li) => Array.from(li.childNodes).map(nodeToInline).join('').trim())
        .filter(Boolean);
      return items.join(' · ');
    }
    case 'SUB':
    case 'SUP':
    case 'SPAN':
      return inner;
    default:
      return inner;
  }
}
