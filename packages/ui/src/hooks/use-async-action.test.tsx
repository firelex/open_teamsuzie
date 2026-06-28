import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react"

import { LongRunningProvider, useLongRunning, TopProgressBar } from "../components/long-running.js"
import { useAsyncAction, formatElapsed } from "./use-async-action.js"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("useAsyncAction", () => {
  it("flips busy → false and exposes the result", async () => {
    const { result } = renderHook(() =>
      useAsyncAction(async (x: number) => x * 2),
    )

    expect(result.current.busy).toBe(false)
    expect(result.current.result).toBeNull()

    await act(async () => {
      const value = await result.current.run(7)
      expect(value).toBe(14)
    })

    expect(result.current.busy).toBe(false)
    expect(result.current.result).toBe(14)
    expect(result.current.error).toBeNull()
  })

  it("captures the error and re-throws", async () => {
    const { result } = renderHook(() =>
      useAsyncAction(async () => {
        throw new Error("boom")
      }),
    )

    await act(async () => {
      await expect(result.current.run()).rejects.toThrow("boom")
    })

    expect(result.current.busy).toBe(false)
    expect(result.current.error?.message).toBe("boom")
  })

  it("ignores reentrant run() calls by default", async () => {
    let resolveInner: () => void = () => {}
    const inner = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveInner = resolve
        }),
    )
    const { result } = renderHook(() => useAsyncAction(inner))

    let firstPromise: Promise<void | undefined>
    act(() => {
      firstPromise = result.current.run()
    })

    // Second call while still busy should be ignored.
    await act(async () => {
      const second = await result.current.run()
      expect(second).toBeUndefined()
    })
    expect(inner).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveInner()
      await firstPromise!
    })
  })

  it("registers with LongRunningProvider while busy", async () => {
    let resolveInner: () => void = () => {}
    const inner = () =>
      new Promise<void>((resolve) => {
        resolveInner = resolve
      })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LongRunningProvider>{children}</LongRunningProvider>
    )

    const { result } = renderHook(
      () => {
        const action = useAsyncAction(inner, { label: "Smoke run" })
        const registry = useLongRunning()
        return { action, registry }
      },
      { wrapper },
    )

    expect(result.current.registry.activeCount).toBe(0)

    let pending: Promise<void | undefined>
    act(() => {
      pending = result.current.action.run()
    })

    await waitFor(() => expect(result.current.registry.activeCount).toBe(1))
    expect(result.current.registry.activeEntries[0]?.label).toBe("Smoke run")

    await act(async () => {
      resolveInner()
      await pending!
    })

    expect(result.current.registry.activeCount).toBe(0)
  })
})

describe("TopProgressBar", () => {
  it("renders nothing when the registry is idle", () => {
    const { container } = render(
      <LongRunningProvider>
        <TopProgressBar />
      </LongRunningProvider>,
    )
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
  })

  it("renders when at least one action is in flight", async () => {
    let resolveInner: () => void = () => {}
    const inner = () =>
      new Promise<void>((resolve) => {
        resolveInner = resolve
      })

    function Probe() {
      const action = useAsyncAction(inner)
      return (
        <button data-testid="go" onClick={() => action.run()}>
          go
        </button>
      )
    }

    const { container, getByTestId } = render(
      <LongRunningProvider>
        <TopProgressBar />
        <Probe />
      </LongRunningProvider>,
    )

    act(() => {
      getByTestId("go").click()
    })

    await waitFor(() => {
      const bar = container.querySelector('[role="progressbar"]')
      expect(bar?.getAttribute("aria-busy")).toBe("true")
    })

    await act(async () => {
      resolveInner()
    })
  })
})

describe("formatElapsed", () => {
  it("formats sub-minute as Xs", () => {
    expect(formatElapsed(0)).toBe("0s")
    expect(formatElapsed(999)).toBe("0s")
    expect(formatElapsed(12_300)).toBe("12s")
  })

  it("formats >= 1 min as Xm YYs", () => {
    expect(formatElapsed(60_000)).toBe("1m 00s")
    expect(formatElapsed(75_500)).toBe("1m 15s")
    expect(formatElapsed(3_725_000)).toBe("62m 05s")
  })
})
