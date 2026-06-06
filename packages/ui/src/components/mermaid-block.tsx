import * as React from "react"

/**
 * Render a Mermaid diagram. `mermaid` is lazy-imported the first time a
 * block mounts so the dep (~700kb) stays out of the main bundle for users
 * who never hit a diagram. Each block gets a unique id so multiple
 * diagrams on the same page don't collide in mermaid's internal cache.
 */
let mermaidInitialized = false
let nextId = 0
const newId = () => `mermaid-${++nextId}-${Math.random().toString(36).slice(2, 8)}`

export interface MermaidBlockProps {
  code: string
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const hostRef = React.useRef<HTMLDivElement>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const id = newId()
    ;(async () => {
      try {
        const mod = await import("mermaid")
        const mermaid = mod.default
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "neutral",
            securityLevel: "strict",
          })
          mermaidInitialized = true
        }
        const { svg } = await mermaid.render(id, code)
        if (cancelled) return
        if (hostRef.current) hostRef.current.innerHTML = svg
        setError(null)
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code])

  if (error) {
    return (
      <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2">
        <div className="text-xs font-medium text-rose-700">Mermaid diagram failed to render</div>
        <div className="mt-1 text-[11px] text-rose-700">{error}</div>
        <pre className="mt-2 overflow-x-auto rounded bg-rose-100/70 p-2 font-mono text-[11px] text-rose-900">
{code}
        </pre>
      </div>
    )
  }

  return (
    <div
      ref={hostRef}
      data-slot="mermaid-block"
      className="my-2 flex justify-center overflow-x-auto rounded-md border border-neutral-200 bg-white p-3 [&_svg]:max-w-full [&_svg]:h-auto"
    />
  )
}
