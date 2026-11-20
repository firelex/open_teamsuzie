import { loadDocx } from './docx-file.js';
import { parseXml } from './xml.js';
import type { XmlNode, XmlTree } from './types.js';
import type { GenerateDocxSpec } from './generate.js';

/**
 * Fill a Word template (.docx bytes) with the content of a `GenerateDocxSpec`.
 *
 * Everything the template carries is kept as it is: styles, numbering, theme,
 * fonts, settings, headers, footers, and the section settings (page size,
 * margins, header and footer references). Only the body changes: the
 * template's empty paragraphs are dropped, paragraphs that hold an anchored
 * drawing (a letterhead text box or logo placed on the page) are kept at the
 * top, and the generated content follows them.
 *
 * The generated content uses the template's own paragraph styles, found by
 * their style names as Word shows them:
 *
 *   document title        "Title"
 *   headings, levels 1-3  "heading 1", "heading 2", "heading 3"
 *   body paragraphs       "Body Text"
 *   bullet lines          "List Bullet"
 *   tables                "Table Grid" (table style); cells use "Body Text"
 *
 * A style is looked up only when the content needs it. If the template does
 * not define it, this throws `DocxTemplateError` naming the style; it never
 * substitutes another style. A template whose body holds text or tables
 * (rather than being empty apart from anchored drawings) is refused too, so a
 * sample-filled document is never silently merged with generated content.
 */
export class DocxTemplateError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DocxTemplateError';
    }
}

/** The style names (as Word shows them) each kind of generated block uses. */
export const TEMPLATE_STYLE_NAMES = {
    title: 'Title',
    heading1: 'heading 1',
    heading2: 'heading 2',
    heading3: 'heading 3',
    body: 'Body Text',
    bullet: 'List Bullet',
    table: 'Table Grid',
} as const;

const HEADER_SHADING = 'F2F2F2';
const BULLET_PREFIX = /^[-*•]\s+(.*)$/;
// Characters XML 1.0 cannot carry at all (C0 controls other than tab, newline, carriage return).
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

interface StyleInfo {
    id: string;
    type: string;
    numId: string | null;
}

