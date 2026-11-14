import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { useStickToBottom } from "./use-stick-to-bottom"

let stickRef: (() => void) | null = null

function Chat({ items }: { items: string[] }) {
  const { endRef, stick } = useStickToBottom([items])
  stickRef = stick
  return (
    <div data-testid="box" style={{ overflowY: "auto", height: 100 }}>
      {items.map((i) => (
        <p key={i}>{i}</p>
      ))}
      <div ref={endRef} />
    </div>
  )
}

/** jsdom lays nothing out: the box is 100 px tall and each item 50 px; scrollIntoView goes to the end. */
function fakeLayout(box: HTMLElement) {
  Object.defineProperty(box, "clientHeight", { configurable: true, get: () => 100 })
  Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => box.querySelectorAll("p").length * 50 })
}

const scrolled = vi.fn()
beforeEach(() => {
  scrolled.mockReset()
  Element.prototype.scrollIntoView = function (this: Element) {
    const box = this.parentElement as HTMLElement
    scrolled()
    box.scrollTop = box.scrollHeight - box.clientHeight
  }
})
afterEach(() => cleanup())

describe("useStickToBottom", () => {
  it("follows new items at the bottom, stops when the reader scrolls up, and resumes at the bottom or on stick()", () => {
    const { getByTestId, rerender } = render(<Chat items={["a", "b", "c"]} />)
    const box = getByTestId("box")
    fakeLayout(box)
    rerender(<Chat items={["a", "b", "c", "d"]} />)
    expect(box.scrollTop).toBe(100) // 4 items × 50 − 100

    // The reader scrolls up to read: new items no longer move the view.
    box.scrollTop = 0
    fireEvent.scroll(box)
    scrolled.mockReset()
    rerender(<Chat items={["a", "b", "c", "d", "e"]} />)
    expect(scrolled).not.toHaveBeenCalled()
    expect(box.scrollTop).toBe(0)

    // Back at the bottom (within 80 px), the view follows again.
    box.scrollTop = 120
    fireEvent.scroll(box)
    rerender(<Chat items={["a", "b", "c", "d", "e", "f"]} />)
    expect(box.scrollTop).toBe(200)

    // A small step up (a trackpad), still near the end, stops the following too.
    box.scrollTop = 185
    fireEvent.scroll(box)
    scrolled.mockReset()
    rerender(<Chat items={["a", "b", "c", "d", "e", "f", "f2"]} />)
    expect(scrolled).not.toHaveBeenCalled()
    // Scrolling back down to the end starts it again.
    box.scrollTop = 250
    fireEvent.scroll(box)
    rerender(<Chat items={["a", "b", "c", "d", "e", "f", "f2", "f3"]} />)
    expect(box.scrollTop).toBe(300)
    // A wheel gesture upward stops it before the view moves.
    fireEvent.wheel(box, { deltaY: -40 })
    scrolled.mockReset()
    rerender(<Chat items={["a", "b", "c", "d", "e", "f", "f2", "f3", "f4"]} />)
    expect(scrolled).not.toHaveBeenCalled()

    // Up again, then stick() (the reader sends a message): to the end, and following again.
    box.scrollTop = 10
    fireEvent.scroll(box)
    act(() => stickRef!())
    expect(box.scrollTop).toBe(350)
    rerender(<Chat items={["a", "b", "c", "d", "e", "f", "f2", "f3", "f4", "g"]} />)
    expect(box.scrollTop).toBe(400)
  })
})
