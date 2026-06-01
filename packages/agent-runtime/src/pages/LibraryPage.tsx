import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AiFillButton,
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
  Textarea,
  cn,
  useConfirm,
  usePagination,
  useWorkflows,
  type Workflow,
} from '@teamsuzie/ui';

/**
 * Library — real workflow CRUD backed by `@teamsuzie/workflows`. The
 * starter ships three system workflows (explain / summarize / checklist)
 * and lets the user add their own. Selecting a workflow drops its prompt
 * into the assistant composer and pops the user over to the Assistant
 * tab.
 *
 * All prompt data — both the manifest-seeded starter set and user-created
 * rows — flows through `/api/workflows`. Manifest prompts are seeded into
 * the store on first boot (see `agent-runtime` server), so this page never
 * reads `manifest.prompts` directly.
 *
 * What the starter intentionally does NOT do (defer to downstream apps):
 *   - tabular-review workflows (need a matter/grid surface)
 *   - generate_docx output mode (needs the docx tool registered)
 *   - workflow history / archive UI
 *
 * To opt into those, see suzielaw's Library implementation.
 */
export function LibraryPage() {
  const wf = useWorkflows();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Practice-area filter: union all `practiceAreas` declared on workflows.
  // If no workflow declares any, we hide the filter UI and show the list
  // as-is. Filter is applied to the workflow list below.
  const allAreas = useMemo(() => {
    const set = new Set<string>();
    for (const w of wf.workflows) for (const a of w.practiceAreas ?? []) set.add(a);
    return Array.from(set).sort();
  }, [wf.workflows]);

  const [activeArea, setActiveArea] = useState<string | null>(null);

  const visibleWorkflows = useMemo(() => {
    if (!activeArea) return wf.workflows;
    return wf.workflows.filter((w) => w.practiceAreas?.includes(activeArea));
  }, [wf.workflows, activeArea]);

  // Paginate the filtered list. usePagination resets to page 1 on length
  // change, so switching the practice-area filter rewinds cleanly.
  const pager = usePagination(visibleWorkflows, { defaultPageSize: 25 });

  function runWorkflow(w: Workflow) {
    // Stash the workflow's prompt + name in sessionStorage; the assistant
    // page picks it up on mount and prefills the composer. Cheaper than
    // a global store and survives the route change.
    sessionStorage.setItem(
      'counsel:pending-workflow',
      JSON.stringify({ id: w.id, name: w.name, prompt: w.prompt }),
    );
    // forceNewChat bypasses AssistantRootRoute's auto-redirect to the last
    // chat (/c/<latest>). Without it, AssistantPage mounts with chatId and
    // ChatThread owns the composer — the bareInput prefill silently never
    // appears. We want a fresh bare-route composer so the prompt shows up.
    navigate('/', { state: { forceNewChat: true } });
  }

  async function handleCreate(form: { name: string; description: string; prompt: string }) {
    setCreateBusy(true);
    setCreateError(null);
    try {
      await wf.create({
        name: form.name.trim(),
        description: form.description.trim(),
        prompt: form.prompt,
      });
      setCreating(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleDelete(workflow: Workflow) {
    const ok = await confirm({
      title: `Delete "${workflow.name}"?`,
      description:
        "This removes the workflow from your library. System workflows can't be deleted — only your own.",
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    await wf.remove(workflow.id);
  }

  return (
    <>
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Library</PageHeaderTitle>
          <PageHeaderDescription>
            Saved prompts and workflows. Click one to drop it into the assistant composer.
          </PageHeaderDescription>
        </PageHeaderContent>
        <Button onClick={() => setCreating(true)}>New workflow</Button>
      </PageHeader>

      <div className="mx-auto w-full max-w-4xl px-6 pb-12 pt-6">
        {wf.error && (
          <div className="mb-4 rounded-[2px] border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
            {wf.error}
          </div>
        )}

        {allAreas.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5" data-testid="practice-area-filter">
            <button
              type="button"
              onClick={() => setActiveArea(null)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                activeArea === null
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              All
            </button>
            {allAreas.map((area) => (
              <button
                key={area}
                type="button"
                onClick={() => setActiveArea(area)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  activeArea === area
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {area}
              </button>
            ))}
          </div>
        )}

        {wf.loading ? (
          <LoadingState>Loading workflows…</LoadingState>
        ) : wf.workflows.length === 0 ? (
          <EmptyState>
            <EmptyStateTitle>No workflows yet</EmptyStateTitle>
            <EmptyStateDescription>
              Save a prompt as a workflow and re-use it from the assistant composer.
            </EmptyStateDescription>
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pager.pageItems.map((w) => (
              <li
                key={w.id}
                className="group flex flex-col gap-2 border border-border bg-card p-4 transition-colors hover:border-foreground/40 hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => runWorkflow(w)}
                    className="block flex-1 text-left"
                  >
                    <h3 className="text-[15px] font-semibold tracking-[-0.005em] text-foreground">
                      {w.name}
                    </h3>
                    {w.description && (
                      <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">
                        {w.description}
                      </p>
                    )}
                  </button>
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {w.source}
                  </span>
                </div>
                {w.source === 'user' && (
                  <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => void handleDelete(w)}
                      className="text-[10.5px] font-mono uppercase tracking-[0.06em] text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${w.name}`}
                    >
                      delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {!wf.loading && visibleWorkflows.length > pager.pageSize && (
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

      <CreateWorkflowDialog
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

interface CreateWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: { name: string; description: string; prompt: string }) => void;
  busy: boolean;
  error: string | null;
}

function CreateWorkflowDialog({ open, onOpenChange, onSubmit, busy, error }: CreateWorkflowDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');

  function reset() { setName(''); setDescription(''); setPrompt(''); }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New workflow</DialogTitle>
          <DialogDescription>
            A workflow is a saved prompt you can drop into the assistant composer with one click.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !prompt.trim() || busy) return;
            onSubmit({ name, description, prompt });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="wf-name">Name</Label>
            <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wf-desc">Description (optional)</Label>
            <Input id="wf-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="wf-prompt">Prompt</Label>
              <AiFillButton
                kind="prompt-body"
                context={{ title: name, description }}
                onFill={(text: string) => setPrompt(text)}
                disabled={!name.trim()}
              />
            </div>
            <Textarea
              id="wf-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              required
              placeholder="The prompt body. Square-bracket placeholders like [paste here] help the user know what to fill in."
            />
          </div>
          {error && <p className="text-[12px] text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !name.trim() || !prompt.trim()}>
              {busy ? 'Saving…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