export function fillDocxTemplate(spec: GenerateDocxSpec, template: Buffer | Uint8Array): Buffer {
    const file = loadDocx(template);

    const stylesBytes = file.readPart('word/styles.xml');
    if (!stylesBytes) throw new DocxTemplateError('The template has no word/styles.xml, so it defines no styles to use.');
    const styles = readStyles(stylesBytes.toString('utf8'));
    const numberingBytes = file.readPart('word/numbering.xml');
    const numIds = numberingBytes ? readNumIds(numberingBytes.toString('utf8')) : new Set<string>();

    const style = (name: string, type: 'paragraph' | 'table'): string => {
        const found = styles.get(name.toLowerCase());
        if (!found || found.type !== type) {
            throw new DocxTemplateError(`The template has no ${type} style named "${name}", which the content needs.`);
        }
        if (found.numId !== null && found.numId !== '0' && !numIds.has(found.numId)) {
            throw new DocxTemplateError(
                `The template's style "${name}" uses list numbering ${found.numId}, which the template's numbering part does not define.`,
            );
        }
        return found.id;
    };

    const tree = file.document();
    const body = findBody(tree);
    const sectPrIndex = body.findIndex((n) => 'w:sectPr' in n);
    if (sectPrIndex === -1) throw new DocxTemplateError('The template body has no section settings (w:sectPr).');
    if (sectPrIndex !== body.length - 1) {
        throw new DocxTemplateError('The template has more than one section; only single-section templates are supported.');
    }
    const sectPr = body[sectPrIndex]!;

    const kept: XmlNode[] = [];
    for (const node of body.slice(0, sectPrIndex)) {
        const tag = tagOf(node);
        if (tag === 'w:bookmarkStart' || tag === 'w:bookmarkEnd') continue;
        if (tag !== 'w:p') {
            throw new DocxTemplateError(`The template body holds a ${tag} element; its body must be empty apart from anchored drawings such as a letterhead.`);
        }
        const text = textOutsideDrawings(node).trim();
        if (text) {
            throw new DocxTemplateError(`The template body holds the text "${text.slice(0, 60)}"; its body must be empty apart from anchored drawings such as a letterhead.`);
        }
        if (hasDescendant(node, (t) => t === 'w:drawing' || t === 'w:pict')) kept.push(node);
    }

    if (spec.orientation) setOrientation(sectPr, spec.orientation);
    const textWidth = textWidthTwips(sectPr);

    const xml: string[] = [];
    xml.push(paragraph(style(TEMPLATE_STYLE_NAMES.title, 'paragraph'), spec.title.toUpperCase()));

    const counters: [number, number, number] = [0, 0, 0];
    const headingStyleNames = [TEMPLATE_STYLE_NAMES.heading1, TEMPLATE_STYLE_NAMES.heading2, TEMPLATE_STYLE_NAMES.heading3];
    for (const section of spec.sections) {
        if (section.pageBreakBefore) xml.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        if (section.heading) {
            const level = section.heading.level;
            if (level !== 1 && level !== 2 && level !== 3) throw new DocxTemplateError(`Heading level ${String(level)} is not 1, 2 or 3.`);
            const idx = level - 1;
            counters[idx] += 1;
            for (let i = idx + 1; i < counters.length; i++) counters[i] = 0;
            const prefix = counters.slice(0, idx + 1).join('.');
            // The heading is numbered here, so a number the writer already put in front ("1.", "2.3", "IV.") is dropped,
            // as is Markdown heading and bold marking.
            const plain = stripHeadingMarks(section.heading.text);
            const text = level === 1 ? plain.toUpperCase() : plain;
            xml.push(paragraph(style(headingStyleNames[idx]!, 'paragraph'), `${prefix}. ${text}`));
        }
        if (section.table) {
            xml.push(table(section.table, style(TEMPLATE_STYLE_NAMES.table, 'table'), style(TEMPLATE_STYLE_NAMES.body, 'paragraph'), textWidth));
            xml.push(paragraph(style(TEMPLATE_STYLE_NAMES.body, 'paragraph'), ''));
        }
        for (const raw of section.paragraphs ?? []) {
            const trimmed = raw.trim();
            if (!trimmed) continue;
            // A Markdown heading line ("## Next steps") inside the paragraphs becomes a bold body line, unnumbered.
            const mdHeading = trimmed.match(/^#{1,6}\s+(.+)$/);
            if (mdHeading) {
                xml.push(paragraph(style(TEMPLATE_STYLE_NAMES.body, 'paragraph'), stripHeadingMarks(mdHeading[1]!), true));
                continue;
            }
            const bullet = trimmed.match(BULLET_PREFIX);
            xml.push(
                bullet
                    ? paragraph(style(TEMPLATE_STYLE_NAMES.bullet, 'paragraph'), bullet[1]!)
                    : paragraph(style(TEMPLATE_STYLE_NAMES.body, 'paragraph'), trimmed),
            );
        }
    }

    const generated = parseFragment(xml.join(''));
    body.splice(0, body.length, ...kept, ...generated, sectPr);
    file.markDocumentDirty();
    return file.save();
}

function readStyles(xml: string): Map<string, StyleInfo> {
    const out = new Map<string, StyleInfo>();
    for (const m of xml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
        const attrs = m[1]!;
        const inner = m[2]!;
        const id = attrs.match(/w:styleId="([^"]+)"/)?.[1];
        const type = attrs.match(/w:type="([^"]+)"/)?.[1];
        const name = inner.match(/<w:name w:val="([^"]+)"/)?.[1];
        if (!id || !type || !name) continue;
        const numId = inner.match(/<w:numId w:val="(\d+)"/)?.[1] ?? null;
        out.set(name.toLowerCase(), { id, type, numId });
    }
    return out;
}

