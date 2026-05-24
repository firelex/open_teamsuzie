import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog.js"
import { Input } from "./input.js"
import { EmptyState, EmptyStateDescription, EmptyStateTitle } from "./empty-state.js"
import { LoadingState } from "./loading-state.js"
import { cn } from "../lib/utils.js"
import { useWorkflows, type Workflow } from "../hooks/use-workflows.js"

export interface WorkflowPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Fired when the user picks a workflow. The typical host behaviour is:
   *   - prefill the chat composer with `workflow.prompt`
   *   - stash `workflow.id` to send on the next /api/chat turn so the
   *     server can route by `output_mode`
   */
  onSelect: (workflow: Workflow) => void
  /**
   * Filter the list before search. Default behaviour excludes
   * `tabular_review` workflows because they launch into a review grid,
   * not into a chat — running one inside a chat has no useful semantics.
   * Override when hosting in a surface that handles all output modes.
   */
  filter?: (workflow: Workflow) => boolean
  /**
   * Optional badge renderer, shown at the right edge of each row. Returns
   * `null` to skip. Defaults to a small uppercase tag based on `outputMode`.
   */
  renderBadge?: (workflow: Workflow) => ReactNode
  /**
   * Optional renderer for the per-workflow tag row (e.g. SuzieLaw's
   * practice-area chips). Returns `null` to hide.
   */
  renderTags?: (workflow: Workflow) => ReactNode
  /** Dialog title. */
  title?: string
  /** Dialog description. */
  description?: string
  /** Optional override for the empty-state copy when the library is empty. */
  emptyLibraryDescription?: ReactNode
}

const DEFAULT_OUTPUT_MODE_BADGE: Record<Workflow["outputMode"], string> = {
  inline_chat: "Chat",
  generate_docx: "Word doc",
  tabular_review: "Review",
}

function defaultBadge(workflow: Workflow): ReactNode {
  const label = DEFAULT_OUTPUT_MODE_BADGE[workflow.outputMode]
  return (
    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
  )
}

const DEFAULT_FILTER = (w: Workflow): boolean => w.outputMode !== "tabular_review"

/**
 * Generic workflow picker. Mounts cleanly inside any chat surface that
 * wants to let the user prefill the composer from a saved workflow.
 * No legal-specific assumptions — practice-area labelling and review
 * filtering are opt-in via the `renderTags` and `filter` props.
 *
 * Pairs with `useWorkflows()` (from `@teamsuzie/ui`) — the hook drives
 * the list; this component only handles rendering and selection. Hosts
 * that need their own list source can wrap and pass a `filter` to
 * narrow what the picker shows.
 */
export function WorkflowPickerDialog({
  open,
  onOpenChange,
  onSelect,
  filter,
  renderBadge,
  renderTags,
  title = "Run a workflow",
  description = "Pick a workflow to fill in the chat input.",
  emptyLibraryDescription,
}: WorkflowPickerDialogProps) {
  const wf = useWorkflows()
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      setQuery("")
      const id = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(id)
    }
  }, [open])

  const eligible = useMemo(() => {
    const f = filter ?? DEFAULT_FILTER
    return wf.workflows.filter(f)
  }, [wf.workflows, filter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return eligible
    return eligible.filter((w) => {
      const haystack = `${w.name}\n${w.description}\n${w.practiceAreas.join(" ")}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [eligible, query])

  function handlePick(workflow: Workflow) {
    onSelect(workflow)
    onOpenChange(false)
  }

  const badgeFn = renderBadge ?? defaultBadge

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workflows"
            aria-label="Search workflows"
          />

          {wf.loading ? (
            <LoadingState>Loading workflows…</LoadingState>
          ) : filtered.length === 0 ? (
            <EmptyState>
              <EmptyStateTitle>
                {eligible.length === 0
                  ? "No workflows in your library"
                  : "No workflows match"}
              </EmptyStateTitle>
              <EmptyStateDescription>
                {eligible.length === 0
                  ? emptyLibraryDescription ?? "Create one from the Library to get started."
                  : "Try a different search term."}
              </EmptyStateDescription>
            </EmptyState>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto rounded-md border border-border">
              {filtered.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => handlePick(w)}
                    className={cn(
                      "flex w-full flex-col gap-1 border-b border-border px-3 py-2.5 text-left text-sm last:border-b-0",
                      "hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{w.name}</span>
                      {badgeFn(w)}
                    </div>
                    {w.description && (
                      <p className="text-xs text-muted-foreground">{w.description}</p>
                    )}
                    {renderTags?.(w)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
