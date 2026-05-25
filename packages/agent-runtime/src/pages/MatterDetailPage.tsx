import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    AppShellContent,
    Button,
    Download,
    EmptyState,
    EmptyStateDescription,
    EmptyStateTitle,
    FileText,
    LoadingState,
    PageHeader,
    PageHeaderActions,
    PageHeaderContent,
    PageHeaderDescription,
    PageHeaderTitle,
    PendingButton,
    Plus,
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
    const { reviews, loading, error, createFromWorkflow, remove } =
        useMatterReviews(matterId);
    const [dialogOpen, setDialogOpen] = useState(false);

    return (
        <section>
            <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold tracking-tight">Reviews</h2>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDialogOpen(true)}
                    disabled={documents.length === 0}
                    title={
                        documents.length === 0
                            ? `Upload documents to this ${label.singular.toLowerCase()} first`
                            : 'New review from workflow'
                    }
                >
                    <Plus className="size-4" aria-hidden />
                    New review
                </Button>
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
                        Pick a workflow with columns + the docs to review.
                        Cell-running comes online once the knowledge-base
                        module ships; for now the review provides the column
                        + document scaffold and the xlsx export.
                    </EmptyStateDescription>
                </EmptyState>
            ) : (
                <ul className="divide-y divide-border rounded-md border border-border bg-card">
                    {reviews.map((r) => (
                        <li
                            key={r.id}
                            className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40"
                        >
                            <div className="flex-1 min-w-0">
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
                            </div>
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
            <FromWorkflowDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
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
