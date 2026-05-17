import { useCallback } from "react"

export interface UseChatComposerOptions {
  /** True while a stream is in flight. */
  isStreaming: boolean
  /** Called to start a new turn. Receives the trimmed input text. */
  onSend: (text: string) => void
  /** Called to abort the current stream. */
  onStop: () => void
  /** The current input text — owned by the caller. */
  text: string
  /** Setter for the input text — owned by the caller. */
  setText: (next: string) => void
}

export interface UseChatComposerResult {
  /** Wire to <textarea onKeyDown={...}> */
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  /** Wire to <form onSubmit={...}> or <button onClick={...}> */
  handleSubmit: (e?: { preventDefault?: () => void }) => void
  /** Wire to the Stop button onClick. */
  handleStop: () => void
  /** True when there's submittable input. */
  canSend: boolean
}

/**
 * Glue for chat composers. Encapsulates three behaviors apps need:
 *  - Enter sends (Shift+Enter newline).
 *  - Enter while streaming ABORTS the in-flight stream then sends the new
 *    text on the next tick — so the user can keep typing past the agent.
 *  - Stop button calls onStop.
 *
 * The caller still owns the text state + the abort handle + the actual
 * fetch. This hook is just keyboard + submit + abort orchestration.
 */
export function useChatComposer(opts: UseChatComposerOptions): UseChatComposerResult {
  const { isStreaming, onSend, onStop, text, setText } = opts
  const trimmed = text.trim()
  const canSend = trimmed.length > 0

  const submit = useCallback(() => {
    if (!canSend) return
    if (isStreaming) {
      onStop()
      // Defer the send so the abort can unwind before the parent kicks off
      // a new stream. setTimeout(0) is enough since abort() is synchronous
      // signal-flipping and the next stream-start runs on the next tick.
      const t = trimmed
      setTimeout(() => onSend(t), 0)
    } else {
      onSend(trimmed)
    }
    setText("")
  }, [canSend, isStreaming, onSend, onStop, trimmed, setText])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        submit()
      }
    },
    [submit],
  )

  const handleSubmit = useCallback(
    (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.()
      submit()
    },
    [submit],
  )

  const handleStop = useCallback(() => {
    onStop()
  }, [onStop])

  return { handleKeyDown, handleSubmit, handleStop, canSend }
}
