import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkbook } from "../src/parse.js";
import { serializeForLLM } from "../src/serialize.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SAMPLE = resolve(__dirname, "fixtures/formatting-sample.xlsx");

describe("serializeForLLM", () => {
  it("emits a sheet header for each non-empty sheet", async () => {
    const wb = await parseWorkbook(readFileSync(SAMPLE));
    const out = serializeForLLM(wb);
    expect(out).toMatch(/=== Sheet: Sheet1 ===/);
  });

  it("includes value, formula, and formatting for each cell", async () => {
    const wb = await parseWorkbook(readFileSync(SAMPLE));
    const out = serializeForLLM(wb);
    expect(out).toContain("A1");
    expect(out).toMatch(/1234\.5/);
    expect(out).toMatch(/fill=#FFFACD/);
    expect(out).toMatch(/font=#0000FF/);
    expect(out).toMatch(/bold/);
    expect(out).toMatch(/B1.*formula='A1\*2'/);
  });

  it("skips empty cells", async () => {
    const wb = await parseWorkbook(readFileSync(SAMPLE));
    const out = serializeForLLM(wb);
    expect(out).not.toMatch(/^A4:/m);
  });

  it("is deterministic — same input produces same output", async () => {
    const wb = await parseWorkbook(readFileSync(SAMPLE));
    const a = serializeForLLM(wb);
    const b = serializeForLLM(wb);
    expect(a).toBe(b);
  });
});

describe("serializeForLLM — token cap", () => {
  it("emits rich format when output fits within cap", async () => {
    const wb = await parseWorkbook(readFileSync(SAMPLE));
    const out = serializeForLLM(wb, { tokenCap: 10000 });
    expect(out).toMatch(/fill=#FFFACD/);
  });

  it("falls back to tight format when rich exceeds cap", async () => {
    const wb = await parseWorkbook(readFileSync(SAMPLE));
    const out = serializeForLLM(wb, { tokenCap: 1 });
    expect(out).not.toMatch(/fill=/);
    expect(out).not.toMatch(/font=/);
    expect(out).toMatch(/\[\.\.\. truncated, \d+ more cells\]/);
  });
});

describe("serializeForLLM — hard truncation", () => {
  it("emits a truncation marker when output exceeds the cap", async () => {
    const wb = await parseWorkbook(readFileSync(SAMPLE));
    // Cap of 1 token ≈ 4 chars — way below the smallest cell line.
    const out = serializeForLLM(wb, { tokenCap: 1 });
    expect(out).toMatch(/\[\.\.\. truncated, \d+ more cells\]/);
  });

  it("hard-truncation count is plausible (≤ total cells in workbook)", async () => {
    const wb = await parseWorkbook(readFileSync(SAMPLE));
    const totalCells = wb.sheets.reduce((sum, s) => sum + s.cells.length, 0);
    const out = serializeForLLM(wb, { tokenCap: 1 });
    const match = out.match(/\[\.\.\. truncated, (\d+) more cells\]/);
    expect(match).not.toBeNull();
    const reported = parseInt(match![1], 10);
    expect(reported).toBeLessThanOrEqual(totalCells);
    expect(reported).toBeGreaterThan(0);
  });
});
