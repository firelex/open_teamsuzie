import { useCallback, useEffect, useState } from "react"

export type PersonaSource = "builtin" | "user"

export interface Persona {
  id: string
  source: PersonaSource
  name: string
  description: string
  avatar?: string
  model?: string
  allowedTools?: string[]
  blockedTools?: string[]
  systemPrompt: string
  ownerId?: string
  createdAt?: number
  updatedAt?: number
}

export interface PersonaCreateInput {
  name: string
  description: string
  avatar?: string
  model?: string
  allowedTools?: string[]
  blockedTools?: string[]
  systemPrompt: string
}

export type PersonaUpdateInput = Partial<PersonaCreateInput>

export type PersonaSourceFilter = "all" | "builtin" | "user"

export interface UsePersonasQuery {
  /** Filter the result set. Defaults to `"all"` (builtins + user, no paging). */
  source?: PersonaSourceFilter
  /** 1-indexed page. Only meaningful when `source === "user"`. */
  page?: number
  /** Page size. Only meaningful when `source === "user"`. */
  pageSize?: number
  /** Case-insensitive substring match against name + description. */
  q?: string
}

export interface UsePersonasOptions extends UsePersonasQuery {
  /** Override the default endpoint (`/api/personas`). */
  endpoint?: string
  /** Custom fetch implementation, e.g. for testing. */
  fetchImpl?: typeof fetch
}

export interface UsePersonasResult {
  personas: Persona[]
  total: number
  loading: boolean
  error: string
  refresh: () => Promise<void>
  createPersona: (input: PersonaCreateInput) => Promise<Persona>
  updatePersona: (id: string, patch: PersonaUpdateInput) => Promise<Persona>
  deletePersona: (id: string) => Promise<void>
}

/**
 * Fetch + manage the persona list against the standard
 * `@teamsuzie/personas` REST surface (`GET/POST/PATCH/DELETE /api/personas`).
 *
 * The query options drive what's fetched:
 *  - default (`source: "all"`) — builtins + user merged, single fetch, no paging
 *  - `source: "builtin"` — just builtins
 *  - `source: "user"` with optional `page`/`pageSize` — server-paged user personas
 *
 * `total` is the count for the active filter. For `"user"` it's the full
 * count regardless of paging; for `"all"` and `"builtin"` it's the merged
 * length.
 */
export function usePersonas(opts: UsePersonasOptions = {}): UsePersonasResult {
  const endpoint = opts.endpoint ?? "/api/personas"
  const fetchImpl = opts.fetchImpl ?? fetch
  const source: PersonaSourceFilter = opts.source ?? "all"
  // `wantPaging` is opt-in: callers that don't pass page/pageSize get the
  // full list (used by the sidebar picker). Callers that pass either get
  // server-side paging on any source.
  const wantPaging = opts.page !== undefined || opts.pageSize !== undefined
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 24
  const q = opts.q?.trim() ?? ""
  const [personas, setPersonas] = useState<Persona[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      params.set("source", source)
      if (wantPaging) {
        params.set("page", String(page))
        params.set("pageSize", String(pageSize))
      }
      if (q) params.set("q", q)
      const response = await fetchImpl(`${endpoint}?${params.toString()}`, {
        credentials: "include",
      })
      if (!response.ok) throw new Error(`Failed to load personas (${response.status})`)
      const data = (await response.json()) as { items?: unknown; total?: unknown }
      const items = Array.isArray(data.items) ? (data.items as Persona[]) : []
      setPersonas(items)
      setTotal(typeof data.total === "number" ? data.total : items.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load personas")
    } finally {
      setLoading(false)
    }
  }, [endpoint, fetchImpl, source, wantPaging, page, pageSize, q])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createPersona = useCallback(
    async (input: PersonaCreateInput): Promise<Persona> => {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `Create failed (${response.status})`)
      }
      const data = (await response.json()) as { item: Persona }
      // Refetch rather than splicing locally — keeps paging metadata
      // (total, current page contents) in sync, including ordering.
      void refresh()
      return data.item
    },
    [endpoint, fetchImpl, refresh],
  )

  const updatePersona = useCallback(
    async (id: string, patch: PersonaUpdateInput): Promise<Persona> => {
      const response = await fetchImpl(`${endpoint}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `Update failed (${response.status})`)
      }
      const data = (await response.json()) as { item: Persona }
      setPersonas((current) => current.map((p) => (p.id === id ? data.item : p)))
      return data.item
    },
    [endpoint, fetchImpl],
  )

  const deletePersona = useCallback(
    async (id: string): Promise<void> => {
      const response = await fetchImpl(`${endpoint}/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `Delete failed (${response.status})`)
      }
      // Same reasoning as create — refetch to keep paging consistent. The
      // current page may shrink, or the user might have just deleted the
      // last item on a page.
      void refresh()
    },
    [endpoint, fetchImpl, refresh],
  )

  return {
    personas,
    total,
    loading,
    error,
    refresh,
    createPersona,
    updatePersona,
    deletePersona,
  }
}

/**
 * Persist the selected persona id in localStorage. Mirrors `useSelectedModel`'s
 * shape — apps pass a unique `storageKey` (e.g. `"suzielaw:selected-persona"`).
 *
 * Two callers in the same tab (e.g. App sidebar + Personas page) need to see
 * each other's writes. The native `storage` event only fires for *other*
 * tabs, so we also dispatch a `CustomEvent` on every write and have every
 * subscriber listen for it. Cross-tab still works via the native event.
 */
const SELECTED_PERSONA_EVENT = "teamsuzie:selected-persona-changed"

export function useSelectedPersona(
  storageKey: string,
): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null
    return window.localStorage.getItem(storageKey)
  })

  useEffect(() => {
    function syncFromStorage() {
      setId(window.localStorage.getItem(storageKey))
    }
    function handleCustom(e: Event) {
      const ce = e as CustomEvent<{ key: string }>
      if (ce.detail?.key !== storageKey) return
      syncFromStorage()
    }
    function handleNative(e: StorageEvent) {
      if (e.key !== storageKey) return
      syncFromStorage()
    }
    window.addEventListener(SELECTED_PERSONA_EVENT, handleCustom)
    window.addEventListener("storage", handleNative)
    return () => {
      window.removeEventListener(SELECTED_PERSONA_EVENT, handleCustom)
      window.removeEventListener("storage", handleNative)
    }
  }, [storageKey])

  const set = useCallback(
    (next: string | null) => {
      if (typeof window !== "undefined") {
        if (next) window.localStorage.setItem(storageKey, next)
        else window.localStorage.removeItem(storageKey)
        window.dispatchEvent(
          new CustomEvent(SELECTED_PERSONA_EVENT, { detail: { key: storageKey } }),
        )
      }
      setId(next)
    },
    [storageKey],
  )

  return [id, set]
}
