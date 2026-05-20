import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkbook } from "../src/parse.js";
import { walkCells, resolveNamedRange } from "../src/walk.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE = resolve(__dirname, "fixtures/template.xlsx");

describe("walkCells", () => {
  it("invokes the callback for each non-empty cell in the sheet", async () => {
    const wb = await parseWorkbook(readFileSync(FIXTURE));
    const sheet = wb.sheets.find((s) => s.name === "Assumptions")!;
    const seen: string[] = [];
    walkCells(sheet, (c) => seen.push(c.address));
    expect(seen).toContain("A1");
    expect(seen).toContain("B3");
  });
});

describe("resolveNamedRange", () => {
  it("returns the cells of the named range, or [] when not found", async () => {
    const wb = await parseWorkbook(readFileSync(FIXTURE));
    const cells = resolveNamedRange(wb, "AssumptionsBlock");
    expect(cells.length).toBeGreaterThan(0);
    expect(resolveNamedRange(wb, "DoesNotExist")).toEqual([]);
  });
});
