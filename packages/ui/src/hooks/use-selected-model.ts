import { useEffect, useState } from "react"

/**
 * Persist the user's chat-model preference in localStorage so it survives
 * reloads and applies on subsequent chat requests. Apps pass a unique
 * `storageKey` (e.g. `"suzielaw:selected-model"`) and use the returned
 * tuple like `useState`.
 *
 * Returns `[selected, setSelected]` where `selected` falls back to
 * `defaultId` when nothing is in storage. Setting to `undefined` clears the
 * preference (the app will then fall back to the server default again).
 */
export function useSelectedModel(
  storageKey: string,
  defaultId?: string,
): [string | undefined, (id: string | undefined) => void] {
  const [selected, setSelected] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return defaultId
    const v = window.localStorage.getItem(storageKey)
    return v ?? defaultId
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    if (selected) {
      window.localStorage.setItem(storageKey, selected)
    } else {
      window.localStorage.removeItem(storageKey)
    }
  }, [storageKey, selected])

  return [selected, setSelected]
}
