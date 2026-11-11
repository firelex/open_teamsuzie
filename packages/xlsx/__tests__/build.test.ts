import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildWorkbook } from "../src/build.js";
import { parseWorkbook } from "../src/parse.js";

describe("buildWorkbook", () => {
  it("writes sheets that parse back with headers, values and formats", async () => {
    const bytes = await buildWorkbook({
      sheets: [
        {
          name: "Deal: terms/fees",
          columns: [
            { header: "Party", format: "text" },
            { header: "Fee", format: "currency", currency: "GBP" },
            { header: "Signed", format: "date" },
          ],
          rows: [
            ["Acme Ltd", 125000, "2026-03-01"],
            ["Widget plc", null, null],
          ],
        },
        { name: "Deal: terms/fees", columns: [{ header: "Note" }], rows: [["second sheet, same name"]] },
      ],
    });
    const wb = await parseWorkbook(bytes);
    expect(wb.sheets.map((s) => s.name)).toEqual(["Deal  terms fees", "Deal  terms fees (2)"]);
    const cells = wb.sheets[0]!.cells;
    const at = (address: string) => cells.find((c) => c.address === address);
    expect(at("A1")?.value).toBe("Party");
    expect(at("A1")?.bold).toBe(true);
    expect(at("B2")?.value).toBe(125000);
    expect(at("C2")?.type).toBe("date");
    const raw = new ExcelJS.Workbook();
    await raw.xlsx.load(bytes);
    expect(raw.worksheets[0]!.getCell("B2").numFmt).toContain("£");
  });

  it("refuses rows that do not match the column count", async () => {
    await expect(
      buildWorkbook({ sheets: [{ name: "S", columns: [{ header: "A" }, { header: "B" }], rows: [["only one"]] }] }),
    ).rejects.toThrow(/row 1 has 1 values but there are 2 columns/);
  });
});
