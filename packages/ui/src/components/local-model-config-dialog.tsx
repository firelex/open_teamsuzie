import * as React from "react"

import { Button } from "./button.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js"
import { Input } from "./input.js"
import { Label } from "./label.js"

export interface LocalModelConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Display name shown in the dialog title (e.g. "Qwen 3.6 35B-A3B"). */
  modelName: string
  /** Current effective values — prefilled into the form. */
  initialBaseUrl: string
  initialApiKey?: string
  /** Called with the new values when the user clicks Save. The caller is
   *  responsible for server-side validation + persistence; throw to surface
   *  an error inside the dialog. */
  onSave: (values: { baseUrl: string; apiKey: string | null }) => Promise<void>
  /** Optional reset-to-default handler. When provided, a "Reset to default"
   *  link appears next to the buttons. */
  onReset?: () => Promise<void>
}

/**
 * Dialog for editing a Local model's endpoint URL + optional API key.
 *
 * Lightweight on purpose: two text inputs, Save/Cancel, optional reset.
 * Hostname-allowlist validation lives server-side (use
 * `validateLocalAgentUrl` from `@teamsuzie/agent-loop`); this dialog
 * surfaces server errors via the rejection of `onSave`.
 */
export function LocalModelConfigDialog(props: LocalModelConfigDialogProps) {
  const { open, onOpenChange, modelName, initialBaseUrl, initialApiKey, onSave, onReset } = props
  const [baseUrl, setBaseUrl] = React.useState(initialBaseUrl)
  const [apiKey, setApiKey] = React.useState(initialApiKey ?? "")
  const [submitting, setSubmitting] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)
  const [error, setError] = React.useState("")

  // Reset state when the dialog opens with new initial values.
  React.useEffect(() => {
    if (open) {
      setBaseUrl(initialBaseUrl)
      setApiKey(initialApiKey ?? "")
      setError("")
    }
  }, [open, initialBaseUrl, initialApiKey])

  async function handleSave() {
    setSubmitting(true)
    setError("")
    try {
      await onSave({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() ? apiKey.trim() : null })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
      setSubmitting(false)
      return
    }
    setSubmitting(false)
  }

  async function handleReset() {
    if (!onReset) return
    setResetting(true)
    setError("")
    try {
      await onReset()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed")
      setResetting(false)
      return
    }
    setResetting(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Configure {modelName}</DialogTitle>
          <DialogDescription>
            Point chat at your locally-hosted endpoint. The hostname must be loopback (localhost,
            127.0.0.1), mDNS (*.local), or a private-range IP — public hosts are rejected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="local-base-url">Base URL</Label>
            <Input
              id="local-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:8801"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              The OpenAI-compatible server. Endpoint must serve <code>/v1/chat/completions</code>.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="local-api-key">API key (optional)</Label>
            <Input
              id="local-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="leave blank if your server doesn't enforce auth"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          {onReset ? (
            <button
              type="button"
              onClick={handleReset}
              disabled={resetting || submitting}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
            >
              {resetting ? "Resetting…" : "Reset to default"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={!baseUrl.trim() || submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
