import {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    PageBreak,
    PageOrientation,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
    type IParagraphOptions,
} from 'docx';

/**
 * Emit a fresh `.docx` from a structured spec — used by workflows that
 * mandate a documented deliverable (e.g. CP checklist, diligence
 * questionnaire). Distinct from `TrackedChangesEditor` (which mutates an
 * existing document with `<w:ins>` / `<w:del>`); this synthesizes a brand-
 * new file from nothing.
 *
 * Backed by the `docx` (npm) library — handles styles.xml, numbering.xml,
 * content-types, relationships, the `<w:tc>`-must-end-with-`<w:p>` gotcha,
 * and the landscape `w:w`/`w:h` swap. Wrapping it lets the spec stay small
 * and stable while we keep the option to swap implementations later.
 */
export interface GenerateDocxSpec {
    /** Document title — rendered centered + bold + uppercase at the top. */
    title: string;
    /** Page orientation. Default `'portrait'`. */
    orientation?: 'portrait' | 'landscape';
    /** Sections render top-to-bottom; an empty array still produces a valid
     *  doc with just the title. */
    sections: GenerateDocxSection[];
}

export interface GenerateDocxSection {
    /** Force a page break before this section (e.g. signature pages). */
    pageBreakBefore?: boolean;
    /** Section heading. Auto-numbered "1.", "1.1.", "1.1.1." Level 1
     *  is uppercased; levels 2 and 3 keep the supplied casing. */
    heading?: { text: string; level: 1 | 2 | 3 };
    /** Body paragraphs. Each entry becomes one `<w:p>`. Lines beginning
     *  with `-`, `*`, or `•` followed by a space render as bullets. */
    paragraphs?: string[];
    /** Optional table. Headers row is shaded + bold; body rows plain.
     *  Rows shorter than `headers` get padded with empty strings; longer
     *  rows are truncated. No rowspan / colspan / nested tables. */
    table?: { headers: string[]; rows: string[][] };
}

const FONT = 'Times New Roman';
/** 11pt expressed in OOXML half-points. */
const FONT_SIZE = 22;
const HEADER_SHADING = 'F2F2F2';
const BORDER_GRAY = 'CCCCCC';

/** US Letter dimensions in twips (1440 / inch). 8.5" × 11". The `docx`
 *  library defaults to A4; we override to US Letter since the suzielaw
 *  user base is US-centric and matches the tracked-changes / redline
 *  output dimensions. */
const PAGE_WIDTH_PORTRAIT = 12240;
const PAGE_HEIGHT_PORTRAIT = 15840;

const HEADING_LEVELS = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
] as const;

const CELL_BORDERS = {
    top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
    left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
    right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
} as const;

const BULLET_PREFIX = /^[-*•]\s+(.*)$/;

type DocChild = Paragraph | Table;

/**
 * Render a `GenerateDocxSpec` to `.docx` bytes. Returns a Node `Buffer`
 * suitable for piping into the file store / HTTP response.
 */
export async function generateDocx(spec: GenerateDocxSpec): Promise<Buffer> {
    const children: DocChild[] = [];

    children.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [
                new TextRun({
                    text: spec.title.toUpperCase(),
                    bold: true,
                    font: FONT,
                    size: FONT_SIZE,
                }),
            ],
        }),
    );

    // Per-level section counters reset whenever a higher level increments
    // — same scheme Word uses for outline-numbered headings.
    const counters: [number, number, number] = [0, 0, 0];

    for (const section of spec.sections) {
        if (section.pageBreakBefore) {
            children.push(new Paragraph({ children: [new PageBreak()] }));
        }

        if (section.heading) {
            const level = section.heading.level;
            const idx = level - 1;
            counters[idx] += 1;
            for (let i = idx + 1; i < counters.length; i++) counters[i] = 0;
            const prefix = counters.slice(0, idx + 1).join('.');
            const text =
                level === 1
                    ? section.heading.text.toUpperCase()
                    : section.heading.text;
            children.push(
                new Paragraph({
                    heading: HEADING_LEVELS[idx],
                    spacing: { after: 160 },
                    children: [
                        new TextRun({
                            text: `${prefix}. ${text}`,
                            bold: true,
                            font: FONT,
                            size: FONT_SIZE,
                        }),
                    ],
                }),
            );
        }

        if (section.table) {
            children.push(buildTable(section.table));
            // Trailing empty paragraph keeps the next block from butting
            // up against the table's bottom border.
            children.push(new Paragraph({ text: '' }));
        }

        if (section.paragraphs) {
            for (const raw of section.paragraphs) {
                const trimmed = raw.trim();
                if (!trimmed) continue;
                children.push(buildBodyParagraph(trimmed));
            }
        }
    }

    // The `docx` lib expects `width`/`height` in portrait reference (i.e.
    // width is the narrow side) and swaps based on the `orientation`
    // flag. Don't pre-swap.
    const pageSize = {
        orientation:
            spec.orientation === 'landscape'
                ? PageOrientation.LANDSCAPE
                : PageOrientation.PORTRAIT,
        width: PAGE_WIDTH_PORTRAIT,
        height: PAGE_HEIGHT_PORTRAIT,
    };

    const doc = new Document({
        sections: [
            {
                properties: { page: { size: pageSize } },
                children,
            },
        ],
    });

    return Packer.toBuffer(doc);
}

function buildTable(table: {
    headers: string[];
    rows: string[][];
}): Table {
    const colCount = table.headers.length;
    const rows: TableRow[] = [];

    rows.push(
        new TableRow({
            tableHeader: true,
            children: table.headers.map(
                (h) =>
                    new TableCell({
                        borders: CELL_BORDERS,
                        shading: { fill: HEADER_SHADING },
                        children: [
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: h,
                                        bold: true,
                                        font: FONT,
                                        size: FONT_SIZE,
                                    }),
                                ],
                            }),
                        ],
                    }),
            ),
        }),
    );

    for (const rawRow of table.rows) {
        const cells: string[] = [];
        for (let i = 0; i < colCount; i++) {
            const cell = Array.isArray(rawRow) ? rawRow[i] : undefined;
            cells.push(typeof cell === 'string' ? cell : '');
        }
        rows.push(
            new TableRow({
                children: cells.map(
                    (text) =>
                        new TableCell({
                            borders: CELL_BORDERS,
                            children: [
                                new Paragraph({
                                    children: [
                                        new TextRun({
                                            text,
                                            font: FONT,
                                            size: FONT_SIZE,
                                        }),
                                    ],
                                }),
                            ],
                        }),
                ),
            }),
        );
    }

    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows,
    });
}

function buildBodyParagraph(line: string): Paragraph {
    const bullet = line.match(BULLET_PREFIX);
    const opts: IParagraphOptions = bullet
        ? {
              bullet: { level: 0 },
              spacing: { after: 120 },
              children: [
                  new TextRun({ text: bullet[1], font: FONT, size: FONT_SIZE }),
              ],
          }
        : {
              spacing: { after: 120 },
              children: [
                  new TextRun({ text: line, font: FONT, size: FONT_SIZE }),
              ],
          };
    return new Paragraph(opts);
}
