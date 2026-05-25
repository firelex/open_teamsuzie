import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    AppShellContent,
    Button,
    ColumnHeaderEditor,
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Download,
    LoadingState,
    PageHeader,
    PageHeaderActions,
    PageHeaderContent,
    PageHeaderDescription,
    PageHeaderTitle,
    PendingButton,
    Plus,
    ReviewGrid,
    Trash2,
    useConfirm,
} from '@teamsuzie/ui';
import {
    ColumnPresetRegistry,
    type ColumnPreset,
} from '@teamsuzie/grid-review/browser';
import {
    useReview,
    type CellFormat,
    type ReviewColumn,
} from '../hooks/use-review.js';
import { useMatter, type MatterDocument } from '../hooks/use-matter.js';
import { draftColumnPrompt } from '../hooks/draft-column-prompt.js';
import { resolveMattersLabel } from '../manifest/defaults.js';
import type { AgentManifest } from '../manifest/schema.js';

interface Props {
    manifest: AgentManifest | null;
}

/**
 * Empty preset registry — kept so a host can plug presets in later
 * without re-threading props. The primary autofill mechanism is the
 * async `draftFromTitle` callback (review-column-prompt AI-draft
 * kind), which the column editor calls on title blur.
 */
const columnPresets = new ColumnPresetRegistry();

