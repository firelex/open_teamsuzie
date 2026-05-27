import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkbook } from "../src/parse.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SAMPLE = resolve(__dirname, "fixtures/formatting-sample.xlsx");

describe("parseWorkbook — formatting metadata", () => {
  it("extracts fill, fontColor, and bold from styled cells", async () => {
    const wb = await parseWorkbook(readFileSync(SAMPLE));
    const sheet = wb.sheets.find((s) => s.name === "Sheet1")!;
    const cellAt = (addr: string) => sheet.cells.find((c) => c.address === addr)!;

    const a1 = cellAt("A1");
    expect(a1.value).toBe(1234.5);
    expect(a1.fill?.toUpperCase()).toBe("#FFFACD");
    expect(a1.fontColor?.toUpperCase()).toBe("#0000FF");
    expect(a1.bold).toBe(true);

    const a2 = cellAt("A2");
    expect(a2.value).toBe("plain text");
    expect(a2.fill).toBeUndefined();
    expect(a2.fontColor).toBeUndefined();
    expect(a2.bold).toBeFalsy();

    const a3 = cellAt("A3");
    expect(a3.bold).toBe(true);
    expect(a3.fill).toBeUndefined();
  });
});
