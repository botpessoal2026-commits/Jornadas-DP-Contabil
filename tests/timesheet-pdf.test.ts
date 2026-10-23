import test from "node:test";
import assert from "node:assert/strict";
import type { Table } from "jspdf-autotable";
import { demoData } from "../src/lib/demo";
import { timesheetDocument } from "../src/lib/timesheet-pdf";

test("folha de ponto A4 mantém 31 dias, campos livres e folgas escuras em uma página", async () => {
  const data = demoData();
  const doc = await timesheetDocument(
    data.schedules[0],
    data.companies[0],
    data.employees[0],
  );
  assert.equal(doc.getNumberOfPages(), 1);
  assert.ok(Math.abs(doc.internal.pageSize.getWidth() - 210) < 0.1);
  assert.ok(Math.abs(doc.internal.pageSize.getHeight() - 297) < 0.1);
  const table = (doc as typeof doc & { lastAutoTable: Table }).lastAutoTable;
  assert.equal(table.body.length, 31);
  assert.equal(table.body[0].cells[0].text[0], "01");
  assert.equal(table.body[30].cells[0].text[0], "31");
  assert.ok(table.body[0].cells[2].text.join(" ").includes("17:24"));
  for (const column of [3, 4, 5, 6, 7, 8])
    assert.deepEqual(table.body[0].cells[column].text, [""]);
  assert.deepEqual(table.body[5].cells[0].styles.fillColor, [210, 216, 222]);
  assert.deepEqual(table.body[0].cells[0].styles.fillColor, [255, 255, 255]);
  assert.ok(doc.output().startsWith("%PDF-"));
  assert.ok(doc.output().includes("Mariana Costa"));
  assert.ok(doc.output().includes("Aurora Contabilidade"));
});

test("folha repete identificação e continua páginas sem cortar observações ou períodos adicionais", async () => {
  const data = demoData();
  const schedule = structuredClone(data.schedules[0]);
  const day = schedule.dias.find((entry) => entry.data === "2026-12-01")!;
  day.intervalos = [
    { start: "06:00", end: "09:00" },
    { start: "10:00", end: "13:00" },
    { start: "14:00", end: "17:00" },
  ];
  for (const entry of schedule.dias)
    entry.observacao =
      "Observacao detalhada preservada. ".repeat(9) + "FIM-DA-OBSERVACAO";
  const doc = await timesheetDocument(
    schedule,
    data.companies[0],
    data.employees[0],
    { preview: true },
  );
  assert.ok(doc.getNumberOfPages() > 1);
  const output = doc.output();
  assert.ok(output.includes("FIM-DA-OBSERVACAO"));
  assert.ok(output.includes("14:00"));
  assert.equal(
    output.match(/Empresa: Aurora Contabilidade/g)?.length,
    doc.getNumberOfPages(),
  );
  assert.equal(
    output.match(/rio: Mariana Costa/g)?.length,
    doc.getNumberOfPages(),
  );
  const table = (doc as typeof doc & { lastAutoTable: Table }).lastAutoTable;
  assert.equal(table.body.length, 31);
  assert.ok(table.body[0].cells[2].text.join(" ").includes("17:00"));
});
