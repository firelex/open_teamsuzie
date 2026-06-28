import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { TagInput } from "./tag-input.js"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function ControlledTagInput(props: Omit<React.ComponentProps<typeof TagInput>, "value" | "onChange"> & { initial?: readonly string[] }) {
  const [value, setValue] = React.useState<readonly string[]>(props.initial ?? [])
  const { initial: _initial, ...rest } = props
  void _initial
  return <TagInput {...rest} value={value} onChange={setValue} />
}

describe("TagInput", () => {
  it("adds a chip on Enter", () => {
    render(<ControlledTagInput />)
    const input = screen.getByTestId("tag-input-input") as HTMLInputElement
    fireEvent.change(input, { target: { value: "alpha" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(screen.getAllByTestId("tag-input-chip")).toHaveLength(1)
    expect(screen.getByText("alpha")).toBeTruthy()
    expect(input.value).toBe("")
  })

  it("adds a chip on comma typed mid-input", () => {
    render(<ControlledTagInput />)
    const input = screen.getByTestId("tag-input-input") as HTMLInputElement
    fireEvent.change(input, { target: { value: "alpha," } })
    // The comma-in-value path splits "alpha" into a chip and keeps "" in the
    // input — same behaviour as a paste of "alpha,".
    expect(screen.getAllByTestId("tag-input-chip")).toHaveLength(1)
    expect(input.value).toBe("")
  })

  it("splits a pasted CSV value into multiple chips", () => {
    render(<ControlledTagInput />)
    const input = screen.getByTestId("tag-input-input") as HTMLInputElement
    fireEvent.change(input, { target: { value: "a, b, c" } })
    expect(screen.getAllByTestId("tag-input-chip")).toHaveLength(2)
    expect(input.value).toBe(" c")
  })

  it("dedupes case-insensitively by default", () => {
    render(<ControlledTagInput initial={["Acme"]} />)
    const input = screen.getByTestId("tag-input-input") as HTMLInputElement
    fireEvent.change(input, { target: { value: "ACME" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(screen.getAllByTestId("tag-input-chip")).toHaveLength(1)
  })

  it("respects maxTags", () => {
    render(<ControlledTagInput initial={["a", "b"]} maxTags={2} />)
    const input = screen.getByTestId("tag-input-input") as HTMLInputElement
    fireEvent.change(input, { target: { value: "c" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(screen.getAllByTestId("tag-input-chip")).toHaveLength(2)
  })

  it("removes trailing chip on Backspace when input is empty", () => {
    render(<ControlledTagInput initial={["a", "b"]} />)
    const input = screen.getByTestId("tag-input-input") as HTMLInputElement
    fireEvent.keyDown(input, { key: "Backspace" })
    const chips = screen.getAllByTestId("tag-input-chip")
    expect(chips).toHaveLength(1)
    expect(screen.getByText("a")).toBeTruthy()
  })

  it("does not remove chips on Backspace when input has text", () => {
    render(<ControlledTagInput initial={["a", "b"]} />)
    const input = screen.getByTestId("tag-input-input") as HTMLInputElement
    fireEvent.change(input, { target: { value: "x" } })
    fireEvent.keyDown(input, { key: "Backspace" })
    expect(screen.getAllByTestId("tag-input-chip")).toHaveLength(2)
  })

  it("removes a chip via its X button", () => {
    render(<ControlledTagInput initial={["a", "b", "c"]} />)
    const removeB = screen.getByLabelText("Remove b")
    fireEvent.click(removeB)
    const chips = screen.getAllByTestId("tag-input-chip")
    expect(chips).toHaveLength(2)
    expect(screen.queryByText("b")).toBeNull()
  })

  it("commits the in-progress draft on blur", () => {
    render(<ControlledTagInput />)
    const input = screen.getByTestId("tag-input-input") as HTMLInputElement
    fireEvent.change(input, { target: { value: "alpha" } })
    fireEvent.blur(input)
    expect(screen.getAllByTestId("tag-input-chip")).toHaveLength(1)
  })

})
