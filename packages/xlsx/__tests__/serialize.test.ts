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
