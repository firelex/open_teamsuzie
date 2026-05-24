import { useCallback, useEffect, useState } from "react"

/**
 * Workflow shape — mirrors `@teamsuzie/workflows`'s persisted type. We
 * redeclare it here so the UI package doesn't take a runtime dep on
 * `@teamsuzie/workflows` (server-only). Any downstream importing
 * `@teamsuzie/workflows` directly can use that package's type — the
 * shape is identical by construction.
 */
export type WorkflowSource = "system" | "user"

export type WorkflowOutputMode =
  | "inline_chat"
  | "generate_docx"
  | "tabular_review"

export interface WorkflowColumnConfig {
  title: string
  prompt: string
  format: string
}

export interface Workflow {
  id: string
  source: WorkflowSource
  ownerId: string | null
  name: string
  description: string
  prompt: string
  practiceAreas: string[]
  columnConfig: WorkflowColumnConfig[] | null
  outputMode: WorkflowOutputMode
  /**
   * When true, hosts may surface this workflow as a starter tile on the
   * Assistant landing page (typically up to 4). When false, the workflow
   * is Library-only.
   */
  featured: boolean
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface CreateWorkflowInput {
  name: string
  description?: string
  prompt: string
  practiceAreas?: string[]
  columnConfig?: WorkflowColumnConfig[] | null
  outputMode?: WorkflowOutputMode
  featured?: boolean
}

export type UpdateWorkflowInput = Partial<CreateWorkflowInput>

export interface UseWorkflowsOptions {
  /** Override the default endpoint (`/api/workflows`). */
  endpoint?: string
  /** Custom fetch implementation, e.g. for testing. */
  fetchImpl?: typeof fetch
}

export interface UseWorkflowsResult {
  workflows: Workflow[]
  loading: boolean
  error: string
  refresh: () => Promise<void>
  create: (input: CreateWorkflowInput) => Promise<Workflow>
  update: (id: string, patch: UpdateWorkflowInput) => Promise<Workflow>
  remove: (id: string) => Promise<void>
}

/**
 * Reads + writes the user's visible workflows from `/api/workflows`. The
 * server merges system workflows with user-owned rows and applies any
 * per-user hides; this hook stays oblivious to that — it just sees the
 * effective list the server returns.
 *
 * Mutations re-fetch the list on success (not optimistic) since the
 * visibility filter is server-side and the new row may rank differently.
 *
 * Generic-shaped: no legal-specific assumptions. Suitable for any agent
 * that mounts `@teamsuzie/workflows`'s `createWorkflowsRouter`.
 */
export function useWorkflows(opts?: UseWorkflowsOptions): UseWorkflowsResult {
  const endpoint = opts?.endpoint ?? "/api/workflows"
  const fetchFn = opts?.fetchImpl ?? fetch

  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchFn(endpoint)
      if (!res.ok) throw new Error(`Failed to load workflows (${res.status})`)
      const data = (await res.json()) as { items?: Workflow[]; workflows?: Workflow[] }
      // Tolerate either { items: ... } (the upstream router shape) or
      // { workflows: ... } so this hook fits both server conventions.
      setWorkflows(data.items ?? data.workflows ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflows")
    } finally {
      setLoading(false)
    }
  }, [endpoint, fetchFn])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(
    async (input: CreateWorkflowInput): Promise<Workflow> => {
      const res = await fetchFn(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `Failed (${res.status})`)
      }
      const data = (await res.json()) as { item: Workflow }
      await refresh()
      return data.item
    },
    [endpoint, fetchFn, refresh],
  )

  const update = useCallback(
    async (id: string, patch: UpdateWorkflowInput): Promise<Workflow> => {
      const res = await fetchFn(`${endpoint}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `Failed (${res.status})`)
      }
      const data = (await res.json()) as { item: Workflow }
      await refresh()
      return data.item
    },
    [endpoint, fetchFn, refresh],
  )

  const remove = useCallback(
    async (id: string): Promise<void> => {
      const res = await fetchFn(`${endpoint}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      if (!res.ok && res.status !== 404) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `Failed (${res.status})`)
      }
      await refresh()
    },
    [endpoint, fetchFn, refresh],
  )

  return { workflows, loading, error, refresh, create, update, remove }
}
