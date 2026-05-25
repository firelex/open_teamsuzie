import { useEffect, useMemo, useState } from 'react';
import {
    Button,
    Checkbox,
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    EmptyState,
    EmptyStateDescription,
    EmptyStateTitle,
    Label,
    LoadingState,
    PendingButton,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    useWorkflows,
} from '@teamsuzie/ui';
import type { MatterDocument } from '../hooks/use-matter.js';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    documents: MatterDocument[];
    onCreate: (input: {
        workflowId: string;
        externalDocIds: string[];
    }) => Promise<unknown>;
}

/**
 * Dialog that creates a new grid review on a matter from an existing
 * workflow + a selected subset of the matter's documents. Filters
 * workflows to those with a `columnConfig` (the only ones that have
 * any columns to seed the review with).
 */
export function FromWorkflowDialog({
    open,
    onOpenChange,
    documents,
    onCreate,
}: Props) {
    const { workflows, loading: wfLoading, error: wfError } = useWorkflows();
    const [workflowId, setWorkflowId] = useState<string>('');
    const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const candidateWorkflows = useMemo(
        () =>
            workflows.filter(
                (w) =>
                    Array.isArray(w.columnConfig) &&
                    (w.columnConfig?.length ?? 0) > 0,
            ),
        [workflows],
    );

    useEffect(() => {
        if (!open) return;
        setSelectedDocIds(new Set());
        setError(null);
        setWorkflowId((current) => {
            if (current && candidateWorkflows.some((w) => w.id === current)) {
                return current;
            }
            return candidateWorkflows[0]?.id ?? '';
        });
    }, [open, candidateWorkflows]);

    function toggleDoc(externalDocId: string) {
        setSelectedDocIds((current) => {
            const next = new Set(current);
            if (next.has(externalDocId)) next.delete(externalDocId);
            else next.add(externalDocId);
            return next;
        });
    }

    async function handleSubmit() {
        if (!workflowId) {
            setError('Pick a workflow first.');
            return;
        }
        if (selectedDocIds.size === 0) {
            setError('Select at least one document.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await onCreate({
                workflowId,
                externalDocIds: Array.from(selectedDocIds),
            });
            onOpenChange(false);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Failed to create review',
            );
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>New review from workflow</DialogTitle>
                    <DialogDescription>
                        Pre-populate a grid review using a workflow's columns +
                        the documents you select.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="from-wf-workflow">Workflow</Label>
                        {wfLoading ? (
                            <LoadingState>Loading workflows…</LoadingState>
                        ) : wfError ? (
                            <p className="text-xs text-destructive">{wfError}</p>
                        ) : candidateWorkflows.length === 0 ? (
                            <EmptyState>
                                <EmptyStateTitle>
                                    No tabular workflows yet
                                </EmptyStateTitle>
                                <EmptyStateDescription>
                                    Create a workflow with a column configuration
                                    in the Library first, then come back here.
                                </EmptyStateDescription>
                            </EmptyState>
                        ) : (
                            <Select
                                value={workflowId}
                                onValueChange={setWorkflowId}
                                disabled={submitting}
                            >
                                <SelectTrigger id="from-wf-workflow">
                                    <SelectValue placeholder="Pick a workflow…" />
                                </SelectTrigger>
                                <SelectContent>
                                    {candidateWorkflows.map((w) => (
                                        <SelectItem key={w.id} value={w.id}>
                                            {w.name}
                                            {w.source === 'system'
                                                ? ' · system'
                                                : ''}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex items-baseline justify-between">
                            <Label>Documents</Label>
                            <span className="text-xs text-muted-foreground">
                                {selectedDocIds.size} selected
                            </span>
                        </div>
                        {documents.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                                Upload documents to this matter first — you'll
                                need at least one row to start a review.
                            </p>
                        ) : (
                            <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
                                {documents.map((d) => {
                                    const checked = selectedDocIds.has(
                                        d.externalDocId,
                                    );
                                    return (
                                        <li
                                            key={d.id}
                                            className="flex items-center gap-3 px-3 py-2 hover:bg-accent/40"
                                        >
                                            <Checkbox
                                                id={`from-wf-doc-${d.id}`}
                                                checked={checked}
                                                onChange={() =>
                                                    toggleDoc(d.externalDocId)
                                                }
                                            />
                                            <label
                                                htmlFor={`from-wf-doc-${d.id}`}
                                                className="flex-1 min-w-0 cursor-pointer"
                                            >
                                                <p className="truncate text-sm font-medium">
                                                    {d.name}
                                                </p>
                                                <p className="truncate text-xs text-muted-foreground">
                                                    {d.mimeType ?? 'unknown'}
                                                </p>
                                            </label>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    {error && <p className="text-xs text-destructive">{error}</p>}
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
                        pendingLabel="Creating"
                        disabled={
                            candidateWorkflows.length === 0 ||
                            documents.length === 0
                        }
                    >
                        Create review
                    </PendingButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
