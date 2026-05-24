import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Textarea,
  cn,
  useWorkflows,
  type Workflow,
} from '@teamsuzie/ui';
import type { ManifestPrompt } from '../manifest/schema.js';

/**
 * Library — real workflow CRUD backed by `@teamsuzie/workflows`. The
 * starter ships three system workflows (explain / summarize / checklist)
 * and lets the user add their own. Selecting a workflow drops its prompt
 * into the assistant composer and pops the user over to the Assistant
 * tab.
 *
 * What the starter intentionally does NOT do (defer to downstream apps):
 *   - practice-area filtering (legal-domain)
 *   - tabular-review workflows (need a matter/grid surface)
 *   - generate_docx output mode (needs the docx tool registered)
 *   - workflow history / archive UI
 *
 * To opt into those, see suzielaw's Library implementation.
 */
export interface LibraryPageProps {
  /** Optional manifest-driven starter prompts shown above the workflows list. */
  prompts?: ManifestPrompt[];
}

export function LibraryPage({ prompts }: LibraryPageProps = {}) {
  const wf = useWorkflows();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Workflow | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Practice-area filter: union all `practiceAreas` declared on prompts. If no
  // prompt declares any, we hide the filter UI and show prompts as-is. This
  // keeps the library generic — a preset that doesn't carry legal taxonomy
  // pays no UI cost.
  const allAreas = useMemo(() => {
    if (!prompts) return [] as string[];
    const set = new Set<string>();
    for (const p of prompts) for (const a of p.practiceAreas ?? []) set.add(a);
    return Array.from(set).sort();
  }, [prompts]);

  const [activeArea, setActiveArea] = useState<string | null>(null);

  const visiblePrompts = useMemo(() => {
    if (!prompts) return [];
    if (!activeArea) return prompts;
    return prompts.filter((p) => p.practiceAreas?.includes(activeArea));
  }, [prompts, activeArea]);

  function runWorkflow(w: Workflow) {
    // Stash the workflow's prompt + name in sessionStorage; the assistant
    // page picks it up on mount and prefills the composer. Cheaper than
    // a global store and survives the route change.
    sessionStorage.setItem(
      'counsel:pending-workflow',
      JSON.stringify({ id: w.id, name: w.name, prompt: w.prompt }),
    );
    navigate('/');
  }

  function runPrompt(p: ManifestPrompt) {
    // Mirror the workflow hand-off: stash the prompt body in sessionStorage,
    // navigate back to the assistant which picks it up on mount and prefills
    // the composer. Prompts don't have an id like workflows do.
    sessionStorage.setItem(
      'counsel:pending-prompt',
      JSON.stringify({ name: p.title, prompt: p.prompt ?? '' }),
    );
    navigate('/');
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

  async function handleDelete() {
    if (!pendingDelete) return;
    try {
      await wf.remove(pendingDelete.id);
    } finally {
      setPendingDelete(null);
    }
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

        {prompts && prompts.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
              Prompts
            </h2>
            {allAreas.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5" data-testid="practice-area-filter">
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
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {visiblePrompts.map((p) => (
                <li
                  key={p.title}
                  className="flex flex-col gap-2 border border-border bg-card p-4 transition-colors hover:border-foreground/40 hover:bg-muted/30"
                >
                  <button
                    type="button"
                    onClick={() => runPrompt(p)}
                    className="block flex-1 text-left"
                  >
                    <h3 className="text-[15px] font-semibold tracking-[-0.005em] text-foreground">
                      {p.title}
                    </h3>
                    <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">
                      {p.subtitle}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </section>
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
            {wf.workflows.map((w) => (
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
                      onClick={() => setPendingDelete(w)}
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

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Delete "${pendingDelete?.name ?? ''}"?`}</DialogTitle>
            <DialogDescription>
              This removes the workflow from your library. System workflows can't be deleted — only your own.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
            <Label htmlFor="wf-prompt">Prompt</Label>
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
