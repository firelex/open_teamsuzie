import * as React from "react"

import { cn } from "../lib/utils"

/**
 * Hosts a Craft app's web build (WordCraft, DeckCraft, …, by the ArtCraft
 * team; MIT or Apache-2.0) in an iframe and speaks its host contract
 * (storytold/craft-libs `craft-web-host`, version "1"):
 *
 * - the app posts `<app>:ready`; the frame answers `<app>:host` and sends
 *   the document as `<app>:open { name, bytes }`;
 * - every Save, Save As or Export arrives as `<app>:save { name, bytes,
 *   saveAs, id? }` instead of a download; the frame hands it to `onSave`
 *   and, when the save carried an `id`, answers `<app>:saved { id }` once
 *   it is stored;
 * - `<app>:dirty { dirty }` reports unsaved changes (the frame then guards
 *   leaving the page); `<app>:failed { error }` says the app could not
 *   start or take the document.
 *
 * The app must be served from the same origin as the page: the bridge only
 * talks to a same-origin parent. `author` signs comments and tracked
 * changes made in the app.
 *
 * `onApi` receives the app's page command API (`window.<app>`, the
 * `craft-web-api` contract) once the app is ready, so the host can run the
 * app's commands on the open document, e.g. `execute("document.text")`.
 */

/** The app's command API, as the host sees it. */
export interface CraftAppApi {
  /** Run one of the app's commands; resolves with its result, rejects with its error. */
  execute: (command: string, params?: Record<string, unknown>) => Promise<unknown>
}
export interface CraftAppFrameProps {
  /** The app id in the messages, e.g. "wordcraft". */
  app: string
  /** URL of the app's index.html on this origin. */
  src: string
  /** The document to open; the frame waits for it before sending. */
  file: { name: string; bytes: ArrayBuffer } | null
  /** Name for comments and tracked changes. */
  author?: string
  /** Store a saved file. Throwing leaves the app's document unsaved. */
  onSave: (save: { name: string; bytes: ArrayBuffer; saveAs: boolean }) => Promise<void>
  onDirty?: (dirty: boolean) => void
  onFailed?: (error: string) => void
  /** The app's command API once it is ready (null when the frame goes away). */
  onApi?: (api: CraftAppApi | null) => void
  /**
   * Preferences to set before the app starts, merged into what it keeps in
   * this origin's localStorage under `<app>.ui` (camelCase names of its
   * UiState, e.g. `{ showDiscord: false }` hides the community button).
   */
  prefs?: Record<string, unknown>
  /** Accessible name of the frame. */
  title: string
  className?: string
}

interface CraftMessage {
  type?: unknown
  [key: string]: unknown
}

export function CraftAppFrame({ app, src, file, author, onSave, onDirty, onFailed, onApi, prefs, title, className }: CraftAppFrameProps) {
  // Before the iframe exists, so the app reads them at start-up.
  React.useState(() => {
    if (prefs) mergePrefs(`${app}.ui`, prefs)
    return null
  })
  const frameRef = React.useRef<HTMLIFrameElement | null>(null)
  const [ready, setReady] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const sentRef = React.useRef<ArrayBuffer | null>(null)
  // The latest callbacks, without re-subscribing the listener on every render.
  const handlers = React.useRef({ onSave, onDirty, onFailed, onApi })
  handlers.current = { onSave, onDirty, onFailed, onApi }

  const post = React.useCallback((message: Record<string, unknown>, transfer?: Transferable[]) => {
    const target = frameRef.current?.contentWindow
    if (!target) throw new Error(`${app} frame is not loaded`)
    target.postMessage(message, window.location.origin, transfer)
  }, [app])

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return
      const data = event.data as CraftMessage
      if (typeof data?.type !== "string" || !data.type.startsWith(`${app}:`)) return
      const kind = data.type.slice(app.length + 1)
      if (kind === "ready") {
        post({ type: `${app}:host`, version: "1" })
        setReady(true)
        if (handlers.current.onApi) {
          const api = (frameRef.current?.contentWindow as unknown as Record<string, { execute?: CraftAppApi["execute"] }> | null)?.[app]
          if (!api?.execute) {
            handlers.current.onFailed?.(`${app} is ready but has no command API (window.${app}.execute)`)
          } else {
            const execute = api.execute
            handlers.current.onApi({ execute: (command, params) => execute(command, params ?? {}) })
          }
        }
      } else if (kind === "save") {
        const bytes = data.bytes
        if (!(bytes instanceof ArrayBuffer)) {
          handlers.current.onFailed?.(`${app} sent a save without its bytes`)
          return
        }
        const id = typeof data.id === "string" ? data.id : null
        handlers.current
          .onSave({ name: String(data.name ?? "document"), bytes, saveAs: data.saveAs === true })
          .then(() => {
            if (id) post({ type: `${app}:saved`, id })
          })
          .catch((err: unknown) => handlers.current.onFailed?.(err instanceof Error ? err.message : String(err)))
      } else if (kind === "dirty") {
        setDirty(data.dirty === true)
        handlers.current.onDirty?.(data.dirty === true)
      } else if (kind === "failed") {
        handlers.current.onFailed?.(String(data.error ?? `${app} failed`))
      }
    }
    window.addEventListener("message", onMessage)
    return () => {
      window.removeEventListener("message", onMessage)
      handlers.current.onApi?.(null)
    }
  }, [app, post])

  // Send the document once the app is ready (and again if a different one is given).
  React.useEffect(() => {
    if (!ready || !file || sentRef.current === file.bytes) return
    sentRef.current = file.bytes
    // Transfer a copy: the caller keeps its own bytes.
    const copy = file.bytes.slice(0)
    post({ type: `${app}:open`, name: file.name, bytes: copy }, [copy])
  }, [ready, file, app, post])

  // The host guards leaving the page while the app has unsaved changes.
  React.useEffect(() => {
    if (!dirty) return
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [dirty])

  const url = `${src}?host=parent${author ? `&author=${encodeURIComponent(author)}` : ""}`
  return <iframe ref={frameRef} src={url} title={title} className={cn("h-full w-full border-0", className)} />
}

/**
 * Merge `prefs` into the JSON object the app keeps under `key`. A stored
 * value that is not a JSON object is one the app itself would ignore (it
 * starts from its defaults), so it is replaced by `prefs` alone.
 */
function mergePrefs(key: string, prefs: Record<string, unknown>): void {
  const raw = window.localStorage.getItem(key)
  let stored: Record<string, unknown> = {}
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>
    } catch {
      // Unreadable: the app would start from its defaults too.
    }
  }
  window.localStorage.setItem(key, JSON.stringify({ ...stored, ...prefs }))
}
