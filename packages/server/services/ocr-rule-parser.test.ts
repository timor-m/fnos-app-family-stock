import assert from "node:assert/strict";
import test from "node:test";
import { parseOcrLines } from "./ocr-rule-parser.ts";

test("extracts Chinese dates, shelf life and computes expiration", () => {
  const result = parseOcrLines("image_1", [
    { id: "line_1", text: "生产日期：2026年07月20日", confidence: 0.98 },
    { id: "line_2", text: "保质期 十二 个月", confidence: 0.96 },
    { id: "line_3", text: "净含量：250 mL", confidence: 0.95 }
  ]);

  assert.deepEqual(
    Object.fromEntries(result.map((item) => [item.fieldKey, item.value])),
    {
      productionDate: "2026-07-20",
      shelfLife: { value: 12, unit: "month" },
      specification: "250mL",
      expirationDate: "2027-07-20"
    }
  );
});

test("extracts compact EXP date and keeps explicit expiration", () => {
  const result = parseOcrLines("image_2", [
    { id: "line_1", text: "MFG 20260720", confidence: 0.92 },
    { id: "line_2", text: "EXP 2027/01/05", confidence: 0.99 },
    { id: "line_3", text: "保质期180天", confidence: 0.91 }
  ]);

  assert.equal(result.find((item) => item.fieldKey === "productionDate")?.value, "2026-07-20");
  assert.equal(result.find((item) => item.fieldKey === "expirationDate")?.value, "2027-01-05");
});

test("extracts product name from label product-name line", () => {
  const result = parseOcrLines("image_label", [
    {
      id: "line_1",
      text: "产品名称：东方树叶茉莉花茶原味茶饮料保质期：",
      confidence: 1
    },
    { id: "line_2", text: "9个月生产日期：见瓶体", confidence: 0.99 }
  ]);

  assert.equal(result.find((item) => item.fieldKey === "name")?.value, "东方树叶茉莉花茶原味茶饮料");
});

test("infers bare compact date from production-date image role", () => {
  const result = parseOcrLines(
    "image_date",
    [{ id: "line_1", text: "20250913 113233 HY6b", confidence: 0.95 }],
    { imageRole: "date" }
  );

  const productionDate = result.find((item) => item.fieldKey === "productionDate");
  assert.equal(productionDate?.value, "2025-09-13");
  assert.ok(Math.abs((productionDate?.confidence || 0) - 0.779) < 0.001);
});

test("does not infer date fields for a non-expiring category", () => {
  const result = parseOcrLines(
    "image_3",
    [
      { id: "line_1", text: "生产日期：2026-07-20", confidence: 0.98 },
      { id: "line_2", text: "规格：500g", confidence: 0.95 }
    ],
    { expirationEnabled: false }
  );

  assert.deepEqual(result.map((item) => item.fieldKey), ["specification"]);
});

test("clamps month-end and leap-day shelf life calculations", () => {
  const monthEnd = parseOcrLines("image_4", [
    { id: "line_1", text: "生产日期 2025-01-31", confidence: 0.99 },
    { id: "line_2", text: "保质期1个月", confidence: 0.99 }
  ]);
  const leapDay = parseOcrLines("image_5", [
    { id: "line_1", text: "生产日期 2024-02-29", confidence: 0.99 },
    { id: "line_2", text: "保质期1年", confidence: 0.99 }
  ]);

  assert.equal(monthEnd.find((item) => item.fieldKey === "expirationDate")?.value, "2025-02-28");
  assert.equal(leapDay.find((item) => item.fieldKey === "expirationDate")?.value, "2025-02-28");
});
