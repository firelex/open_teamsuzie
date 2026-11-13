import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import { DataTable, type Column } from "./data-table.js"

afterEach(() => cleanup())

interface Row {
  id: string
  name: string
  email: string
}

const rows: Row[] = [{ id: "1", name: "Ann", email: "ann@firm.test" }]

const columns: Column<Row>[] = [
  { key: "name", header: "Name", render: (r) => r.name },
  { key: "email", header: "Email", className: "hidden md:table-cell", render: (r) => r.email },
]

describe("DataTable", () => {
  it("puts a column's className on its header and its cells", () => {
    render(<DataTable data={rows} columns={columns} getRowKey={(r) => r.id} />)
    expect(screen.getByRole("columnheader", { name: "Email" }).className).toContain("hidden md:table-cell")
    expect(screen.getByRole("cell", { name: "ann@firm.test" }).className).toContain("hidden md:table-cell")
    expect(screen.getByRole("columnheader", { name: "Name" }).className).not.toContain("hidden")
  })

  it("labels the actions column in English by default and takes a custom header", () => {
    const { rerender } = render(
      <DataTable data={rows} columns={columns} getRowKey={(r) => r.id} renderActions={() => <button>Go</button>} />,
    )
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeTruthy()

    rerender(
      <DataTable
        data={rows}
        columns={columns}
        getRowKey={(r) => r.id}
        renderActions={() => <button>Go</button>}
        actionsHeader={<span className="sr-only">Row actions</span>}
      />,
    )
    expect(screen.getByRole("columnheader", { name: "Row actions" })).toBeTruthy()
  })
})
