import * as React from "react"
import { Loader2 } from "lucide-react"
import type { VariantProps } from "class-variance-authority"

import { Button, buttonVariants } from "./button"
import { cn } from "../lib/utils"

export type PendingButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /**
     * When true, the button shows a spinner, becomes disabled, and (if
     * `pendingLabel` is provided) swaps the label. Use this anywhere a
     * click triggers a network call — replaces the manual "Saving…" /
     * "Sending…" / "Starting…" patterns scattered across pages.
     */
    pending?: boolean
    /**
     * Text shown in place of children while pending. Omit to keep the
     * original label and just show a spinner alongside it.
     */
    pendingLabel?: React.ReactNode
  }

/**
 * Drop-in `<Button>` replacement for click handlers that go to the
 * network. Keeps the user oriented while the request is in flight
 * via a spinner; the standard alternative — flipping the label to
 * "Saving…" — leaves them guessing whether anything is happening.
 *
 * Usage:
 *   <PendingButton pending={isSaving} pendingLabel="Saving" onClick={save}>
 *     Save
 *   </PendingButton>
 */
export const PendingButton = React.forwardRef<HTMLButtonElement, PendingButtonProps>(
  function PendingButton(
    { pending = false, pendingLabel, children, disabled, className, ...rest },
    ref,
  ) {
    return (
      <Button
        ref={ref}
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        className={cn("relative", className)}
        {...rest}
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {pendingLabel != null ? <span>{pendingLabel}</span> : children}
          </>
        ) : (
          // Render children directly — wrapping in a span here would
          // collapse the icon + label into a single inline flex item,
          // and the text would wrap under the icon. The Button already
          // owns the flex layout we want.
          children
        )}
      </Button>
    )
  },
)
