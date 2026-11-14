import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { ToolUseStatus } from "./tool-use-status"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("ToolUseStatus", () => {
  it("shows how long a slow step has been running, and no timer once it is done", () => {
    vi.useFakeTimers()
    const running = [{ id: "t1", name: "Searching UK legislation", args: { query: "Data Protection Act" }, status: "running" as const }]
    const { rerender } = render(<ToolUseStatus verb="Working" events={running} />)
    expect(screen.getByText("Searching UK legislation")).toBeTruthy()
    expect(screen.getByText("· Data Protection Act")).toBeTruthy()
    expect(screen.queryByText(/\d+ s$/)).toBeNull()
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByText("· 5 s")).toBeTruthy()
    rerender(<ToolUseStatus verb="Working" events={[{ ...running[0]!, status: "done" as const }]} />)
    expect(screen.queryByText(/\d+ s$/)).toBeNull()
  })
})
