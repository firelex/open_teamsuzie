import * as React from 'react'
import { Check, ExternalLink, Undo2, X } from 'lucide-react'
import { diffWords } from '@teamsuzie/docx-diff'
import { Button } from '../button'
import { cn } from '../../lib/utils'
import { useSidePanel } from '../side-panel'
import { RedlineSpan } from './redline-span'
import { RedlinePanelContent } from './redline-panel-content'
import type { RedlineParagraph } from './redline-runs'
import type {
  FocusCardEventDetail,
  FocusRevisionEventDetail,
} from './redline-panel-content'

/**
 * Tracked-changes cards + redline side-panel sync. Renders one
 * `<TrackedChangeCard>` per applied edit returned by
 * `propose_document_edits`. Each card has Accept / Reject buttons backed
 * by an optimistic round-trip to the host-provided `onResolve` callback;
 * on failure the card flips back to pending and surfaces the error
 * inline.
 *
 * Cross-component sync uses two `window` CustomEvents:
 *
 *   - `redline:focus-card` { detail: { key } } — fired by inline ins/del
 *     runs in the side panel. Scrolls + ring-flashes the matching card.
 *   - `redline:focus-revision` { detail: { revisionId } } — fired when a
 *     card is clicked. The side panel listens and scrolls to the first
 *     inline run with that revision id.
 *
 * The `key` is `${chatId}:${editIndex}` so multiple panels in different
 * chats coexist without collisions.
 *
 * Requires a `<SidePanelProvider>` ancestor — `useSidePanel()` throws
 * otherwise.
 */

export interface AppliedEdit {
  index: number
  find: string
  replace: string
  context_before: string
  context_after: string
  reason?: string
  revision_ids: number[]
  paragraph_index: number
}

/**
 * Client-side shape of the `propose_document_edits` result.
 *
 * The server-side `ProposeEditsResult` (exported from `@teamsuzie/docx`)
 * carries `bytes` + `suggested_filename` because the tool produces an
 * in-memory .docx. The client-side shape — what flows over the wire to
 * the chat — instead carries `download_url`, `download_file_id`,
 * `download_session_id`, `download_filename`. The app's tool-result
 * wrapper is responsible for the conversion (upload bytes, return
 * download metadata).
 *
 * These shapes intentionally diverge; don't try to share the type.
 */
export interface ProposeEditsResult {
  applied_count: number
  total: number
  errors: Array<{
    index: number
    status: string
    reason?: string
    find: string
    replace: string
    original_reason?: string
  }>
  applied_edits?: AppliedEdit[]
  download_url: string
  download_file_id: string
  download_session_id: string
  download_filename: string
  version_id?: string
  summary: string
}

export interface ResolveResponse {
  ok: boolean
  accepted: number[]
  rejected: number[]
  changed: number
  version_id?: string
  /**
   * Optional inlined paragraphs in upstream naming. When present the
   * side panel uses them directly instead of refetching.
   */
  paragraphs?: RedlineParagraph[]
}

type CardStatus =
  | 'pending'
  | 'accepting'
  | 'accepted'
  | 'rejecting'
  | 'rejected'

interface CardState {
  status: CardStatus
  error: string | null
}

export type { FocusCardEventDetail, FocusRevisionEventDetail }

export interface TrackedChangesPanelProps {
  result: ProposeEditsResult
  /** Namespace prefix for focus-event keys; must be stable across renders. */
  chatId: string
  /**
   * Resolves an accept/reject by hitting the host's revisions
   * endpoint. Must return the upstream `ResolveResponse` shape (with
   * `paragraphs` in `'equal' | 'insert' | 'delete'` naming) or throw.
   * Any kind-normalization happens in this adapter, not inside the
   * component.
   */
  onResolve: (
    sessionId: string,
    fileId: string,
    body: { accept?: number[]; reject?: number[] },
  ) => Promise<ResolveResponse>
  /**
   * Fetches the redline view for the side panel. Receives session +
   * file ids. Returns paragraphs in upstream naming.
   */
  onLoadRedline: (
    sessionId: string,
    fileId: string,
    signal?: AbortSignal,
  ) => Promise<{ paragraphs: RedlineParagraph[] }>
  /** Optional download URL passed through to the side-panel header. */
  downloadHref?: string
}

