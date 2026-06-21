import * as React from "react"
import { X } from "lucide-react"

import { cn } from "../lib/utils"

export interface TagInputProps {
  /** Current chip values. Controlled. */
  value: readonly string[]
  /** Fires with the new list whenever the user adds, removes, or reorders. */
  onChange: (next: readonly string[]) => void
  /**
   * Optional accessible label for the input. Use this when the field's
   * visible label is rendered separately (e.g. via `<label>`).
   */
  ariaLabel?: string
  /** Placeholder for the underlying input. */
  placeholder?: string
  /**
   * Cap on the number of chips. Adding past the cap is silently ignored. The
   * caller decides whether to surface a hint.
   */
  maxTags?: number
  /**
   * Allow duplicate chip values. Default `false` — adding an existing value
   * is a no-op and focus returns to the input. Case-insensitive by default
   * (see `caseSensitiveDedup`).
   */
  allowDuplicates?: boolean
  /** When `false` (default), dedupes "ACME" against "acme". */
  caseSensitiveDedup?: boolean
  /**
   * Characters that finalize the in-progress text into a chip. Defaults to
   * comma + Enter. The character itself is consumed.
   */
  separators?: readonly string[]
  /** Disable the whole control (caller responsibility to convey this visually elsewhere). */
  disabled?: boolean
  /** Optional test id forwarded to the wrapper. */
  "data-testid"?: string
  className?: string
  /** Optional tone for the chips. Default is a neutral muted look. */
  tone?: "neutral" | "in" | "out"
}

/**
 * Chip / tag input. Each chip is independently removable; new chips are
 * created by typing and pressing Enter / comma. Backspace on an empty
 * input deletes the trailing chip — matches the affordance users learn
 * from GitHub, Linear, Gmail, etc.
 *
 * Designed to replace freeform CSV / "in: a, b; out: c, d" string fields
 * with something the user can actually scan and edit. Pair with a labeled
 * `<fieldset>` (left to the caller) when in/out semantics matter.
 */
export function TagInput({
  value,
  onChange,
  ariaLabel,
  placeholder = "Type and press Enter",
  maxTags,
  allowDuplicates = false,
  caseSensitiveDedup = false,
  separators = [",", "Enter"],
  disabled = false,
  className,
  tone = "neutral",
  ...rest
}: TagInputProps) {
  const [draft, setDraft] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const normalizeForDedup = React.useCallback(
    (v: string) => (caseSensitiveDedup ? v : v.toLowerCase()),
    [caseSensitiveDedup],
  )

  const addChips = React.useCallback(
    (raws: readonly string[]) => {
      const next = [...value]
      for (const raw of raws) {
        const trimmed = raw.trim()
        if (!trimmed) continue
        if (maxTags !== undefined && next.length >= maxTags) break
        if (!allowDuplicates) {
          const normalized = normalizeForDedup(trimmed)
          if (next.some((v) => normalizeForDedup(v) === normalized)) continue
        }
        next.push(trimmed)
      }
      if (next.length !== value.length) {
        onChange(next)
      }
      setDraft("")
    },
    [value, onChange, maxTags, allowDuplicates, normalizeForDedup],
  )
  const addChip = React.useCallback(
    (raw: string) => addChips([raw]),
    [addChips],
  )

  const removeChipAt = React.useCallback(
    (index: number) => {
      if (index < 0 || index >= value.length) return
      const next = [...value]
      next.splice(index, 1)
      onChange(next)
    },
    [value, onChange],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return
    if (separators.includes(e.key)) {
      e.preventDefault()
      addChip(draft)
      return
    }
    if (e.key === "Backspace" && draft.length === 0 && value.length > 0) {
      e.preventDefault()
      removeChipAt(value.length - 1)
      return
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Support paste of "a, b, c" — split on comma immediately and commit all
    // complete segments in a single onChange so React doesn't drop the
    // intermediate values to stale-closure batching.
    const raw = e.target.value
    if (raw.includes(",")) {
      const parts = raw.split(",")
      addChips(parts.slice(0, -1))
      setDraft(parts[parts.length - 1] ?? "")
      return
    }
    setDraft(raw)
  }

  const handleBlur = () => {
    if (draft.length > 0) addChip(draft)
  }

  const handleWrapperClick = () => {
    inputRef.current?.focus()
  }

  return (
    <div
      onClick={handleWrapperClick}
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded border border-(--color-border) px-1.5 py-1 text-xs",
        disabled ? "bg-(--color-muted) opacity-60" : "bg-white cursor-text focus-within:border-(--color-primary)",
        className,
      )}
      data-testid={rest["data-testid"]}
    >
      {value.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
            tone === "in"
              ? "bg-emerald-50 text-emerald-800"
              : tone === "out"
              ? "bg-rose-50 text-rose-800"
              : "bg-(--color-muted) text-(--color-foreground)",
          )}
          data-testid="tag-input-chip"
        >
          <span>{tag}</span>
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={(e) => {
                e.stopPropagation()
                removeChipAt(i)
              }}
              className="inline-flex h-3.5 w-3.5 items-center justify-center rounded hover:bg-black/10"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          )}
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={value.length === 0 ? placeholder : undefined}
        disabled={disabled}
        aria-label={ariaLabel}
        className="flex-1 min-w-32 bg-transparent outline-none disabled:cursor-not-allowed"
        data-testid="tag-input-input"
      />
    </div>
  )
}
