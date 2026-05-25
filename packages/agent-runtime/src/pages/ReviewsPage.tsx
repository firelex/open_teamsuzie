import { useCallback, useEffect, useState } from 'react';
import type { CellFormat, ReviewColumn, ReviewTemplate } from '@teamsuzie/reviews';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  Input,
  Label,
  LoadingState,
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
  Pagination,
  PaginationInfo,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  Trash2,
  useConfirm,
  usePagination,
} from '@teamsuzie/ui';

/**
 * Reviews — template list + new-template form, backed by `@teamsuzie/reviews`.
 *
 * Templates are named column sets the user can later instantiate as a tabular
 * review (rows × cells). The starter ships the template-management surface
 * only; the tabular review editor (rows × cells with AI column drafting) is
 * deferred to a follow-up task — it carries enough surface area to warrant
 * its own page + grid component.
 *
 * Templates come from two sources:
 *   - `source: 'system'` — seeded from code; read-only.
 *   - `source: 'user'`   — created in the UI (or seeded once via
 *                          `manifest.reviews.templates[]`); editable + deletable
 *                          by their owner.
 */
interface ListResponse { items: ReviewTemplate[] }
interface ItemResponse { item: ReviewTemplate }

const FORMAT_OPTIONS: CellFormat[] = [
  'text',
  'number',
  'boolean',
  'date',
  'tags',
  'currency',
];

