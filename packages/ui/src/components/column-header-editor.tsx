import * as React from "react"
import { Loader2, Sparkles } from "lucide-react"
import type { CellFormat, ColumnPreset } from "@teamsuzie/grid-review"

import { Button } from "./button"
import { Input } from "./input"
import { Label } from "./label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"
import { Textarea } from "./textarea"
import { useUiT } from "../lib/i18n.js"

export interface ColumnHeaderEditorValue {
  title: string
  prompt: string
  format: CellFormat
}

export interface ColumnHeaderEditorProps {
  /** Initial values. In `create` mode, typically all empty / default. */
  initial: ColumnHeaderEditorValue
  /**
   * Synchronous lookup — typically `(title) => registry.match(title)`.
   * When mode is `create` and a preset matches a title the user just
   * typed, the editor autofills `prompt` and `format` (only into fields
   * the user hasn't manually edited). Sync presets win over async drafts:
   * if `findPreset` returns a hit, `draftFromTitle` is not called for
   * that title.
   *
   * Pass `null` / omit to skip preset autofill.
   */
  findPreset?: ((title: string) => ColumnPreset | null) | null
  /**
   * Asynchronous starter — called on title blur in `create` mode when no
   * sync preset matched. Typical implementation calls a server endpoint
   * that asks the model to draft `{prompt, format}` from the title.
   *
   * Receives the current format selection (`formatHint`) so the model
   * can respect a deliberate user choice — e.g. user picks "bullets"
   * before typing the title, server renders that as a strong hint.
   * Whether the user manually picked it is conveyed by `formatDirty`.
   *
   * Same dirty-field rule applies: only fields the user hasn't
   * manually edited get filled. The `signal` is aborted if the user
   * blurs again with a different title before the response arrives.
   *
   * Pass `null` / omit to disable async drafting entirely.
   */
  draftFromTitle?:
    | ((args: {
        title: string
        formatHint: CellFormat
        formatDirty: boolean
        signal: AbortSignal
      }) => Promise<{ prompt: string; format: CellFormat } | null>)
    | null
  /**
   * `create`: title autofills prompt + format on preset match (until user
   *           manually edits those fields).
   * `edit`:   title changes do nothing — we don't want to clobber a
   *           column's existing prompt just because the title was tweaked.
   */
  mode?: "create" | "edit"
  onSubmit: (value: ColumnHeaderEditorValue) => Promise<void> | void
  onCancel?: () => void
  submitLabel?: string
  busy?: boolean
  error?: string | null
}

/**
 * Form for creating or editing a review column. In `create` mode, typing
 * a title that matches a preset autofills prompt + format — but only into
 * fields the user hasn't already edited (manual override sticks). In
 * `edit` mode, autofill is off so renaming a column doesn't clobber its
 * established prompt.
 */
