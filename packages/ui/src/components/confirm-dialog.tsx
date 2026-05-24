import * as React from "react"
import { AlertTriangle } from "lucide-react"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog"
import { Button } from "./button"
import { PendingButton } from "./pending-button"

export interface ConfirmOptions {
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** "destructive" tints the confirm button red and adds an alert icon. */
  variant?: "default" | "destructive"
  /**
   * If set, the confirm button shows a spinner and stays open while
   * the resolver awaits this. The dialog closes automatically on
   * success; on throw it stays open and surfaces the error inline.
   */
  onConfirm?: () => void | Promise<void>
}

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (decision: boolean) => void
}

interface ConfirmDialogContextValue {
  /**
   * Show a confirmation modal. Resolves to `true` if the user clicked
   * confirm (and `onConfirm` — if provided — completed without throwing),
   * `false` if cancelled or dismissed.
   */
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const ConfirmDialogContext = React.createContext<ConfirmDialogContextValue | null>(null)

/**
 * Mount once near the root of the app. Provides the imperative
 * `useConfirm()` hook and renders a single shared dialog. Replaces
 * every `window.confirm()` / `window.alert()` site — those have no
 * theme, no async support, no a11y, and trap focus poorly.
 */
export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null)
  const [running, setRunning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const confirm = React.useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setError(null)
        setRunning(false)
        setPending({ options, resolve })
      }),
    [],
  )

  const finish = (decision: boolean) => {
    if (!pending) return
    pending.resolve(decision)
    setPending(null)
    setRunning(false)
    setError(null)
  }

  const handleConfirm = async () => {
    if (!pending) return
    const { onConfirm } = pending.options
    if (!onConfirm) {
      finish(true)
      return
    }
    setRunning(true)
    setError(null)
    try {
      await onConfirm()
      finish(true)
    } catch (err) {
      setRunning(false)
      setError(err instanceof Error ? err.message : "Action failed")
    }
  }

  const value = React.useMemo<ConfirmDialogContextValue>(() => ({ confirm }), [confirm])

  const opts = pending?.options
  const isDestructive = opts?.variant === "destructive"

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !running) finish(false)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isDestructive && (
                <AlertTriangle
                  className="size-5 text-destructive"
                  aria-hidden
                />
              )}
              <span>{opts?.title}</span>
            </DialogTitle>
            {opts?.description && (
              <DialogDescription>{opts.description}</DialogDescription>
            )}
          </DialogHeader>
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={running}>
                {opts?.cancelLabel ?? "Cancel"}
              </Button>
            </DialogClose>
            <PendingButton
              variant={isDestructive ? "destructive" : "default"}
              pending={running}
              pendingLabel={(opts?.confirmLabel ?? "Confirm") + "…"}
              onClick={() => void handleConfirm()}
            >
              {opts?.confirmLabel ?? "Confirm"}
            </PendingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmDialogContext.Provider>
  )
}

/**
 * Imperative confirmation hook. Returns a function that opens the
 * shared confirm dialog and resolves to `true`/`false` based on the
 * user's choice.
 *
 *   const confirm = useConfirm()
 *   if (await confirm({ title: "Delete matter?", variant: "destructive" })) {
 *     void doDelete()
 *   }
 */
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = React.useContext(ConfirmDialogContext)
  if (!ctx) {
    // Graceful fallback for consumers that do not mount <ConfirmDialogProvider>.
    // Returns a stable function that delegates to window.confirm so existing
    // behaviour is preserved without a hard render-time throw.
    return (options: ConfirmOptions) =>
      Promise.resolve(
        typeof window !== "undefined"
          ? window.confirm(options.title)
          : false,
      )
  }
  return ctx.confirm
}
