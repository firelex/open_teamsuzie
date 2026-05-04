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

export interface UsePersonasOptions {
  /** Override the default endpoint (`/api/personas`). */
  endpoint?: string
  /** Custom fetch implementation, e.g. for testing. */
  fetchImpl?: typeof fetch
}

export interface UsePersonasResult {
  personas: Persona[]
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
 * Returns builtins + the caller's own user-created personas as one merged list.
 */
export function usePersonas(opts: UsePersonasOptions = {}): UsePersonasResult {
  const endpoint = opts.endpoint ?? "/api/personas"
  const fetchImpl = opts.fetchImpl ?? fetch
  const [personas, setPersonas] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetchImpl(endpoint, { credentials: "include" })
      if (!response.ok) throw new Error(`Failed to load personas (${response.status})`)
      const data = (await response.json()) as { personas: Persona[] }
      setPersonas(data.personas)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load personas")
    } finally {
      setLoading(false)
    }
  }, [endpoint, fetchImpl])

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
      const data = (await response.json()) as { persona: Persona }
      setPersonas((current) => [...current, data.persona])
      return data.persona
    },
    [endpoint, fetchImpl],
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
      const data = (await response.json()) as { persona: Persona }
      setPersonas((current) => current.map((p) => (p.id === id ? data.persona : p)))
      return data.persona
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
      setPersonas((current) => current.filter((p) => p.id !== id))
    },
    [endpoint, fetchImpl],
  )

  return { personas, loading, error, refresh, createPersona, updatePersona, deletePersona }
}

/**
 * Persist the selected persona id in localStorage. Mirrors `useSelectedModel`'s
 * shape — apps pass a unique `storageKey` (e.g. `"suzielaw:selected-persona"`).
 */
export function useSelectedPersona(
  storageKey: string,
): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null
    return window.localStorage.getItem(storageKey)
  })

  const set = useCallback(
    (next: string | null) => {
      if (typeof window !== "undefined") {
        if (next) window.localStorage.setItem(storageKey, next)
        else window.localStorage.removeItem(storageKey)
      }
      setId(next)
    },
    [storageKey],
  )

  return [id, set]
}