export function ReviewsPage() {
  const confirm = useConfirm();
  const [templates, setTemplates] = useState<ReviewTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/reviews/templates');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ListResponse;
      setTemplates(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const pager = usePagination(templates, { defaultPageSize: 25 });

  async function handleCreate(form: {
    name: string;
    description: string;
    columns: ReviewColumn[];
  }) {
    setCreateBusy(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/reviews/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          columns: form.columns,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ItemResponse;
      setTemplates((prev) => [...prev, data.item].sort(byNameAsc));
      setCreating(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleDelete(template: ReviewTemplate) {
    const ok = await confirm({
      title: `Delete "${template.name}"?`,
      description:
        "This removes the template from your library. System templates can't be deleted — only your own.",
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/reviews/templates/${encodeURIComponent(template.id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <>
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Reviews</PageHeaderTitle>
          <PageHeaderDescription>
            Named column templates for tabular reviews. Add your own or use the
            ones shipped with this agent.
          </PageHeaderDescription>
        </PageHeaderContent>
        <Button onClick={() => setCreating(true)}>New review template</Button>
      </PageHeader>

      <div className="mx-auto w-full max-w-4xl px-6 pb-12 pt-6">
        {error && (
          <div className="mb-4 rounded-[2px] border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <LoadingState>Loading templates…</LoadingState>
        ) : templates.length === 0 ? (
          <EmptyState>
            <EmptyStateTitle>No review templates yet</EmptyStateTitle>
            <EmptyStateDescription>
              A template is a named column set you can later use as a tabular
              review (rows × cells).
            </EmptyStateDescription>
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pager.pageItems.map((t) => (
              <li
                key={t.id}
                className="group flex flex-col gap-2 border border-border bg-card p-4 transition-colors hover:border-foreground/40 hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <h3 className="text-[15px] font-semibold tracking-[-0.005em] text-foreground">
                      {t.name}
                    </h3>
                    {t.description && (
                      <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">
                        {t.description}
                      </p>
                    )}
                    {t.columns.length > 0 && (
                      <p className="mt-2 text-[11.5px] text-muted-foreground">
                        {t.columns.length} column{t.columns.length === 1 ? '' : 's'}: {' '}
                        <span className="text-foreground/80">
                          {t.columns.map((c) => c.title).join(', ')}
                        </span>
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t.source}
                  </span>
                </div>
                {t.source === 'user' && (
                  <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => void handleDelete(t)}
                      className="inline-flex items-center gap-1 text-[10.5px] font-mono uppercase tracking-[0.06em] text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${t.name}`}
                    >
                      <Trash2 className="size-3" /> delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {!loading && templates.length > pager.pageSize && (
          <div className="mt-6 flex items-center justify-between">
            <PaginationInfo
              currentPage={pager.page}
              pageSize={pager.pageSize}
              totalItems={pager.totalItems}
            />
            <Pagination
              currentPage={pager.page}
              totalPages={pager.totalPages}
              onPageChange={pager.setPage}
            />
          </div>
        )}
      </div>

      <CreateTemplateDialog
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open) setCreateError(null);
        }}
        onSubmit={handleCreate}
        busy={createBusy}
        error={createError}
      />
    </>
  );
}

function byNameAsc(a: ReviewTemplate, b: ReviewTemplate): number {
  // Match the server's `source, name COLLATE NOCASE` ordering: system first.
  if (a.source !== b.source) return a.source === 'system' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

interface CreateTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: {
    name: string;
    description: string;
    columns: ReviewColumn[];
  }) => void;
  busy: boolean;
  error: string | null;
}

interface DraftColumn extends ReviewColumn { uid: number }

let nextDraftUid = 1;
function makeDraftColumn(): DraftColumn {
  return { uid: nextDraftUid++, id: '', title: '', prompt: '', format: 'text' };
}

function CreateTemplateDialog({
  open,
  onOpenChange,
  onSubmit,
  busy,
  error,
}: CreateTemplateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [columns, setColumns] = useState<DraftColumn[]>(() => [makeDraftColumn()]);

  function reset() {
    setName('');
    setDescription('');
    setColumns([makeDraftColumn()]);
  }

  function updateColumn(uid: number, patch: Partial<ReviewColumn>) {
    setColumns((prev) => prev.map((c) => (c.uid === uid ? { ...c, ...patch } : c)));
  }
  function removeColumn(uid: number) {
    setColumns((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.uid !== uid)));
  }
  function addColumn() {
    setColumns((prev) => [...prev, makeDraftColumn()]);
  }

  const validColumns = columns
    .map((c) => ({
      id: (c.id || slugify(c.title)).trim(),
      title: c.title.trim(),
      prompt: c.prompt.trim(),
      format: c.format,
    }))
    .filter((c) => c.id && c.title);

  const canSubmit = !busy && name.trim().length > 0 && validColumns.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New review template</DialogTitle>
          <DialogDescription>
            A template is a named column set. Each column gets a title, an
            instruction the model uses to populate cells, and a cell format hint.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            onSubmit({ name, description, columns: validColumns });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="rt-name">Name</Label>
            <Input
              id="rt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rt-desc">Description (optional)</Label>
            <Input
              id="rt-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Columns</Label>
              <Button type="button" variant="outline" size="sm" onClick={addColumn}>
                Add column
              </Button>
            </div>
            <ul className="space-y-3">
              {columns.map((c, idx) => (
                <li key={c.uid} className="space-y-2 border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                      Column {idx + 1}
                    </span>
                    {columns.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeColumn(c.uid)}
                        className="text-[10.5px] font-mono uppercase tracking-[0.06em] text-muted-foreground hover:text-destructive"
                        aria-label={`Remove column ${idx + 1}`}
                      >
                        remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr]">
                    <div className="space-y-1">
                      <Label htmlFor={`col-title-${c.uid}`} className="text-[11px]">
                        Title
                      </Label>
                      <Input
                        id={`col-title-${c.uid}`}
                        value={c.title}
                        onChange={(e) => updateColumn(c.uid, { title: e.target.value })}
                        placeholder="e.g. Parties"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`col-format-${c.uid}`} className="text-[11px]">
                        Format
                      </Label>
                      <Select
                        value={c.format}
                        onValueChange={(v) => updateColumn(c.uid, { format: v as CellFormat })}
                      >
                        <SelectTrigger id={`col-format-${c.uid}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FORMAT_OPTIONS.map((f) => (
                            <SelectItem key={f} value={f}>{f}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`col-prompt-${c.uid}`} className="text-[11px]">
                      Prompt
                    </Label>
                    <Textarea
                      id={`col-prompt-${c.uid}`}
                      value={c.prompt}
                      onChange={(e) => updateColumn(c.uid, { prompt: e.target.value })}
                      rows={2}
                      placeholder="What the model should extract or summarize for this column."
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {error && <p className="text-[12px] text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? 'Saving…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
