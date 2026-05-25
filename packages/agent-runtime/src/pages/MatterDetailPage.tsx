import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    AppShellContent,
    Button,
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Download,
    EmptyState,
    EmptyStateDescription,
    EmptyStateTitle,
    FileText,
    Input,
    Label,
    LoadingState,
    PageHeader,
    PageHeaderActions,
    PageHeaderContent,
    PageHeaderDescription,
    PageHeaderTitle,
    PendingButton,
    Plus,
    Textarea,
    Trash2,
    Upload,
    Users,
    humanSize,
    useConfirm,
} from '@teamsuzie/ui';
import { useMatter, type MatterDocument } from '../hooks/use-matter.js';
import { useMatterChats } from '../hooks/use-matter-chats.js';
import { useMatterReviews } from '../hooks/use-matter-reviews.js';
import { useMatterMetadata } from '../hooks/use-matter-metadata.js';
import { ShareDialog } from '../components/share-dialog.js';
import { FromWorkflowDialog } from '../components/from-workflow-dialog.js';
import { MatterMetadataSection } from '../components/matter-metadata-section.js';
import { resolveMattersLabel, resolveModules } from '../manifest/defaults.js';
import type { AgentManifest } from '../manifest/schema.js';

interface Props {
    manifest: AgentManifest | null;
}

function formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
    });
}

function formatRelative(ms: number): string {
    const diff = Date.now() - ms;
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return formatDate(ms);
}

