import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { demoData } from "../src/lib/demo";
import {
  csvText,
  excelBuffer,
  exportRows,
  pdfDocument,
} from "../src/lib/exports";
const d = demoData(),
  s = d.schedules[0];
test("Excel reabre como XLSX com 31 dias, vigências e alertas", async () => {
  const bytes = await excelBuffer(s, d.rules, d.companies[0]);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.getWorksheet("Escala")!;
  assert.equal(sheet.rowCount, 32);
  assert.equal(sheet.getCell("A2").value, "2026-12-01");
  assert.equal(sheet.getCell("A32").value, "2026-12-31");
  const summary = book.getWorksheet("Resumo e alertas")!;
  const values = JSON.stringify(summary.getSheetValues());
  assert.ok(values.includes("210"));
  assert.ok(values.includes("220"));
  assert.ok(values.includes("2026-12-15"));
});
test("PDF gera páginas reais incluindo assinatura e 31 datas", async () => {
  const doc = await pdfDocument(s, d.rules, d.companies[0], d.employees[0]);
  const str = doc.output();
  assert.ok(str.startsWith("%PDF-"));
  assert.ok(doc.getNumberOfPages() >= 4);
  assert.ok(str.includes("2026-12-31"));
  assert.ok(str.includes("Respons"));
  assert.ok(str.includes("210"));
});
test("CSV tem 31 dias e neutraliza fórmulas em campos livres", () => {
  assert.equal(exportRows(s, d.rules).length, 31);
  const str = csvText([
    { Nome: '=HYPERLINK("malicioso")', Observação: 'Texto; com "aspas"' },
  ]);
  assert.ok(str.startsWith("\uFEFF"));
  assert.ok(str.includes("\"'=HYPERLINK("));
  assert.ok(str.includes('"Texto; com ""aspas"""'));
});