export function TrackedChangesPanel({
  result,
  chatId,
  onResolve,
  onLoadRedline,
  downloadHref,
}: TrackedChangesPanelProps) {
  const sidePanel = useSidePanel()
  const applied = result.applied_edits ?? []
  const autoOpenedRef = React.useRef(false)

  const [cards, setCards] = React.useState<Record<number, CardState>>(() => {
    const init: Record<number, CardState> = {}
    for (const e of applied) init[e.index] = { status: 'pending', error: null }
    return init
  })

  const sessionId = result.download_session_id
  const fileId = result.download_file_id
  const fileName = result.download_filename
  const revisionCardKeys = React.useMemo(() => {
    const out: Record<number, string> = {}
    for (const edit of applied) {
      const key = `${chatId}:${edit.index}`
      for (const revisionId of edit.revision_ids) out[revisionId] = key
    }
    return out
  }, [applied, chatId])

  const openRedlineTab = React.useCallback(
    (focusRevisionId?: number) => {
      const tabId = `redline:${sessionId}:${fileId}`
      sidePanel.openTab({
        id: tabId,
        title: fileName,
        render: () => (
          <RedlinePanelContent
            sessionId={sessionId}
            fileId={fileId}
            fileName={fileName}
            chatId={chatId}
            revisionCardKeys={revisionCardKeys}
            onLoadRedline={onLoadRedline}
            downloadHref={downloadHref}
          />
        ),
      })
      if (focusRevisionId !== undefined) {
        // Defer the focus event so the panel has time to mount + fetch.
        // The panel re-fires the focus on mount-load too — this is a
        // best-effort second nudge for the "already mounted" path.
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent<FocusRevisionEventDetail>(
              'redline:focus-revision',
              { detail: { revisionId: focusRevisionId } },
            ),
          )
        }, 50)
      }
    },
    [
      sidePanel,
      sessionId,
      fileId,
      fileName,
      chatId,
      revisionCardKeys,
      onLoadRedline,
      downloadHref,
    ],
  )

  React.useEffect(() => {
    if (autoOpenedRef.current || applied.length === 0) return
    autoOpenedRef.current = true
    openRedlineTab()
  }, [applied.length, openRedlineTab])

  async function resolve(
    edit: AppliedEdit,
    action: 'accept' | 'reject',
  ): Promise<void> {
    const prev = cards[edit.index]
    setCards((s) => ({
      ...s,
      [edit.index]: {
        status: action === 'accept' ? 'accepting' : 'rejecting',
        error: null,
      },
    }))
    try {
      const body =
        action === 'accept'
          ? { accept: edit.revision_ids }
          : { reject: edit.revision_ids }
      const resolved = await onResolve(sessionId, fileId, body)
      setCards((s) => ({
        ...s,
        [edit.index]: {
          status: action === 'accept' ? 'accepted' : 'rejected',
          error: null,
        },
      }))
      // Tell any open redline panel to refresh — the saved bytes have changed.
      window.dispatchEvent(
        new CustomEvent('redline:refresh', {
          detail: { sessionId, fileId, paragraphs: resolved.paragraphs },
        }),
      )
    } catch (err) {
      setCards((s) => ({
        ...s,
        [edit.index]: {
          ...prev,
          status: 'pending',
          error: err instanceof Error ? err.message : 'Resolve failed',
        },
      }))
    }
  }

  if (applied.length === 0) {
    // Tool ran but no edits applied (all errors). Surface a summary so
    // the user isn't left wondering — the model usually narrates this
    // anyway, but the cards panel should at least say "nothing to show".
    if (result.errors.length > 0) {
      return (
        <div className="my-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {result.summary}
        </div>
      )
    }
    return null
  }

  return (
    <div className="my-3 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {applied.length} proposed edit{applied.length === 1 ? '' : 's'} ·
          accept or reject in-app, or open in Word
        </span>
        <button
          type="button"
          onClick={() => openRedlineTab()}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-accent/40"
        >
          <ExternalLink className="size-3" aria-hidden />
          View redline
        </button>
      </div>
      {applied.map((edit) => (
        <TrackedChangeCard
          key={edit.index}
          edit={edit}
          state={cards[edit.index] ?? { status: 'pending', error: null }}
          cardKey={`${chatId}:${edit.index}`}
          onAccept={() => void resolve(edit, 'accept')}
          onReject={() => void resolve(edit, 'reject')}
          onView={() => openRedlineTab(edit.revision_ids[0])}
        />
      ))}
    </div>
  )
}

function TrackedChangeCard({
  edit,
  state,
  cardKey,
  onAccept,
  onReject,
  onView,
}: {
  edit: AppliedEdit
  state: CardState
  cardKey: string
  onAccept: () => void
  onReject: () => void
  onView: () => void
}) {
  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const [flashing, setFlashing] = React.useState(false)

  // Listen for focus events targeting this card key.
  React.useEffect(() => {
    function onFocus(ev: Event) {
      const ce = ev as CustomEvent<FocusCardEventDetail>
      if (ce.detail?.key !== cardKey) return
      cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setFlashing(true)
      window.setTimeout(() => setFlashing(false), 1200)
    }
    window.addEventListener('redline:focus-card', onFocus as EventListener)
    return () =>
      window.removeEventListener(
        'redline:focus-card',
        onFocus as EventListener,
      )
  }, [cardKey])

  const busy = state.status === 'accepting' || state.status === 'rejecting'
  const resolved = state.status === 'accepted' || state.status === 'rejected'
  const previewOps = React.useMemo(
    () => diffWords(edit.find, edit.replace),
    [edit.find, edit.replace],
  )

  return (
    <div
      ref={cardRef}
      data-card-key={cardKey}
      className={cn(
        'rounded-lg border bg-card p-3 text-sm transition-shadow',
        state.status === 'accepted' && 'border-emerald-500/40 bg-emerald-500/5',
        state.status === 'rejected' &&
          'border-destructive/30 bg-destructive/5 opacity-70',
        flashing && 'ring-2 ring-amber-400/60',
      )}
    >
      {edit.reason && (
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">
          {edit.reason}
        </div>
      )}
      <div className="leading-relaxed">
        {previewOps.map((op, index) => (
          <RedlineSpan key={index} kind={op.kind} text={op.text} />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={onView}
          >
            <ExternalLink className="size-3" aria-hidden />
            In document
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          {state.status === 'accepted' ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <Check className="size-3" aria-hidden /> Accepted
            </span>
          ) : state.status === 'rejected' ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
              <Undo2 className="size-3" aria-hidden /> Rejected
            </span>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                disabled={busy}
                onClick={onReject}
              >
                <X className="size-3" aria-hidden />
                Reject
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                disabled={busy}
                onClick={onAccept}
              >
                <Check className="size-3" aria-hidden />
                Accept
              </Button>
            </>
          )}
        </div>
      </div>
      {state.error && (
        <p className="mt-1.5 text-xs text-destructive">{state.error}</p>
      )}
      {resolved && !state.error && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Re-download the .docx to get the updated file.
        </p>
      )}
    </div>
  )
}

export function appliedEditsKey(chatId: string, editIndex: number): string {
  return `${chatId}:${editIndex}`
}
