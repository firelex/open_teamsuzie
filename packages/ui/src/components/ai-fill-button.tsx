import * as React from "react"
import { Loader2, Sparkles } from "lucide-react"

import { Button } from "./button"
import { cn } from "../lib/utils"

/**
 * The set of draft kinds the `/api/ai/draft` endpoint understands.
 * Keep in sync with the server-side `AiDraftKind` enum (agent-runtime
 * `routes/api-ai-draft.ts`). Tasks 2.5/2.6 mount this in the Library
 * (prompt-body) and Personas (persona-system) editors; later tasks
 * extend it for workflow + review-column prompts.
 */
export type AiFillKind =
  | "prompt-body"
  | "persona-system"
  | "workflow-prompt"
  | "review-column-prompt"

export interface AiFillButtonProps
  extends Omit<React.ComponentProps<"button">, "onClick" | "children"> {
  /** Which kind of draft to ask the server for. */
  kind: AiFillKind
  /** Free-form context the server uses to ground the draft. */
  context: Record<string, unknown>
  /** Called with the drafted text on success. */
  onFill: (text: string) => void
  /** Defaults to `/api/ai/draft`. Override for testing or alt routes. */
  endpoint?: string
  /** Optional className passed through to the underlying button. */
  className?: string
}

/**
 * Small ✨ icon button that posts `{ kind, context }` to
 * `POST /api/ai/draft` and hands the resulting `text` back via
 * `onFill`. Reusable across prompt, persona, workflow, and
 * review-column forms (Tasks 2.5/2.6 wire it in).
 *
 * Component tests live with the consumer apps / agent-runtime e2e
 * suite — `@teamsuzie/ui` has no vitest+RTL setup yet, and standing
 * one up for a single test isn't worth the cost. The endpoint
 * contract is covered by `routes/api-ai-draft.test.ts`.
 */
export function AiFillButton({
  kind,
  context,
  onFill,
  endpoint = "/api/ai/draft",
  disabled,
  className,
  title,
  ...rest
}: AiFillButtonProps) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function go() {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, context }),
      })
      const j = (await r.json()) as { ok?: boolean; text?: string; error?: string }
      if (j.ok && typeof j.text === "string") {
        onFill(j.text)
      } else {
        setError(j.error ?? "AI fill failed")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI fill failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={go}
      disabled={disabled || busy}
      aria-label="Fill with AI"
      aria-busy={busy || undefined}
      title={title ?? error ?? "Fill with AI"}
      className={cn("size-8 text-muted-foreground hover:text-foreground", className)}
      {...rest}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Sparkles className="size-4" aria-hidden />
      )}
    </Button>
  )
}
