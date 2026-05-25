import { useEffect, useState } from 'react';
import {
    Badge,
    Button,
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Label,
    PendingButton,
    Pencil,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@teamsuzie/ui';
import {
    getMatterType,
    resolveMatterTypes,
    validateCustomFieldValues,
    type AgentManifest,
    type ManifestCustomField,
    type ManifestMatterType,
} from '../manifest/index.js';
import { CustomFieldsForm } from './custom-fields-form.js';
import type { MatterMetadata } from '../hooks/use-matter-metadata.js';

interface Props {
    manifest: AgentManifest | null;
    metadata: MatterMetadata | null;
    onSave: (input: {
        typeId: string | null;
        customFields: Record<string, unknown>;
    }) => Promise<MatterMetadata>;
    matterLabel: { singular: string; plural: string };
}

/**
 * Read-only render of a matter's type + custom field values, plus an
 * "Edit type & fields" affordance.
 *
 * Hides itself entirely when the manifest declares no matter types AND
 * there's no stored metadata to surface — single-type / untyped builds
 * don't see this section at all.
 *
 * When the stored `typeId` no longer matches any manifest type (a
 * staleType: e.g. the build owner removed the type after a matter was
 * created), the chip renders as "Unknown type" and the edit dialog
 * lets the user pick a new valid one. Custom field values are
 * preserved across the re-type.
 */
export function MatterMetadataSection({
    manifest,
    metadata,
    onSave,
    matterLabel,
}: Props) {
    const types = manifest ? resolveMatterTypes(manifest) : [];
    const storedType = manifest
        ? getMatterType(manifest, metadata?.typeId ?? null)
        : null;
    const hasStaleType =
        !!metadata?.typeId && storedType === null && types.length > 0;
    const [editOpen, setEditOpen] = useState(false);

    // Hide when there's nothing to render in either single-type-only
    // builds or fresh untyped matters in multi-type builds (the user
    // will set the type via "Edit type & fields" — the affordance
    // surfaces below when the manifest declares types).
    if (types.length === 0 && !metadata) return null;

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                            {matterLabel.singular} type
                        </span>
                        {storedType ? (
                            <Badge variant="outline">{storedType.label}</Badge>
                        ) : hasStaleType ? (
                            <Badge variant="outline" className="border-destructive/40 text-destructive">
                                Unknown type ({metadata?.typeId})
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                                Untyped
                            </Badge>
                        )}
                    </div>
                    {storedType?.description && (
                        <p className="text-xs text-muted-foreground">
                            {storedType.description}
                        </p>
                    )}
                    {storedType && (storedType.customFields?.length ?? 0) > 0 && (
                        <FieldValueList
                            fields={storedType.customFields ?? []}
                            values={metadata?.customFields ?? {}}
                        />
                    )}
                </div>
                {types.length > 0 && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditOpen(true)}
                    >
                        <Pencil className="size-4" aria-hidden />
                        Edit
                    </Button>
                )}
            </div>
            <EditMetadataDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                types={types}
                metadata={metadata}
                onSave={onSave}
                matterLabel={matterLabel}
            />
        </section>
    );
}

function FieldValueList({
    fields,
    values,
}: {
    fields: ManifestCustomField[];
    values: Record<string, unknown>;
}) {
    return (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {fields.map((f) => {
                const v = values[f.key];
                return (
                    <div
                        key={f.key}
                        className="flex flex-col gap-0.5 text-sm"
                    >
                        <dt className="text-xs text-muted-foreground">
                            {f.label}
                        </dt>
                        <dd>{formatFieldValue(f, v)}</dd>
                    </div>
                );
            })}
        </dl>
    );
}

function formatFieldValue(field: ManifestCustomField, value: unknown): string {
    if (value === undefined || value === null || value === '') return '—';
    if (field.type === 'boolean') return value === true ? 'Yes' : 'No';
    if (field.type === 'number') return String(value);
    return String(value);
}

interface EditMetadataDialogProps {
    open: boolean;
    onOpenChange: (next: boolean) => void;
    types: ManifestMatterType[];
    metadata: MatterMetadata | null;
    onSave: (input: {
        typeId: string | null;
        customFields: Record<string, unknown>;
    }) => Promise<MatterMetadata>;
    matterLabel: { singular: string; plural: string };
}

function EditMetadataDialog({
    open,
    onOpenChange,
    types,
    metadata,
    onSave,
    matterLabel,
}: EditMetadataDialogProps) {
    // Stored typeId; may not be present in current types[] (staleType).
    const initialTypeId = metadata?.typeId ?? null;
    const [typeId, setTypeId] = useState<string | null>(initialTypeId);
    const [values, setValues] = useState<Record<string, unknown>>(
        metadata?.customFields ?? {},
    );
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setTypeId(metadata?.typeId ?? null);
        setValues(metadata?.customFields ?? {});
        setErrors({});
        setError(null);
    }, [open, metadata]);

    const selectedType = typeId
        ? types.find((t) => t.id === typeId) ?? null
        : null;
    const customFields = selectedType?.customFields ?? [];

    async function handleSubmit() {
        const validation = validateCustomFieldValues(customFields, values);
        if (!validation.ok) {
            setErrors(validation.errors);
            setError('Please fix the highlighted fields.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await onSave({
                typeId,
                customFields: customFields.length > 0 ? values : {},
            });
            onOpenChange(false);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Failed to save',
            );
        } finally {
            setSubmitting(false);
        }
    }

    const singularLower = matterLabel.singular.toLowerCase();
    const hasStaleType =
        !!initialTypeId && !types.some((t) => t.id === initialTypeId);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        Edit {singularLower} type &amp; fields
                    </DialogTitle>
                    <DialogDescription>
                        {hasStaleType
                            ? `This ${singularLower}'s type "${initialTypeId}" is no longer defined. Pick a current type to re-categorize it — existing field values are preserved unless cleared.`
                            : `Change the ${singularLower}'s type or update its custom fields.`}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="matter-type">Type</Label>
                        <Select
                            value={typeId ?? ''}
                            onValueChange={(v) => {
                                setTypeId(v || null);
                                setErrors({});
                            }}
                            disabled={submitting}
                        >
                            <SelectTrigger id="matter-type">
                                <SelectValue placeholder="Pick a type…" />
                            </SelectTrigger>
                            <SelectContent>
                                {types.map((t) => (
                                    <SelectItem key={t.id} value={t.id}>
                                        {t.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {selectedType?.description && (
                            <p className="text-xs text-muted-foreground">
                                {selectedType.description}
                            </p>
                        )}
                    </div>
                    {customFields.length > 0 && (
                        <div className="border-t pt-4">
                            <CustomFieldsForm
                                fields={customFields}
                                values={values}
                                errors={errors}
                                disabled={submitting}
                                idPrefix="edit-meta"
                                onChange={(key, value) => {
                                    setValues((current) => ({
                                        ...current,
                                        [key]: value,
                                    }));
                                    setErrors((current) => {
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
                <DialogFooter>
                    <DialogClose asChild>
                        <Button
                            variant="outline"
                            type="button"
                            disabled={submitting}
                        >
                            Cancel
                        </Button>
                    </DialogClose>
                    <PendingButton
                        type="button"
                        onClick={() => void handleSubmit()}
                        pending={submitting}
                        pendingLabel="Saving"
                    >
                        Save
                    </PendingButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
