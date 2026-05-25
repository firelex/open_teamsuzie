import { Router, type Request, type Response } from 'express';
import type {
    CellFormat,
    ReviewsStore as GridReviewsStore,
} from '@teamsuzie/grid-review';
import type { WorkspacesStore } from '@teamsuzie/workspaces';
import type { WorkflowsStore } from '@teamsuzie/workflows';

import type { GetSessionUser } from './access-middleware.js';

/**
 * The grid-review CellFormat enum the upstream package knows about.
 * Workflows store column formats as free strings, so we filter against
 * this set when porting columns into a new review.
 */
const VALID_FORMATS: ReadonlySet<CellFormat> = new Set<CellFormat>([
    'text',
    'short_text',
    'date',
    'yes_no',
    'bullets',
    'money',
]);

function isValidFormat(value: unknown): value is CellFormat {
    return typeof value === 'string' && (VALID_FORMATS as Set<string>).has(value);
}

export interface CreateReviewsFromWorkflowRouterOptions {
    reviews: GridReviewsStore;
    workspaces: WorkspacesStore;
    workflows: WorkflowsStore;
    getSessionUser: GetSessionUser;
}

/**
 * Mounts a single endpoint:
 *
 *   POST /from-workflow
 *     body: { workflowId, externalDocIds: string[] }
 *
 * Pre-populates a new grid review for the matter from a workflow's
 * column config. Each column with a known format becomes a review
 * column; each selected externalDocId that actually lives in the matter
 * becomes a review row. Cells are left empty — there's no run-adapter
 * upstream yet (KB unwired; see docs/GAPS.md #5), so reviewers can fill
 * them in manually or wait for the cell-running surface to ship.
 *
 * Mount under `/api/matters/:matterId/reviews` after
 * `createRequireMatterAccess` has already enforced membership. The
 * router reads `matterId` from the upstream `_matterId` stash (set by
 * the parent middleware) and falls back to `req.params` so a direct
 * mount also works in tests.
 *
 * Ported from suzielaw/apps/suzielaw/src/index.ts (matter-reviews
 * from-workflow handler).
 */
export function createReviewsFromWorkflowRouter(
    opts: CreateReviewsFromWorkflowRouterOptions,
): Router {
    const { reviews, workspaces, workflows, getSessionUser } = opts;
    const router: Router = Router({ mergeParams: true });

    router.post('/from-workflow', (req: Request, res: Response) => {
        const matterId =
            ((req as unknown as { _matterId?: string })._matterId ?? '') ||
            String(
                (req.params as { matterId?: string }).matterId ?? '',
            );

        const user = getSessionUser(req);
        if (!user?.email) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }
        const matter = workspaces.getWorkspace(matterId);
        if (!matter) {
            res.status(404).json({ error: 'matter not found' });
            return;
        }

        const body = req.body as Record<string, unknown> | undefined;
        const workflowId = String(body?.workflowId ?? '').trim();
        const externalDocIds = Array.isArray(body?.externalDocIds)
            ? (body!.externalDocIds as unknown[])
                  .filter((x): x is string => typeof x === 'string')
                  .map((s) => s.trim())
                  .filter(Boolean)
            : [];
        if (!workflowId) {
            res.status(400).json({ error: 'workflowId is required' });
            return;
        }
        if (externalDocIds.length === 0) {
            res.status(400).json({ error: 'select at least one document' });
            return;
        }

        const workflow = workflows.get(workflowId);
        if (!workflow) {
            res.status(404).json({ error: 'workflow not found' });
            return;
        }
        // System workflows are visible to every authenticated user; user
        // workflows require an owner match. Workflow membership sharing
        // is not yet upstream — when it lands, this is the line to swap
        // for a sharing-aware role lookup.
        if (workflow.source !== 'system' && workflow.ownerId !== user.email) {
            res.status(404).json({ error: 'workflow not found' });
            return;
        }

        const columns = workflow.columnConfig ?? [];
        if (columns.length === 0) {
            res.status(400).json({ error: 'workflow has no review template' });
            return;
        }
        const validatedColumns = columns.filter((c) => isValidFormat(c.format));
        if (validatedColumns.length === 0) {
            res.status(400).json({ error: 'workflow has no valid columns' });
            return;
        }

        // Resolve doc names + mime types from the matter so we can
        // populate review_documents. Skip ids that aren't in the matter
        // rather than failing the whole call — the client may have stale
        // data.
        const matterDocs = workspaces.listDocuments(matterId, {});
        const docByExternalId = new Map(
            matterDocs.map((d) => [d.externalDocId, d]),
        );

        try {
            const today = new Date().toLocaleDateString();
            const description =
                workflow.description && workflow.description.trim().length > 0
                    ? workflow.description
                    : null;
            const review = reviews.createReview({
                workspaceId: matterId,
                name: `${workflow.name} — ${today}`,
                description,
            });
            for (let i = 0; i < validatedColumns.length; i++) {
                const c = validatedColumns[i]!;
                reviews.addColumn({
                    reviewId: review.id,
                    title: c.title,
                    prompt: c.prompt,
                    format: c.format as CellFormat,
                    position: i,
                });
            }
            let added = 0;
            for (const externalDocId of externalDocIds) {
                const matterDoc = docByExternalId.get(externalDocId);
                if (!matterDoc) continue;
                reviews.addDocument({
                    reviewId: review.id,
                    externalDocId,
                    name: matterDoc.name,
                    mimeType: matterDoc.mimeType ?? null,
                    position: added,
                });
                added += 1;
            }
            const snapshot = reviews.getReviewSnapshot(review.id);
            res.status(201).json({
                item: snapshot,
                skipped: externalDocIds.length - added,
            });
        } catch (err) {
            console.warn(
                '[matters/reviews-from-workflow] failed:',
                err instanceof Error ? err.message : err,
            );
            res.status(500).json({
                error: err instanceof Error ? err.message : 'failed',
            });
        }
    });

    return router;
}
