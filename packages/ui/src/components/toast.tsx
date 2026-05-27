/**
 * Imperative toast hook + provider. Companion to `useConfirm` for
 * non-blocking feedback. Vocabulary matches `useConfirm` (`variant`
 * not `tone`); `destructive` is intentionally not a variant — use
 * `error` for failure feedback. Typical use: wrap a mutation in
 * try/catch, `toast.show('Saved', { variant: 'success' })` on success
 * and `toast.show(msg, { variant: 'error' })` on catch. See
 * `useConfirm` (./confirm-dialog) for blocking confirmation modals.
 */
import * as React from "react"
import { AlertCircle, AlertTriangle, CheckCircle2, X } from "lucide-react"

import { cn } from "../lib/utils"

export type ToastVariant = "default" | "success" | "error" | "warning"

export interface ToastOptions {
  variant?: ToastVariant
  /** Auto-dismiss after N ms. 0 keeps it visible until manually closed. Default 2400. */
  durationMs?: number
  /** Optional secondary action. Renders as a button; click fires + dismisses. */
  action?: { label: string; onClick: () => void }
}

export interface ToastApi {
  show: (message: string, opts?: ToastOptions) => void
}

interface ResolvedToastOptions {
  variant: ToastVariant
  durationMs: number
  action?: ToastOptions["action"]
}

interface Toast {
  id: number
  message: string
  opts: ResolvedToastOptions
}

const ToastContext = React.createContext<ToastApi | null>(null)

const variantStyles: Record<ToastVariant, string> = {
  default:
    "border-border bg-background text-foreground",
  success:
    "border-green-500/40 bg-green-500/10 text-green-900 dark:text-green-100",
  error:
    "border-destructive/50 bg-destructive/10 text-destructive",
  warning:
    "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100",
}

const variantIcons: Record<
  ToastVariant,
  React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> | null
> = {
  default: null,
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
}

/**
 * Mount once near the root of the app. Provides the imperative
 * `useToast()` hook and renders a single shared viewport that stacks
 * toasts in the top-right corner (newest on top).
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const nextId = React.useRef(0)

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const show = React.useCallback<ToastApi["show"]>(
    (message, opts = {}) => {
      const id = nextId.current++
      const t: Toast = {
        id,
        message,
        opts: {
          variant: opts.variant ?? "default",
          durationMs: opts.durationMs ?? 2400,
          action: opts.action,
        },
      }
      setToasts((prev) => [t, ...prev])
      if (t.opts.durationMs > 0) {
        setTimeout(() => dismiss(id), t.opts.durationMs)
      }
    },
    [dismiss],
  )

  const api = React.useMemo<ToastApi>(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

/**
 * Imperative toast hook. Returns an object with `show(message, opts?)`
 * that enqueues a toast in the shared viewport.
 *
 *   const toast = useToast()
 *   try {
 *     await saveSomething()
 *     toast.show('Saved', { variant: 'success' })
 *   } catch (err) {
 *     toast.show(err.message, { variant: 'error' })
 *   }
 *
 * If called outside a `<ToastProvider>`, returns a stable no-op so
 * consumers don't have to guard the call site; in development a
 * single `console.warn` reminds you to mount the provider.
 */
export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext)
  if (!ctx) {
    if (!isProduction()) {
      console.warn(
        "useToast() called outside <ToastProvider>; show() is a no-op.",
      )
    }
    return noopToastApi
  }
  return ctx
}

function isProduction(): boolean {
  // `process` may be undefined in bundlers that don't shim it. Read defensively
  // so we don't crash at runtime nor require `@types/node` at build time.
  try {
    const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
      .process
    return proc?.env?.NODE_ENV === "production"
  } catch {
    return false
  }
}

const noopToastApi: ToastApi = { show: () => {} }

/**
 * Fixed top-right stack of active toasts. Pointer-events are scoped
 * to each toast so the viewport itself doesn't intercept clicks on
 * the page beneath it.
 */
function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: number) => void
}) {
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

/**
 * A single toast card: icon (variant-dependent) + message + optional
 * action button + close button.
 */
function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast
  onDismiss: (id: number) => void
}) {
  const Icon = variantIcons[toast.opts.variant]
  const handleAction = () => {
    toast.opts.action?.onClick()
    onDismiss(toast.id)
  }
  return (
    <div
      role="status"
      data-variant={toast.opts.variant}
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-md border p-3 text-sm shadow-md",
        variantStyles[toast.opts.variant],
      )}
    >
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1 break-words">{toast.message}</div>
      {toast.opts.action && (
        <button
          type="button"
          onClick={handleAction}
          className="shrink-0 rounded px-2 py-0.5 text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {toast.opts.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 text-current/70 hover:text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