export function ReviewDetailPage({ manifest }: Props) {
    const { matterId, reviewId } = useParams<{
        matterId: string;
        reviewId: string;
    }>();
    const confirm = useConfirm();
    const navigate = useNavigate();
    const matterLabel = manifest
        ? resolveMattersLabel(manifest)
        : { singular: 'Matter', plural: 'Matters' };

    const {
        snapshot,
        loading,
        error,
        addColumn,
        updateColumn,
        removeColumn,
        addDocument,
        removeDocument,
        runAllPending,
        runCell,
        runColumn,
        runRow,
    } = useReview(matterId, reviewId);
    const matter = useMatter(matterId);

    const [columnDialog, setColumnDialog] = useState<{
        mode: 'create' | 'edit';
        initial: { title: string; prompt: string; format: CellFormat };
        existingId?: string;
    } | null>(null);
    const [addDocsOpen, setAddDocsOpen] = useState(false);
    const [running, setRunning] = useState(false);

    const alreadyInReview = useMemo(() => {
        const s = new Set<string>();
        for (const d of snapshot?.documents ?? []) s.add(d.externalDocId);
        return s;
    }, [snapshot]);

    const eligibleDocs = matter.documents.filter(
        (d) => !alreadyInReview.has(d.externalDocId),
    );

    async function handleColumnSubmit(value: {
        title: string;
        prompt: string;
        format: CellFormat;
    }) {
        if (!columnDialog) return;
        if (columnDialog.mode === 'edit' && columnDialog.existingId) {
            await updateColumn(columnDialog.existingId, value);
        } else {
            await addColumn(value);
        }
    }

    async function handleRunAll() {
        setRunning(true);
        try {
            await runAllPending();
        } catch (err) {
            // The hook already turns the 501 into a friendly message.
            window.alert(err instanceof Error ? err.message : 'Run failed');
        } finally {
            setRunning(false);
        }
    }

    if (!matterId || !reviewId) {
        return (
            <>
                <PageHeader>
                    <PageHeaderContent>
                        <PageHeaderTitle>Review</PageHeaderTitle>
                    </PageHeaderContent>
                </PageHeader>
                <AppShellContent className="px-6 pt-6 pb-12">
                    <p className="text-sm text-destructive">
                        Missing matter or review id.
                    </p>
                </AppShellContent>
            </>
        );
    }

    return (
        <>
            <PageHeader>
                <PageHeaderContent>
                    <Link
                        to={`/matters/${encodeURIComponent(matterId)}`}
                        className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground"
                    >
                        ←{' '}
                        {matter.matter?.name ??
                            `Back to ${matterLabel.singular.toLowerCase()}`}
                    </Link>
                    <PageHeaderTitle>
                        {snapshot?.review.name ?? 'Review'}
                    </PageHeaderTitle>
                    {snapshot?.review.description && (
                        <PageHeaderDescription>
                            {snapshot.review.description}
                        </PageHeaderDescription>
                    )}
                </PageHeaderContent>
                <PageHeaderActions>
                    <a
                        href={`/api/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(reviewId)}/export.xlsx`}
                        title="Download as Excel"
                    >
                        <Button variant="outline">
                            <Download className="size-4" aria-hidden />
                            Export xlsx
                        </Button>
                    </a>
                    <Button
                        variant="outline"
                        onClick={() => setAddDocsOpen(true)}
                        disabled={
                            !snapshot || eligibleDocs.length === 0
                        }
                        title={
                            eligibleDocs.length === 0
                                ? 'Every matter document is already in this review'
                                : 'Add documents to this review'
                        }
                    >
                        <Plus className="size-4" aria-hidden />
                        Add documents
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() =>
                            setColumnDialog({
                                mode: 'create',
                                initial: {
                                    title: '',
                                    prompt: '',
                                    format: 'text',
                                },
                            })
                        }
                        disabled={!snapshot}
                    >
                        <Plus className="size-4" aria-hidden />
                        Add column
                    </Button>
                    <PendingButton
                        onClick={() => void handleRunAll()}
                        disabled={!snapshot}
                        pending={running}
                        pendingLabel="Running"
                    >
                        Run pending
                    </PendingButton>
                </PageHeaderActions>
            </PageHeader>

            <AppShellContent className="px-6 pt-6 pb-12">
                {error && (
                    <p className="mb-4 text-sm text-destructive">{error}</p>
                )}
                {loading || !snapshot ? (
                    <LoadingState>Loading review…</LoadingState>
                ) : snapshot.columns.length === 0 &&
                  snapshot.documents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        Empty review — add a column and some documents to
                        get started.
                    </p>
                ) : (
                    <ReviewGrid
                        snapshot={snapshot}
                        busy={running}
                        onColumnClick={(c: ReviewColumn) =>
                            setColumnDialog({
                                mode: 'edit',
                                initial: {
                                    title: c.title,
                                    prompt: c.prompt,
                                    format: c.format,
                                },
                                existingId: c.id,
                            })
                        }
                        onColumnRemove={async (c) => {
                            if (
                                await confirm({
                                    title: `Delete column "${c.title}"?`,
                                    description:
                                        'Removes the column and every cell in it. There is no undo.',
                                    confirmLabel: 'Delete column',
                                    variant: 'destructive',
                                })
                            ) {
                                void removeColumn(c.id);
                            }
                        }}
                        onRowRemove={async (d) => {
                            if (
                                await confirm({
                                    title: `Remove "${d.name}" from this review?`,
                                    description:
                                        'The document stays in the matter — only this row of the review goes away.',
                                    confirmLabel: 'Remove row',
                                    variant: 'destructive',
                                })
                            ) {
                                void removeDocument(d.id);
                            }
                        }}
                        onColumnRun={async (c) => {
                            setRunning(true);
                            try {
                                await runColumn({ columnId: c.id });
                            } catch (err) {
                                window.alert(
                                    err instanceof Error ? err.message : 'Failed',
                                );
                            } finally {
                                setRunning(false);
                            }
                        }}
                        onColumnRegenerate={async (c) => {
                            setRunning(true);
                            try {
                                await runColumn({
                                    columnId: c.id,
                                    regenerate: true,
                                });
                            } catch (err) {
                                window.alert(
                                    err instanceof Error ? err.message : 'Failed',
                                );
                            } finally {
                                setRunning(false);
                            }
                        }}
                        onRowRun={async (d) => {
                            setRunning(true);
                            try {
                                await runRow({ reviewDocumentId: d.id });
                            } catch (err) {
                                window.alert(
                                    err instanceof Error ? err.message : 'Failed',
                                );
                            } finally {
                                setRunning(false);
                            }
                        }}
                        onRowRegenerate={async (d) => {
                            setRunning(true);
                            try {
                                await runRow({
                                    reviewDocumentId: d.id,
                                    regenerate: true,
                                });
                            } catch (err) {
                                window.alert(
                                    err instanceof Error ? err.message : 'Failed',
                                );
                            } finally {
                                setRunning(false);
                            }
                        }}
                        onCellRegenerate={async (col, doc) => {
                            setRunning(true);
                            try {
                                await runCell({
                                    columnId: col.id,
                                    reviewDocumentId: doc.id,
                                });
                            } catch (err) {
                                window.alert(
                                    err instanceof Error ? err.message : 'Failed',
                                );
                            } finally {
                                setRunning(false);
                            }
                        }}
                    />
                )}
            </AppShellContent>

            {columnDialog && (
                <ColumnDialog
                    mode={columnDialog.mode}
                    initial={columnDialog.initial}
                    onClose={() => setColumnDialog(null)}
                    onSubmit={async (value) => {
                        await handleColumnSubmit(value);
                        setColumnDialog(null);
                    }}
                />
            )}

            <AddDocumentsDialog
                open={addDocsOpen}
                onOpenChange={setAddDocsOpen}
                eligible={eligibleDocs}
                onAdd={async (docs) => {
                    for (const d of docs) {
                        await addDocument({
                            externalDocId: d.externalDocId,
                            name: d.name,
                            mimeType: d.mimeType,
                        });
                    }
                }}
            />
        </>
    );
}