function readNumIds(xml: string): Set<string> {
    return new Set([...xml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"/g)].map((m) => m[1]!));
}

function tagOf(node: XmlNode): string {
    const tag = Object.keys(node).find((k) => k !== ':@');
    if (!tag) throw new DocxTemplateError('The template body holds an empty XML node.');
    return tag;
}

function children(node: XmlNode): XmlNode[] {
    const value = node[tagOf(node)];
    return Array.isArray(value) ? value : [];
}

function findBody(tree: XmlTree): XmlNode[] {
    const doc = tree.find((n) => 'w:document' in n);
    if (!doc) throw new DocxTemplateError('The template has no w:document element.');
    const body = children(doc).find((n) => 'w:body' in n);
    if (!body) throw new DocxTemplateError('The template has no w:body element.');
    return body['w:body'] as XmlNode[];
}

function hasDescendant(node: XmlNode, test: (tag: string) => boolean): boolean {
    for (const child of children(node)) {
        if ('#text' in child) continue;
        if (test(tagOf(child)) || hasDescendant(child, test)) return true;
    }
    return false;
}

/** The paragraph's own text, leaving out what sits inside drawings and text boxes. */
function textOutsideDrawings(node: XmlNode): string {
    let out = '';
    for (const child of children(node)) {
        if ('#text' in child) continue;
        const tag = tagOf(child);
        if (tag === 'w:drawing' || tag === 'w:pict' || tag === 'mc:AlternateContent') continue;
        if (tag === 'w:t') {
            for (const leaf of children(child)) if ('#text' in leaf) out += String(leaf['#text']);
            continue;
        }
        out += textOutsideDrawings(child);
    }
    return out;
}

function attr(node: XmlNode, name: string): string | undefined {
    return node[':@']?.[`@_${name}`];
}

function setAttr(node: XmlNode, name: string, value: string): void {
    node[':@'] = { ...(node[':@'] ?? {}), [`@_${name}`]: value };
}

function child(node: XmlNode, tag: string): XmlNode {
    const found = children(node).find((c) => tag in c);
    if (!found) throw new DocxTemplateError(`The template's section settings have no ${tag}.`);
    return found;
}

function twips(node: XmlNode, name: string): number {
    const raw = attr(node, name);
    const n = raw === undefined ? NaN : Number(raw);
    if (!Number.isFinite(n)) throw new DocxTemplateError(`The template's section settings have no numeric ${name}.`);
    return n;
}

/** Turn the page to the requested orientation, swapping the template's page width and height when it differs. */
function setOrientation(sectPr: XmlNode, orientation: 'portrait' | 'landscape'): void {
    const pgSz = child(sectPr, 'w:pgSz');
    const w = twips(pgSz, 'w:w');
    const h = twips(pgSz, 'w:h');
    const isLandscape = w > h;
    if ((orientation === 'landscape') !== isLandscape) {
        setAttr(pgSz, 'w:w', String(h));
        setAttr(pgSz, 'w:h', String(w));
    }
    setAttr(pgSz, 'w:orient', orientation);
}

function textWidthTwips(sectPr: XmlNode): number {
    const pgSz = child(sectPr, 'w:pgSz');
    const pgMar = child(sectPr, 'w:pgMar');
    const width = twips(pgSz, 'w:w') - twips(pgMar, 'w:left') - twips(pgMar, 'w:right');
    if (width <= 0) throw new DocxTemplateError('The template\'s margins leave no width for text.');
    return width;
}

function escapeText(text: string): string {
    if (INVALID_XML_CHARS.test(text)) {
        throw new DocxTemplateError(`The text "${text.slice(0, 60)}" holds a control character that a Word document cannot contain.`);
    }
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A heading's text without a leading number ("1.", "1.2", "2.3.", "IV.") or Markdown marks ("#", "**"). */
export function stripHeadingMarks(text: string): string {
    return text
        .replace(/^#+\s*/, '')
        .replace(/\*\*/g, '')
        .replace(/^\s*(?:\d+\.(?:\d+\.?)*|[IVXLC]+\.)\s+/, '')
        .trim();
}

/**
 * Splits a paragraph's text into pieces by its Markdown emphasis: **bold** and *italic* (a writer's Markdown is
 * turned into Word formatting rather than shown as asterisks).
 */
export function emphasisPieces(text: string): Array<{ text: string; bold: boolean; italic: boolean }> {
    const out: Array<{ text: string; bold: boolean; italic: boolean }> = [];
    const re = /\*\*([^*]+?)\*\*|(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g;
    let last = 0;
    for (const m of text.matchAll(re)) {
        if (m.index! > last) out.push({ text: text.slice(last, m.index), bold: false, italic: false });
        out.push(m[1] !== undefined ? { text: m[1], bold: true, italic: false } : { text: m[2]!, bold: false, italic: true });
        last = m.index! + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last), bold: false, italic: false });
    return out;
}

/** Runs for one paragraph's text: **bold** and *italic* become formatting, line breaks <w:br/>, tabs <w:tab/>. */
function runs(text: string, bold = false): string {
    if (!text) return '';
    return emphasisPieces(text.replace(/\r\n?/g, '\n'))
        .map((piece) => {
            const b = bold || piece.bold;
            const rPr = b || piece.italic ? `<w:rPr>${b ? '<w:b/><w:bCs/>' : ''}${piece.italic ? '<w:i/><w:iCs/>' : ''}</w:rPr>` : '';
            const parts: string[] = [];
            piece.text.split('\n').forEach((line, i) => {
                if (i > 0) parts.push('<w:br/>');
                line.split('\t').forEach((chunk, j) => {
                    if (j > 0) parts.push('<w:tab/>');
                    if (chunk) parts.push(`<w:t xml:space="preserve">${escapeText(chunk)}</w:t>`);
                });
            });
            return parts.length ? `<w:r>${rPr}${parts.join('')}</w:r>` : '';
        })
        .join('');
}

function paragraph(styleId: string, text: string, bold = false): string {
    return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>${runs(text, bold)}</w:p>`;
}

function table(t: { headers: string[]; rows: string[][] }, tableStyleId: string, cellStyleId: string, textWidth: number): string {
    const cols = t.headers.length;
    if (cols === 0) throw new DocxTemplateError('A table needs at least one header.');
    const colWidth = Math.floor(textWidth / cols);
    const cell = (text: string, header: boolean) =>
        `<w:tc><w:tcPr><w:tcW w:w="${colWidth}" w:type="dxa"/>${header ? `<w:shd w:val="clear" w:color="auto" w:fill="${HEADER_SHADING}"/>` : ''}</w:tcPr>${paragraph(cellStyleId, text, header)}</w:tc>`;
    const rows: string[] = [];
    rows.push(`<w:tr><w:trPr><w:tblHeader/></w:trPr>${t.headers.map((h) => cell(h, true)).join('')}</w:tr>`);
    for (const raw of t.rows) {
        const cells: string[] = [];
        for (let i = 0; i < cols; i++) {
            const value = Array.isArray(raw) ? raw[i] : undefined;
            cells.push(cell(typeof value === 'string' ? value : '', false));
        }
        rows.push(`<w:tr>${cells.join('')}</w:tr>`);
    }
    return (
        `<w:tbl><w:tblPr><w:tblStyle w:val="${tableStyleId}"/><w:tblW w:w="5000" w:type="pct"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
        `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${colWidth}"/>`).join('')}</w:tblGrid>` +
        rows.join('') +
        '</w:tbl>'
    );
}

function parseFragment(xml: string): XmlNode[] {
    const tree = parseXml(`<fragment>${xml}</fragment>`);
    const root = tree.find((n) => 'fragment' in n);
    if (!root) throw new Error('Generated content did not parse.');
    return root['fragment'] as XmlNode[];
}