function ChatsSection({
    matterId,
    label,
}: {
    matterId: string;
    label: { singular: string; plural: string };
}) {
    const confirm = useConfirm();
    const navigate = useNavigate();
    const chats = useMatterChats(matterId);
    const [creating, setCreating] = useState(false);
    const singularLower = label.singular.toLowerCase();

    async function startNewChat() {
        setCreating(true);
        try {
            const chat = await chats.create();
            navigate(
                `/m/${encodeURIComponent(matterId)}/c/${encodeURIComponent(chat.id)}`,
            );
        } finally {
            setCreating(false);
        }
    }

    return (
        <section>
            <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold tracking-tight">Chats</h2>
                <PendingButton
                    size="sm"
                    variant="outline"
                    onClick={() => void startNewChat()}
                    pending={creating}
                    pendingLabel="Starting"
                >
                    <Plus className="size-4" aria-hidden />
                    New chat
                </PendingButton>
            </div>
            {chats.error && (
                <p className="text-xs text-destructive">{chats.error}</p>
            )}
            {chats.loading ? (
                <LoadingState>Loading chats…</LoadingState>
            ) : chats.chats.length === 0 ? (
                <EmptyState>
                    <EmptyStateTitle>No chats yet</EmptyStateTitle>
                    <EmptyStateDescription>
                        Start a chat anchored to this {singularLower}. The
                        assistant sees every doc in the {singularLower}{' '}
                        automatically.
                    </EmptyStateDescription>
                </EmptyState>
            ) : (
                <ul className="divide-y divide-border rounded-md border border-border bg-card">
                    {chats.chats.map((chat) => (
                        <li
                            key={chat.id}
                            className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40"
                        >
                            <Link
                                to={`/m/${encodeURIComponent(matterId)}/c/${encodeURIComponent(chat.id)}`}
                                className="flex-1 min-w-0"
                            >
                                <div className="truncate text-sm font-medium text-foreground">
                                    {chat.name}
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                    Updated {formatRelative(chat.updatedAt)}
                                </div>
                            </Link>
                            <Button
                                variant="outline"
                                size="icon"
                                className="size-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                aria-label={`Delete ${chat.name}`}
                                onClick={async () => {
                                    if (
                                        await confirm({
                                            title: `Delete chat "${chat.name}"?`,
                                            description:
                                                'The conversation history for this chat will be removed.',
                                            confirmLabel: 'Delete chat',
                                            variant: 'destructive',
                                        })
                                    ) {
                                        void chats.remove(chat.id);
                                    }
                                }}
                            >
                                <Trash2 className="size-4" aria-hidden />
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function NewReviewDialog({
    open,
    onOpenChange,
    onCreate,
}: {
    open: boolean;
    onOpenChange: (next: boolean) => void;
    onCreate: (input: { name: string; description?: string }) => Promise<void>;
}) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setName('');
            setDescription('');
            setErr(null);
        }
    }, [open]);

    async function submit() {
        const trimmed = name.trim();
        if (!trimmed) {
            setErr('Name is required');
            return;
        }
        setBusy(true);
        setErr(null);
        try {
            await onCreate({
                name: trimmed,
                description: description.trim() || undefined,
            });
            setName('');
            setDescription('');
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
                    <DialogTitle>New review</DialogTitle>
                    <DialogDescription>
                        Tabular review of multiple documents — one row per
                        document, one column per question. Build the columns
                        on the next screen.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="review-name">Name</Label>
                        <Input
                            id="review-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Diligence Q&A"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    void submit();
                                }
                            }}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="review-description">
                            Description (optional)
                        </Label>
                        <Textarea
                            id="review-description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={2}
                        />
                    </div>
                    {err && <p className="text-xs text-destructive">{err}</p>}
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline" disabled={busy}>
                            Cancel
                        </Button>
                    </DialogClose>
                    <PendingButton
                        onClick={() => void submit()}
                        pending={busy}
                        pendingLabel="Creating"
                    >
                        Create review
                    </PendingButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ReviewsSection({
    matterId,
    documents,
    label,
}: {
    matterId: string;
    documents: MatterDocument[];
    label: { singular: string; plural: string };
}) {
    const confirm = useConfirm();
    const navigate = useNavigate();
    const { reviews, loading, error, create, createFromWorkflow, remove } =
        useMatterReviews(matterId);
    const [newReviewOpen, setNewReviewOpen] = useState(false);
    const [fromWorkflowOpen, setFromWorkflowOpen] = useState(false);

    async function handleCreate(input: { name: string; description?: string }) {
        const review = await create(input);
        // Navigate straight to the grid — suzielaw pattern: blank review
        // → build columns + add documents inline.
        navigate(
            `/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(review.id)}`,
        );
    }

    return (
        <section>
            <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold tracking-tight">Reviews</h2>
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setFromWorkflowOpen(true)}
                        disabled={documents.length === 0}
                        title={
                            documents.length === 0
                                ? `Upload documents to this ${label.singular.toLowerCase()} first`
                                : 'Pre-populate from a saved tabular workflow'
                        }
                    >
                        From workflow…
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => setNewReviewOpen(true)}
                    >
                        <Plus className="size-4" aria-hidden />
                        New review
                    </Button>
                </div>
            </div>
            {error && (
                <p className="text-xs text-destructive">{error}</p>
            )}
            {loading ? (
                <LoadingState>Loading reviews…</LoadingState>
            ) : reviews.length === 0 ? (
                <EmptyState>
                    <EmptyStateTitle>No reviews yet</EmptyStateTitle>
                    <EmptyStateDescription>
                        Create an empty review then build columns + add
                        documents on the review page. Or pre-fill from a
                        saved tabular workflow.
                    </EmptyStateDescription>
                </EmptyState>
            ) : (
                <ul className="divide-y divide-border rounded-md border border-border bg-card">
                    {reviews.map((r) => (
                        <li
                            key={r.id}
                            className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40"
                        >
                            <Link
                                to={`/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(r.id)}`}
                                className="flex-1 min-w-0"
                            >
                                <p className="truncate text-sm font-medium text-foreground">
                                    {r.name}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                    Updated{' '}
                                    {new Date(r.updatedAt).toLocaleDateString(
                                        undefined,
                                        {
                                            year: 'numeric',
                                            month: 'short',
                                            day: '2-digit',
                                        },
                                    )}
                                </p>
                            </Link>
                            <a
                                href={`/api/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(r.id)}/export.xlsx`}
                                title="Download as Excel"
                            >
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="size-8"
                                    aria-label={`Download ${r.name} as xlsx`}
                                >
                                    <Download className="size-4" aria-hidden />
                                </Button>
                            </a>
                            <Button
                                variant="outline"
                                size="icon"
                                className="size-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                aria-label={`Delete ${r.name}`}
                                onClick={async () => {
                                    if (
                                        await confirm({
                                            title: `Delete review "${r.name}"?`,
                                            description:
                                                'This removes the review and its column / document scaffolding. There is no undo.',
                                            confirmLabel: 'Delete review',
                                            variant: 'destructive',
                                        })
                                    ) {
                                        void remove(r.id);
                                    }
                                }}
                            >
                                <Trash2 className="size-4" aria-hidden />
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
            <NewReviewDialog
                open={newReviewOpen}
                onOpenChange={setNewReviewOpen}
                onCreate={handleCreate}
            />
            <FromWorkflowDialog
                open={fromWorkflowOpen}
                onOpenChange={setFromWorkflowOpen}
                documents={documents}
                onCreate={createFromWorkflow}
            />
        </section>
    );
}

function DocumentRow({
    doc,
    matterId,
    onRemove,
}: {
    doc: MatterDocument;
    matterId: string;
    onRemove: (id: string) => Promise<void>;
}) {
    const confirm = useConfirm();
    const downloadUrl = `/api/files/${encodeURIComponent(matterId)}/${encodeURIComponent(doc.externalDocId)}/content`;
    return (
        <li className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40">
            <FileText className="size-4 text-muted-foreground" aria-hidden />
            <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-w-0"
            >
                <div className="truncate text-sm font-medium text-foreground">
                    {doc.name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                    {doc.size != null ? humanSize(doc.size) : '—'} · Added{' '}
                    {formatRelative(doc.addedAt)}
                </div>
            </a>
            <Button
                variant="outline"
                size="icon"
                className="size-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Delete ${doc.name}`}
                onClick={async () => {
                    if (
                        await confirm({
                            title: `Delete "${doc.name}"?`,
                            description:
                                'The file will be removed from this matter. There is no undo.',
                            confirmLabel: 'Delete document',
                            variant: 'destructive',
                        })
                    ) {
                        void onRemove(doc.id);
                    }
                }}
            >
                <Trash2 className="size-4" aria-hidden />
            </Button>
        </li>
    );
}

export function MatterDetailPage({ manifest }: Props) {
    const { matterId } = useParams<{ matterId: string }>();
    const label = manifest
        ? resolveMattersLabel(manifest)
        : { singular: 'Matter', plural: 'Matters' };
    const { matter, documents, loading, error, uploadDocument, removeDocument } =
        useMatter(matterId);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [shareOpen, setShareOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const reviewsEnabled = manifest
        ? resolveModules(manifest).reviews
        : false;
    const { metadata, save: saveMetadata } = useMatterMetadata(matterId);

    async function handleFiles(files: FileList | null) {
        if (!files || files.length === 0) return;
        setUploading(true);
        setUploadError(null);
        try {
            for (const file of Array.from(files)) {
                await uploadDocument(file);
            }
        } catch (err) {
            setUploadError(
                err instanceof Error ? err.message : 'Upload failed',
            );
        } finally {
            setUploading(false);
        }
    }

    if (!matterId) {
        return (
            <>
                <PageHeader>
                    <PageHeaderContent>
                        <PageHeaderTitle>{label.singular}</PageHeaderTitle>
                    </PageHeaderContent>
                </PageHeader>
                <AppShellContent className="px-6 pt-6 pb-12">
                    <p className="text-sm text-destructive">
                        Missing {label.singular.toLowerCase()} id.
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
                        to="/matters"
                        className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground"
                    >
                        ← All {label.plural.toLowerCase()}
                    </Link>
                    <PageHeaderTitle>
                        {matter?.name ?? label.singular}
                    </PageHeaderTitle>
                    {matter?.description && (
                        <PageHeaderDescription>
                            {matter.description}
                        </PageHeaderDescription>
                    )}
                </PageHeaderContent>
                <PageHeaderActions>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                            void handleFiles(event.target.files);
                            event.target.value = '';
                        }}
                    />
                    <Button
                        variant="outline"
                        onClick={() => setShareOpen(true)}
                        disabled={!matter}
                        title={`Share this ${label.singular.toLowerCase()} with a colleague`}
                    >
                        <Users className="size-4" aria-hidden />
                        Share
                    </Button>
                    <PendingButton
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!matter}
                        pending={uploading}
                        pendingLabel="Uploading"
                    >
                        <Upload className="size-4" aria-hidden />
                        Upload documents
                    </PendingButton>
                </PageHeaderActions>
            </PageHeader>

            <AppShellContent className="px-6 pt-6 pb-12">
                {error && (
                    <p className="mb-4 text-sm text-destructive">{error}</p>
                )}
                {uploadError && (
                    <p className="mb-4 text-sm text-destructive">
                        {uploadError}
                    </p>
                )}

                <MatterMetadataSection
                    manifest={manifest}
                    metadata={metadata}
                    onSave={saveMetadata}
                    matterLabel={label}
                />

                {loading ? (
                    <LoadingState>
                        Loading {label.singular.toLowerCase()}…
                    </LoadingState>
                ) : (
                    <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[2fr_1fr]">
                        <section>
                            <div className="mb-3 flex items-baseline justify-between">
                                <h2 className="text-sm font-semibold tracking-tight">
                                    Documents
                                </h2>
                                <span className="text-xs text-muted-foreground">
                                    {documents.length}{' '}
                                    {documents.length === 1
                                        ? 'document'
                                        : 'documents'}
                                </span>
                            </div>
                            {documents.length === 0 ? (
                                <EmptyState>
                                    <EmptyStateTitle>
                                        No documents yet
                                    </EmptyStateTitle>
                                    <EmptyStateDescription>
                                        Upload PDFs, DOCX, or text files to
                                        give the assistant context for this{' '}
                                        {label.singular.toLowerCase()}.
                                    </EmptyStateDescription>
                                </EmptyState>
                            ) : (
                                <ul className="divide-y divide-border rounded-md border border-border bg-card">
                                    {documents.map((doc) => (
                                        <DocumentRow
                                            key={doc.id}
                                            doc={doc}
                                            matterId={matterId}
                                            onRemove={removeDocument}
                                        />
                                    ))}
                                </ul>
                            )}
                        </section>

                        <div className="flex flex-col gap-8">
                            <ChatsSection matterId={matterId} label={label} />
                            {reviewsEnabled && (
                                <ReviewsSection
                                    matterId={matterId}
                                    documents={documents}
                                    label={label}
                                />
                            )}
                        </div>
                    </div>
                )}
            </AppShellContent>

            <ShareDialog
                open={shareOpen}
                onOpenChange={setShareOpen}
                subject={{ type: 'matter', id: matterId }}
                subjectName={matter?.name ?? label.singular}
                subjectNoun={label.singular.toLowerCase()}
            />
        </>
    );
}
