import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { ConfirmDialogProvider, useConfirm } from "./confirm-dialog.js"

afterEach(() => cleanup())

function AskButton() {
  const confirm = useConfirm()
  return (
    <button type="button" onClick={() => void confirm({ title: "Remove Bob?" })}>
      Remove Bob
    </button>
  )
}

describe("ConfirmDialogProvider", () => {
  it("hands focus back to the element that asked once the dialog closes", async () => {
    render(
      <ConfirmDialogProvider>
        <AskButton />
      </ConfirmDialogProvider>,
    )
    const ask = screen.getByRole("button", { name: "Remove Bob" })
    ask.focus()
    fireEvent.click(ask)
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(ask))
  })
})