export function ColumnHeaderEditor({
  initial,
  findPreset,
  draftFromTitle,
  mode = "create",
  onSubmit,
  onCancel,
  submitLabel,
  busy = false,
  error,
}: ColumnHeaderEditorProps) {
  const { t } = useUiT()
  const FORMAT_LABELS: { value: CellFormat; label: string }[] = [
    { value: "text", label: t('columnHeaderEditor.formatText') },
    { value: "short_text", label: t('columnHeaderEditor.formatShortText') },
    { value: "date", label: t('columnHeaderEditor.formatDate') },
    { value: "yes_no", label: t('columnHeaderEditor.formatYesNo') },
    { value: "bullets", label: t('columnHeaderEditor.formatBulletList') },
    { value: "money", label: t('columnHeaderEditor.formatMoney') },
  ]
  const [title, setTitle] = React.useState(initial.title)
  const [prompt, setPrompt] = React.useState(initial.prompt)
  const [format, setFormat] = React.useState<CellFormat>(initial.format)
  // Edit mode starts with both fields "dirty" so subsequent title changes
  // never overwrite the column's existing prompt/format.
  const [promptDirty, setPromptDirty] = React.useState(mode === "edit")
  const [formatDirty, setFormatDirty] = React.useState(mode === "edit")
  const [matchedPresetId, setMatchedPresetId] = React.useState<string | null>(null)
  const [drafting, setDrafting] = React.useState(false)
  const [draftedTitle, setDraftedTitle] = React.useState<string | null>(null)
  const [draftError, setDraftError] = React.useState<string | null>(null)
  const [localError, setLocalError] = React.useState<string | null>(null)

  const draftAbortRef = React.useRef<AbortController | null>(null)
  const lastDraftedRef = React.useRef<string>("")
  // Read inside async callbacks so we don't capture stale dirty values.
  const promptDirtyRef = React.useRef(promptDirty)
  const formatDirtyRef = React.useRef(formatDirty)
  React.useEffect(() => {
    promptDirtyRef.current = promptDirty
  }, [promptDirty])
  React.useEffect(() => {
    formatDirtyRef.current = formatDirty
  }, [formatDirty])

  // Cancel any in-flight draft when the editor unmounts.
  React.useEffect(() => {
    return () => draftAbortRef.current?.abort()
  }, [])

  const handleTitleChange = (next: string) => {
    setTitle(next)
    if (mode !== "create" || !findPreset) {
      setMatchedPresetId(null)
      return
    }
    const preset = findPreset(next)
    setMatchedPresetId(preset?.id ?? null)
    if (!preset) return
    if (!promptDirty) setPrompt(preset.prompt)
    if (!formatDirty) setFormat(preset.format)
  }

  const runDraft = async (opts: { force: boolean }) => {
    if (!draftFromTitle) return
    // Edit mode still allows force-drafting via the explicit AI button —
    // the on-blur path early-returns for edit so users don't accidentally
    // clobber an existing prompt.
    if (!opts.force && mode !== "create") return
    const titleValue = title.trim()
    if (!titleValue) return
    if (!opts.force) {
      // Sync preset already filled it — don't pay the network cost.
      if (matchedPresetId) return
      // Already drafted this exact title; skip.
      if (lastDraftedRef.current === titleValue) return
      // User has manually authored both fields; don't clobber.
      if (promptDirtyRef.current && formatDirtyRef.current) return
    }

    draftAbortRef.current?.abort()
    const ctrl = new AbortController()
    draftAbortRef.current = ctrl
    setDrafting(true)
    setDraftError(null)
    setDraftedTitle(null)
    try {
      const draft = await draftFromTitle({
        title: titleValue,
        formatHint: format,
        formatDirty: formatDirtyRef.current,
        signal: ctrl.signal,
      })
      if (ctrl.signal.aborted) return
      if (!draft) return
      lastDraftedRef.current = titleValue
      // Force mode unconditionally writes both fields — user clicked the
      // explicit button, so they're asking to replace.
      if (opts.force || !promptDirtyRef.current) {
        setPrompt(draft.prompt)
        setPromptDirty(false)
      }
      if (opts.force || !formatDirtyRef.current) {
        setFormat(draft.format)
        setFormatDirty(false)
      }
      setDraftedTitle(titleValue)
    } catch (err) {
      if (ctrl.signal.aborted) return
      // Aborts surface as DOMException("AbortError"); ignore those.
      if (err instanceof DOMException && err.name === "AbortError") return
      setDraftError(err instanceof Error ? err.message : t('columnHeaderEditor.draftFailed'))
    } finally {
      if (!ctrl.signal.aborted) setDrafting(false)
    }
  }

  const handleTitleBlur = () => runDraft({ force: false })

  const handlePromptChange = (next: string) => {
    setPrompt(next)
    if (!promptDirty) setPromptDirty(true)
  }

  const handleFormatChange = (next: CellFormat) => {
    setFormat(next)
    if (!formatDirty) setFormatDirty(true)
  }

  const submit = async () => {
    const titleValue = title.trim()
    const p = prompt.trim()
    if (!titleValue) {
      setLocalError(t('columnHeaderEditor.titleRequired'))
      return
    }
    if (!p) {
      setLocalError(t('columnHeaderEditor.promptRequired'))
      return
    }
    setLocalError(null)
    await onSubmit({ title: titleValue, prompt: p, format })
  }

  const submitText =
    submitLabel ?? (mode === "create" ? t('columnHeaderEditor.addColumn') : t('columnHeaderEditor.saveChanges'))
  const displayError = error ?? localError

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="col-title">{t('columnHeaderEditor.title')}</Label>
        <Input
          id="col-title"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onBlur={() => void handleTitleBlur()}
          placeholder={t('columnHeaderEditor.titlePlaceholder')}
          autoFocus
          disabled={busy}
        />
        {matchedPresetId && (
          <p className="text-[11px] text-muted-foreground">
            {t('columnHeaderEditor.autofilledFromPreset')}{" "}
            <span className="font-medium">{t('columnHeaderEditor.editEitherToOverride')}</span>
          </p>
        )}
        {!matchedPresetId && drafting && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            <span>{t('columnHeaderEditor.draftingPrompt')}</span>
          </p>
        )}
        {!matchedPresetId && !drafting && draftedTitle && draftedTitle === title.trim() && (
          <p className="text-[11px] text-muted-foreground">
            {t('columnHeaderEditor.draftedPromptAndFormat')}{" "}
            <span className="font-medium">{t('columnHeaderEditor.editEitherToOverride')}</span>
          </p>
        )}
        {!matchedPresetId && !drafting && draftError && (
          <p className="text-[11px] text-destructive">
            {t('columnHeaderEditor.couldNotDraftPrompt', { error: draftError })}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="col-prompt">{t('columnHeaderEditor.prompt')}</Label>
          {draftFromTitle && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void runDraft({ force: true })}
              disabled={busy || drafting || !title.trim()}
              title={
                !title.trim()
                  ? t('columnHeaderEditor.enterTitleFirst')
                  : t('columnHeaderEditor.draftPromptFromTitle')
              }
              aria-label={t('columnHeaderEditor.draftPromptWithAi')}
              className="size-8 text-muted-foreground hover:text-foreground"
            >
              {drafting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="size-4" aria-hidden />
              )}
            </Button>
          )}
        </div>
        <Textarea
          id="col-prompt"
          value={prompt}
          onChange={(e) => handlePromptChange(e.target.value)}
          placeholder={t('columnHeaderEditor.promptPlaceholder')}
          rows={3}
          disabled={busy}
        />
      </div>
      <div className="space-y-1.5">
        <Label>{t('columnHeaderEditor.format')}</Label>
        <Select
          value={format}
          onValueChange={(v) => handleFormatChange(v as CellFormat)}
          disabled={busy}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMAT_LABELS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {displayError && (
        <p className="text-xs text-destructive">{displayError}</p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
          >
            {t('common.cancel')}
          </Button>
        )}
        <Button type="button" onClick={() => void submit()} disabled={busy}>
          {busy ? t('common.savingEllipsis') : submitText}
        </Button>
      </div>
    </div>
  )
}
