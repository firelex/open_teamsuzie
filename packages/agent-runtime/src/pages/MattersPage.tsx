import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AppShellContent,
    Archive,
    Button,
    MoreHorizontal,
    Pencil,
    Plus,
    Trash2,
    Users,
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    EmptyState,
    EmptyStateDescription,
    EmptyStateTitle,
    Input,
    Label,
    LoadingState,
    PendingButton,
    Switch,
    Textarea,
    cn,
    useConfirm,
} from '@teamsuzie/ui';
import { useMatters, type Matter } from '../hooks/use-matters.js';
import { ShareDialog } from '../components/share-dialog.js';
import { CustomFieldsForm } from '../components/custom-fields-form.js';
import {
    getMatterType,
    resolveMatterTypes,
    resolveMattersLabel,
    validateCustomFieldValues,
    type AgentManifest,
    type ManifestMatterType,
} from '../manifest/index.js';

interface MattersPageProps {
    manifest: AgentManifest | null;
}

function formatDate(ms: number): string {
    return new Date(ms)
        .toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
        });
}

interface NewMatterDialogProps {
    open: boolean;
    onOpenChange: (next: boolean) => void;
    onCreate: (input: {
        name: string;
        description?: string;
        typeId?: string | null;
        customFields?: Record<string, unknown>;
    }) => Promise<void>;
    label: { singular: string; plural: string };
    types: ManifestMatterType[];
}

