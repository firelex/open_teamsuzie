import ExcelJS from 'exceljs';
import { Router, type Request, type Response } from 'express';
import type { ReviewsStore, ReviewSnapshot } from '@teamsuzie/grid-review';
import type { WorkspacesStore } from '@teamsuzie/workspaces';

interface CellCitation {
    id: number;
    doc: string;
    quote: string;
    locator?: string;
}

export interface BuildReviewWorkbookOptions {
    reviews: ReviewsStore;
    workspaces: WorkspacesStore;
    reviewId: string;
    matterId: string;
}

/**
 * Build an `.xlsx` workbook for one matter-scoped grid review. One row
 * per review document, one column per review column, header row with
 * the column titles. Each answered cell's citations land in a cell
 * comment so `[1] "verbatim quote"` lines are visible on hover in
 * Excel — that's how reviewers verify the source without leaving the
 * spreadsheet.
 *
 * Pending / streaming cells render as empty; errored cells render the
 * error string in the cell value so the export reflects the live grid
 * state honestly.
 *
 * Ported from suzielaw 2026-05-25; this is the upstream copy mounted
 * by `createReviewsExportRouter`.
 */
export async function buildReviewWorkbook(
    opts: BuildReviewWorkbookOptions,
): Promise<{
    workbook: ExcelJS.Workbook;
    fileName: string;
    reviewName: string;
}> {
    const snapshot = opts.reviews.getReviewSnapshot(opts.reviewId);
    if (!snapshot || snapshot.review.workspaceId !== opts.matterId) {
        throw Object.assign(new Error('review not found'), { httpStatus: 404 });
    }
    const workspace = opts.workspaces.getWorkspace(opts.matterId);

    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(safeSheetName(snapshot.review.name));

    const headerCells: string[] = [
        'Document',
        ...snapshot.columns.map((c) => c.title),
    ];
    const headerRow = sheet.addRow(headerCells);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'top' };
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

    sheet.getColumn(1).width = 36;
    for (let i = 0; i < snapshot.columns.length; i++) {
        sheet.getColumn(i + 2).width = 42;
    }

    const cellByKey = new Map<string, ReviewSnapshot['cells'][number]>();
    for (const cell of snapshot.cells) {
        cellByKey.set(`${cell.columnId}::${cell.reviewDocumentId}`, cell);
    }

    for (const doc of snapshot.documents) {
        const rowValues: (string | null)[] = [doc.name];
        for (const col of snapshot.columns) {
            const cell = cellByKey.get(`${col.id}::${doc.id}`);
            rowValues.push(formatCellValue(cell));
        }
        const row = sheet.addRow(rowValues);
        row.alignment = { vertical: 'top', wrapText: true };

        for (let colIdx = 0; colIdx < snapshot.columns.length; colIdx++) {
            const col = snapshot.columns[colIdx]!;
            const cell = cellByKey.get(`${col.id}::${doc.id}`);
            if (!cell) continue;
            const comment = formatCellComment(cell, snapshot);
            if (!comment) continue;
            const xlCell = row.getCell(colIdx + 2);
            xlCell.note = {
                texts: [{ text: comment }],
                margins: { insetmode: 'auto' },
            };
        }
    }

    const fileName = buildFileName({
        reviewName: snapshot.review.name,
        matterName: workspace?.name ?? 'matter',
    });

    return {
        workbook,
        fileName,
        reviewName: snapshot.review.name,
    };
}

function formatCellValue(
    cell: ReviewSnapshot['cells'][number] | undefined,
): string | null {
    if (!cell) return '';
    if (cell.status === 'error') return cell.error ?? '(error)';
    if (cell.status === 'pending' || cell.status === 'streaming') return '';
    return cell.value ?? '';
}

function formatCellComment(
    cell: ReviewSnapshot['cells'][number],
    snapshot: ReviewSnapshot,
): string | null {
    if (!cell.citations) return null;
    let parsed: CellCitation[];
    try {
        const raw = JSON.parse(cell.citations);
        if (!Array.isArray(raw)) return null;
        parsed = raw as CellCitation[];
    } catch {
        return null;
    }
    if (parsed.length === 0) return null;
    const docNameByHandle = new Map(
        snapshot.documents.map((d) => [d.externalDocId, d.name]),
    );
    const lines: string[] = [];
    for (const c of parsed) {
        const docName = docNameByHandle.get(c.doc) ?? c.doc;
        const locator = c.locator ? ` · ${c.locator}` : '';
        lines.push(`[${c.id}] ${docName}${locator}`);
        lines.push(`"${c.quote}"`);
        lines.push('');
    }
    let text = lines.join('\n').trimEnd();
    if (text.length > 8000) text = text.slice(0, 7997) + '…';
    return text;
}

function safeSheetName(name: string): string {
    const cleaned = name.replace(/[:\\/?*[\]]/g, '-').trim();
    return cleaned.slice(0, 31) || 'Review';
}

function buildFileName({
    reviewName,
    matterName,
}: {
    reviewName: string;
    matterName: string;
}): string {
    const slug = (s: string) =>
        s
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'review';
    const date = new Date().toISOString().slice(0, 10);
    return `${slug(matterName)}-${slug(reviewName)}-${date}.xlsx`;
}

export interface CreateReviewsExportRouterOptions {
    reviews: ReviewsStore;
    workspaces: WorkspacesStore;
}

/**
 * Mounts a single endpoint:
 *
 *   GET /:reviewId/export.xlsx — streams an xlsx workbook for the review.
 *
 * Mount under `/api/matters/:matterId/reviews` *after*
 * `createRequireMatterAccess` so membership is already enforced. The
 * router pulls `matterId` from the upstream Express params via the
 * sub-router pattern hosts already use for the chats / grid-reviews
 * mounts. Returns 404 when the review id doesn't belong to the matter.
 */
export function createReviewsExportRouter(
    opts: CreateReviewsExportRouterOptions,
): Router {
    const { reviews, workspaces } = opts;
    const router: Router = Router({ mergeParams: true });

    router.get('/:reviewId/export.xlsx', async (req: Request, res: Response) => {
        const matterId =
            ((req as unknown as { _matterId?: string })._matterId ?? '') ||
            String(
                (req.params as { matterId?: string }).matterId ?? '',
            );
        const reviewId = String(req.params.reviewId ?? '');
        try {
            const { workbook, fileName } = await buildReviewWorkbook({
                reviews,
                workspaces,
                reviewId,
                matterId,
            });
            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            );
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${encodeURIComponent(fileName)}"`,
            );
            res.setHeader('Cache-Control', 'no-store');
            await workbook.xlsx.write(res);
            res.end();
        } catch (err) {
            const httpStatus =
                err && typeof err === 'object' && 'httpStatus' in err
                    ? (err as { httpStatus?: number }).httpStatus
                    : undefined;
            if (httpStatus === 404) {
                res.status(404).json({ error: 'review not found' });
                return;
            }
            console.warn(
                '[matters/reviews-export] failed:',
                err instanceof Error ? err.message : err,
            );
            res.status(500).json({
                error: err instanceof Error ? err.message : 'export failed',
            });
        }
    });

    return router;
}
