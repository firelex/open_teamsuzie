import * as React from "react"
import { Check, Minus } from "lucide-react"

import { cn } from "../lib/utils"

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /**
   * Tri-state — when `true` and `checked` is also `true`, renders as a
   * minus glyph. Useful for "all selected on this page" headers when the
   * full list contains more.
   */
  indeterminate?: boolean
}

/**
 * Styled checkbox with the same look as the rest of the shadcn surface.
 * Native input under the hood — no Radix dependency, full keyboard +
 * a11y for free. Tri-state via the `indeterminate` prop.
 *
 * Use for selection columns in lists (paired with `<BulkActionBar>`),
 * for individual settings toggles where a Switch would feel too
 * binary, and for multi-select pickers.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ className, indeterminate, checked, onChange, disabled, ...rest }, forwardedRef) {
    const innerRef = React.useRef<HTMLInputElement | null>(null)
    React.useImperativeHandle(forwardedRef, () => innerRef.current!, [])
    React.useEffect(() => {
      const el = innerRef.current
      if (el) el.indeterminate = !!indeterminate
    }, [indeterminate])

    return (
      <span className={cn("relative inline-flex h-4 w-4 shrink-0", className)}>
        <input
          ref={innerRef}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className={cn(
            "peer absolute inset-0 cursor-pointer appearance-none rounded-[4px] border border-input bg-background",
            "checked:bg-primary checked:border-primary",
            "indeterminate:bg-primary indeterminate:border-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "transition-colors",
          )}
          {...rest}
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-primary-foreground">
          {indeterminate ? (
            <Minus className="size-3" strokeWidth={3} />
          ) : checked ? (
            <Check className="size-3" strokeWidth={3} />
          ) : null}
        </span>
      </span>
    )
  },
)