interface ColumnDialogProps {
    mode: 'create' | 'edit';
    initial: { title: string; prompt: string; format: CellFormat };
    onClose: () => void;
    onSubmit: (value: {
        title: string;
        prompt: string;
        format: CellFormat;
    }) => Promise<void>;
}

function ColumnDialog({
    mode,
    initial,
    onClose,
    onSubmit,
}: ColumnDialogProps) {
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const findPreset = (title: string): ColumnPreset | null =>
        columnPresets.match(title);

    async function handle(value: {
        title: string;
        prompt: string;
        format: CellFormat;
    }) {
        setBusy(true);
        setErr(null);
        try {
            await onSubmit(value);
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Failed');
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(next) => !next && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {mode === 'create' ? 'Add column' : 'Edit column'}
                    </DialogTitle>
                    <DialogDescription>
                        {mode === 'create'
                            ? 'One question to ask of every document in this review.'
                            : 'Adjust the title, prompt, or format for this column.'}
                    </DialogDescription>
                </DialogHeader>
                <ColumnHeaderEditor
                    key={`${mode}-${initial.title}-${initial.prompt}`}
                    mode={mode}
                    initial={initial}
                    findPreset={findPreset}
                    draftFromTitle={async ({
                        title,
                        formatHint,
                        formatDirty,
                        signal,
                    }) => {
                        return draftColumnPrompt({
                            title,
                            formatHint,
                            formatLocked: formatDirty,
                            signal,
                        });
                    }}
                    onSubmit={handle}
                    onCancel={onClose}
                    busy={busy}
                    error={err}
                    submitLabel={mode === 'create' ? 'Add column' : 'Save changes'}
                />
            </DialogContent>
        </Dialog>
    );
}

interface AddDocumentsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    eligible: MatterDocument[];
    onAdd: (docs: MatterDocument[]) => Promise<void>;
}

function AddDocumentsDialog({
    open,
    onOpenChange,
    eligible,
    onAdd,
}: AddDocumentsDialogProps) {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useMemo(() => {
        if (open) {
            setSelected(new Set());
            setErr(null);
        }
    }, [open]);

    async function submit() {
        if (selected.size === 0) {
            onOpenChange(false);
            return;
        }
        setBusy(true);
        setErr(null);
        try {
            const picked = eligible.filter((d) => selected.has(d.id));
            await onAdd(picked);
            onOpenChange(false);
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Failed');
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add documents</DialogTitle>
                    <DialogDescription>
                        Pick from this matter's documents. Each becomes a row
                        in the review.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-1 max-h-[40vh] overflow-y-auto">
                    {eligible.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            No more documents to add.
                        </p>
                    ) : (
                        eligible.map((doc) => (
                            <label
                                key={doc.id}
                                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/50"
                            >
                                <input
                                    type="checkbox"
                                    checked={selected.has(doc.id)}
                                    onChange={(e) => {
                                        setSelected((current) => {
                                            const next = new Set(current);
                                            if (e.target.checked) next.add(doc.id);
                                            else next.delete(doc.id);
                                            return next;
                                        });
                                    }}
                                />
                                <span className="flex-1 truncate text-sm">
                                    {doc.name || 'Untitled'}
                                </span>
                            </label>
                        ))
                    )}
                </div>
                {err && <p className="text-xs text-destructive">{err}</p>}
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline" disabled={busy}>
                            Cancel
                        </Button>
                    </DialogClose>
                    <Button
                        onClick={() => void submit()}
                        disabled={busy || selected.size === 0}
                    >
                        {busy
                            ? 'Adding…'
                            : `Add ${selected.size || ''}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
