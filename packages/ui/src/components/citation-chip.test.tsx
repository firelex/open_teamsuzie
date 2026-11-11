import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { CitationChip } from "./citation-chip"

afterEach(() => cleanup())

describe("CitationChip", () => {
  it("flags a citation whose quote was not found in its source", () => {
    render(
      <CitationChip
        id={2}
        docLabel="NDA.docx"
        citation={{ id: 2, doc: "nda", quote: "terminate at will", verification: "not_found" }}
      />,
    )
    expect(
      screen.getByRole("button", { name: "Citation [2] — NDA.docx — quote not found in source" }),
    ).toBeTruthy()
  })

  it("shows a verified citation without the warning", () => {
    render(
      <CitationChip
        id={1}
        docLabel="NDA.docx"
        citation={{ id: 1, doc: "nda", quote: "thirty days", verification: "verified" }}
      />,
    )
    expect(screen.getByRole("button", { name: "Citation [1] — NDA.docx" })).toBeTruthy()
  })
})
