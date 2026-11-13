import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Trash2 } from "lucide-react"

import { RowActions } from "./row-actions.js"

afterEach(() => cleanup())

function openMenu(label: string) {
  // Radix opens the menu from the keyboard as well as the pointer; Enter
  // also moves focus into the menu, as a keyboard user would expect.
  fireEvent.keyDown(screen.getByRole("button", { name: label }), { key: "Enter" })
}

describe("RowActions", () => {
  it("names its trigger, marks destructive items, and runs the chosen action after the menu closes", async () => {
    const order: string[] = []
    const onRemove = vi.fn(() => {
      // The menu must already be gone when the action runs, so a confirm
      // dialog it opens is not stacked on top of an open menu.
      order.push(screen.queryByRole("menu") ? "menu still open" : "menu closed")
    })
    render(
      <RowActions
        triggerLabel="Actions for Bob"
        actions={[
          { id: "edit", label: "Edit", onSelect: vi.fn() },
          { id: "remove", label: "Remove", icon: Trash2, destructive: true, separatorBefore: true, onSelect: onRemove },
        ]}
      />,
    )

    openMenu("Actions for Bob")
    const remove = await screen.findByRole("menuitem", { name: "Remove" })
    expect(remove.getAttribute("data-variant")).toBe("destructive")
    expect(screen.getByRole("menuitem", { name: "Edit" }).getAttribute("data-variant")).toBe("default")
    expect(screen.getByRole("separator")).toBeTruthy()

    fireEvent.click(remove)
    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1))
    expect(order).toEqual(["menu closed"])
  })

  it("does not run a disabled item", async () => {
    const onSelect = vi.fn()
    render(<RowActions triggerLabel="Actions" actions={[{ id: "a", label: "Archive", disabled: true, onSelect }]} />)
    openMenu("Actions")
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