function NewMatterDialog({
    open,
    onOpenChange,
    onCreate,
    label,
    types,
}: NewMatterDialogProps) {
    const [step, setStep] = useState<'type' | 'details'>(
        types.length > 1 ? 'type' : 'details',
    );
    const [selectedTypeId, setSelectedTypeId] = useState<string | null>(
        types.length === 1 ? types[0]!.id : null,
    );
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
    const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const selectedType = selectedTypeId
        ? types.find((t) => t.id === selectedTypeId) ?? null
        : null;
    const customFields = selectedType?.customFields ?? [];

    useEffect(() => {
        if (!open) return;
        setStep(types.length > 1 ? 'type' : 'details');
        setSelectedTypeId(types.length === 1 ? types[0]!.id : null);
        setName('');
        setDescription('');
        setCustomFieldValues({});
        setCustomFieldErrors({});
        setError(null);
    }, [open, types]);

    function handleSelectType(typeId: string) {
        setSelectedTypeId(typeId);
        setCustomFieldValues({});
        setCustomFieldErrors({});
        setStep('details');
    }

    async function handleSubmit() {
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError('Name is required');
            return;
        }
        // Validate custom fields against the selected type's config.
        const validation = validateCustomFieldValues(customFields, customFieldValues);
        if (!validation.ok) {
            setCustomFieldErrors(validation.errors);
            setError('Please fix the highlighted fields.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await onCreate({
                name: trimmedName,
                description: description.trim() || undefined,
                typeId: selectedTypeId,
                customFields:
                    customFields.length > 0 ? customFieldValues : undefined,
            });
            onOpenChange(false);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : `Failed to create ${label.singular.toLowerCase()}`,
            );
        } finally {
            setSubmitting(false);
        }
    }

    const singularLower = label.singular.toLowerCase();
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {step === 'type'
                            ? `New ${singularLower} — pick a type`
                            : `New ${singularLower}${selectedType ? ` · ${selectedType.label}` : ''}`}
                    </DialogTitle>
                    <DialogDescription>
                        {step === 'type'
                            ? `Pick the kind of ${singularLower} to determine which fields to capture.`
                            : `Group documents, chats, and reviews together under a single ${singularLower}.`}
                    </DialogDescription>
                </DialogHeader>

                {step === 'type' ? (
                    <ul className="space-y-2">
                        {types.map((t) => (
                            <li key={t.id}>
                                <button
                                    type="button"
                                    onClick={() => handleSelectType(t.id)}
                                    className="flex w-full flex-col items-start gap-1 rounded-md border border-input bg-card p-3 text-left hover:border-foreground/30 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                >
                                    <span className="text-sm font-medium">
                                        {t.label}
                                    </span>
                                    {t.description && (
                                        <span className="text-xs text-muted-foreground">
                                            {t.description}
                                        </span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="matter-name">Name</Label>
                            <Input
                                id="matter-name"
                                value={name}
                                onChange={(event) =>
                                    setName(event.target.value)
                                }
                                placeholder="e.g. Acme acquisition"
                                autoFocus
                                onKeyDown={(event) => {
                                    if (
                                        event.key === 'Enter' &&
                                        !event.shiftKey
                                    ) {
                                        event.preventDefault();
                                        void handleSubmit();
                                    }
                                }}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="matter-description">
                                Description (optional)
                            </Label>
                            <Textarea
                                id="matter-description"
                                value={description}
                                onChange={(event) =>
                                    setDescription(event.target.value)
                                }
                                placeholder={`What's this ${singularLower} about?`}
                                rows={3}
                            />
                        </div>
                        {customFields.length > 0 && (
                            <div className="border-t pt-4">
                                <CustomFieldsForm
                                    fields={customFields}
                                    values={customFieldValues}
                                    errors={customFieldErrors}
                                    disabled={submitting}
                                    idPrefix="new-matter"
                                    onChange={(key, value) => {
                                        setCustomFieldValues((current) => ({
                                            ...current,
                                            [key]: value,
                                        }));
                                        // Clear the field's error as the
                                        // user edits so the red prompt
                                        // doesn't linger after they fix it.
                                        setCustomFieldErrors((current) => {
                                            if (!current[key]) return current;
                                            const next = { ...current };
                                            delete next[key];
                                            return next;
                                        });
                                    }}
                                />
                            </div>
                        )}
                        {error && (
                            <p className="text-xs text-destructive">{error}</p>
                        )}
                    </div>
                )}

                <DialogFooter>
                    {step === 'details' && types.length > 1 && (
                        <Button
                            variant="outline"
                            type="button"
                            disabled={submitting}
                            onClick={() => setStep('type')}
                        >
                            Back
                        </Button>
                    )}
                    <DialogClose asChild>
                        <Button
                            variant="outline"
                            type="button"
                            disabled={submitting}
                        >
                            Cancel
                        </Button>
                    </DialogClose>
                    {step === 'details' && (
                        <PendingButton
                            type="button"
                            onClick={() => void handleSubmit()}
                            pending={submitting}
                            pendingLabel="Creating"
                        >
                            Create {singularLower}
                        </PendingButton>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

interface MatterCardProps {
    matter: Matter;
    label: { singular: string; plural: string };
    onRename: (id: string, name: string) => Promise<void>;
    onArchive: (id: string) => Promise<void>;
    onUnarchive: (id: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}

function MatterCard({
    matter,
    label,
    onRename,
    onArchive,
    onUnarchive,
    onDelete,
}: MatterCardProps) {
    const [editing, setEditing] = useState(false);
    const [draftName, setDraftName] = useState(matter.name);
    const [busy, setBusy] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const confirm = useConfirm();
    const navigate = useNavigate();

    useEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);

    const navigateToMatter = () => {
        if (editing) return;
        navigate(`/matters/${encodeURIComponent(matter.id)}`);
    };

    async function commitRename() {
        const trimmed = draftName.trim();
        if (!trimmed || trimmed === matter.name) {
            setDraftName(matter.name);
            setEditing(false);
            return;
        }
        setBusy(true);
        try {
            await onRename(matter.id, trimmed);
        } catch {
            setDraftName(matter.name);
        } finally {
            setBusy(false);
            setEditing(false);
        }
    }

    const isArchived = matter.archivedAt !== null;
    const singularLower = label.singular.toLowerCase();

    return (
        <Card
            role={editing ? undefined : 'link'}
            tabIndex={editing ? undefined : 0}
            onClick={editing ? undefined : navigateToMatter}
            onKeyDown={
                editing
                    ? undefined
                    : (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              navigateToMatter();
                          }
                      }
            }
            className={cn(
                'flex flex-col transition-all',
                !editing &&
                    'cursor-pointer hover:border-foreground/30 hover:shadow-sm focus-visible:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                isArchived && 'opacity-70',
            )}
        >
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                <div className="flex-1 min-w-0">
                    {editing ? (
                        <Input
                            ref={inputRef}
                            value={draftName}
                            onChange={(event) =>
                                setDraftName(event.target.value)
                            }
                            onClick={(event) => event.stopPropagation()}
                            onBlur={() => void commitRename()}
                            onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void commitRename();
                                } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setDraftName(matter.name);
                                    setEditing(false);
                                }
                            }}
                            disabled={busy}
                            className="h-7 text-base font-semibold"
                        />
                    ) : (
                        <CardTitle className="truncate text-base">
                            <span>{matter.name}</span>
                            {isArchived && (
                                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    Archived
                                </span>
                            )}
                        </CardTitle>
                    )}
                    {matter.description && (
                        <CardDescription className="mt-1 line-clamp-2">
                            {matter.description}
                        </CardDescription>
                    )}
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="outline"
                            size="icon"
                            className="size-8"
                            aria-label={`${label.singular} actions`}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <MoreHorizontal className="size-4" aria-hidden />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="end"
                        onCloseAutoFocus={(e) => e.preventDefault()}
                    >
                        <DropdownMenuItem onSelect={() => setEditing(true)}>
                            <Pencil className="size-4" aria-hidden />
                            Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setShareOpen(true)}>
                            <Users className="size-4" aria-hidden />
                            Share
                        </DropdownMenuItem>
                        {isArchived ? (
                            <DropdownMenuItem
                                onSelect={() => void onUnarchive(matter.id)}
                            >
                                <Archive className="size-4" aria-hidden />
                                Unarchive
                            </DropdownMenuItem>
                        ) : (
                            <DropdownMenuItem
                                onSelect={() => void onArchive(matter.id)}
                            >
                                <Archive className="size-4" aria-hidden />
                                Archive
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={async (e) => {
                                e.preventDefault();
                                if (
                                    await confirm({
                                        title: `Delete "${matter.name}"?`,
                                        description: `This removes the ${singularLower} and everything inside it — documents, chats, reviews. There is no undo.`,
                                        confirmLabel: `Delete ${singularLower}`,
                                        variant: 'destructive',
                                    })
                                ) {
                                    void onDelete(matter.id);
                                }
                            }}
                        >
                            <Trash2 className="size-4" aria-hidden />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>
            <CardContent className="flex-1" />
            <CardFooter className="text-xs text-muted-foreground">
                Created {formatDate(matter.createdAt)}
                {matter.updatedAt !== matter.createdAt && (
                    <span className="ml-3">
                        Updated {formatDate(matter.updatedAt)}
                    </span>
                )}
            </CardFooter>
            <ShareDialog
                open={shareOpen}
                onOpenChange={setShareOpen}
                subject={{ type: 'matter', id: matter.id }}
                subjectName={matter.name}
                subjectNoun={singularLower}
            />
        </Card>
    );
}

export function MattersPage({ manifest }: MattersPageProps) {
    const label = manifest
        ? resolveMattersLabel(manifest)
        : { singular: 'Matter', plural: 'Matters' };
    const types = manifest ? resolveMatterTypes(manifest) : [];
    const {
        matters,
        loading,
        error,
        includeArchived,
        setIncludeArchived,
        create,
        update,
        archive,
        unarchive,
        remove,
    } = useMatters();
    const [dialogOpen, setDialogOpen] = useState(false);

    const handleRename = async (id: string, name: string) => {
        await update(id, { name });
    };

    const handleCreate = async (input: {
        name: string;
        description?: string;
        typeId?: string | null;
        customFields?: Record<string, unknown>;
    }) => {
        await create({
            name: input.name,
            description: input.description,
            typeId: input.typeId,
            customFields: input.customFields,
        });
    };

    const singularLower = label.singular.toLowerCase();
    const pluralLower = label.plural.toLowerCase();

    return (
        <>
            <div className="border-b border-foreground/15 px-8 pb-6 pt-8">
                <div className="flex items-end justify-between gap-6">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            {label.plural}
                        </h1>
                        <p className="mt-1 max-w-md text-sm text-muted-foreground">
                            Group documents, chats, and reviews under a{' '}
                            {singularLower}.
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                            <Switch
                                checked={includeArchived}
                                onCheckedChange={setIncludeArchived}
                                aria-label={`Show archived ${pluralLower}`}
                            />
                            <span>Show archived</span>
                        </label>
                        <Button onClick={() => setDialogOpen(true)}>
                            <Plus className="size-4" aria-hidden /> New{' '}
                            {singularLower}
                        </Button>
                    </div>
                </div>
            </div>
            <AppShellContent className="px-8 pt-6 pb-12">
                {error && (
                    <p className="mb-4 text-sm text-destructive">{error}</p>
                )}

                {loading ? (
                    <LoadingState>Loading {pluralLower}…</LoadingState>
                ) : matters.length === 0 ? (
                    <EmptyState>
                        <EmptyStateTitle>
                            No {pluralLower} yet
                        </EmptyStateTitle>
                        <EmptyStateDescription>
                            Create your first {singularLower} to start grouping
                            documents and chats.
                        </EmptyStateDescription>
                        <Button
                            className="mt-4"
                            onClick={() => setDialogOpen(true)}
                        >
                            <Plus className="size-4" aria-hidden />
                            Create your first {singularLower}
                        </Button>
                    </EmptyState>
                ) : types.length > 1 ? (
                    <GroupedMattersList
                        matters={matters}
                        types={types}
                        label={label}
                        onRename={handleRename}
                        onArchive={archive}
                        onUnarchive={unarchive}
                        onDelete={remove}
                    />
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                        {matters.map((matter) => (
                            <MatterCard
                                key={matter.id}
                                matter={matter}
                                label={label}
                                onRename={handleRename}
                                onArchive={archive}
                                onUnarchive={unarchive}
                                onDelete={remove}
                            />
                        ))}
                    </div>
                )}
            </AppShellContent>

            <NewMatterDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                onCreate={handleCreate}
                label={label}
                types={types}
            />
        </>
    );
}

interface GroupedMattersListProps {
    matters: Matter[];
    types: ManifestMatterType[];
    label: { singular: string; plural: string };
    onRename: (id: string, name: string) => Promise<void>;
    onArchive: (id: string) => Promise<void>;
    onUnarchive: (id: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}

/**
 * When the manifest declares multiple matter types, group the cards by
 * type rather than rendering one flat grid. Types render in manifest
 * declaration order. Untyped matters (no metadata row, or a metadata
 * row with a stale type_id no longer in the manifest) land in a
 * trailing "Untyped" section so the user can still see and re-type them.
 */
function GroupedMattersList({
    matters,
    types,
    label,
    onRename,
    onArchive,
    onUnarchive,
    onDelete,
}: GroupedMattersListProps) {
    const typeIds = new Set(types.map((t) => t.id));
    const byType = new Map<string, Matter[]>();
    const untyped: Matter[] = [];
    for (const m of matters) {
        const tid = m.metadata?.typeId;
        if (tid && typeIds.has(tid)) {
            const list = byType.get(tid) ?? [];
            list.push(m);
            byType.set(tid, list);
        } else {
            untyped.push(m);
        }
    }

    return (
        <div className="space-y-8">
            {types.map((t) => {
                const list = byType.get(t.id) ?? [];
                if (list.length === 0) return null;
                return (
                    <section key={t.id}>
                        <div className="mb-3 flex items-baseline gap-3">
                            <h2 className="text-sm font-semibold tracking-tight">
                                {t.label}
                            </h2>
                            <span className="text-xs text-muted-foreground">
                                {list.length}
                            </span>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                            {list.map((matter) => (
                                <MatterCard
                                    key={matter.id}
                                    matter={matter}
                                    label={label}
                                    onRename={onRename}
                                    onArchive={onArchive}
                                    onUnarchive={onUnarchive}
                                    onDelete={onDelete}
                                />
                            ))}
                        </div>
                    </section>
                );
            })}
            {untyped.length > 0 && (
                <section>
                    <div className="mb-3 flex items-baseline gap-3">
                        <h2 className="text-sm font-semibold tracking-tight text-muted-foreground">
                            Untyped
                        </h2>
                        <span className="text-xs text-muted-foreground">
                            {untyped.length}
                        </span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                        {untyped.map((matter) => (
                            <MatterCard
                                key={matter.id}
                                matter={matter}
                                label={label}
                                onRename={onRename}
                                onArchive={onArchive}
                                onUnarchive={onUnarchive}
                                onDelete={onDelete}
                            />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
