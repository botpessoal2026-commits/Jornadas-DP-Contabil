import test from "node:test";
import assert from "node:assert/strict";
import type { Table } from "jspdf-autotable";
import { demoData } from "../src/lib/demo";
import { timesheetDocument } from "../src/lib/timesheet-pdf";

type TimesheetPdf = Awaited<ReturnType<typeof timesheetDocument>>;
function tableOf(doc: TimesheetPdf) {
  return (doc as TimesheetPdf & { lastAutoTable: Table }).lastAutoTable;
}
function pageCommands(doc: TimesheetPdf): string[][] {
  return (doc.internal as unknown as { pages: string[][] }).pages.slice(1);
}
function workHoursHeaders(doc: TimesheetPdf) {
  return pageCommands(doc).flatMap((page) =>
    page.filter((command) => command.includes("Horário de trabalho:")),
  );
}
function assertManualColumns(table: Table) {
  assert.equal(table.columns.length, 9);
  assert.ok(
    !table.head.some((row) =>
      Object.values(row.cells).some((cell) =>
        cell.text.join(" ").includes("Horário previsto"),
      ),
    ),
  );
  for (const row of table.body)
    for (const column of [2, 3, 4, 5, 6, 7])
      assert.deepEqual(row.cells[column].text, [""]);
  assert.ok(table.columns.slice(2, 8).every((column) => column.width >= 20));
  assert.ok(
    Math.abs(
      table.columns.reduce((sum, column) => sum + column.width, 0) - 190,
    ) < 0.1,
  );
}

test("folha A4 mantém 31 dias e marcações livres, com horários somente no cabeçalho", async () => {
  const data = demoData();
  const doc = await timesheetDocument(
    data.schedules[0],
    data.companies[0],
    data.employees[0],
  );
  assert.equal(doc.getNumberOfPages(), 1);
  assert.ok(Math.abs(doc.internal.pageSize.getWidth() - 210) < 0.1);
  assert.ok(Math.abs(doc.internal.pageSize.getHeight() - 297) < 0.1);
  const table = tableOf(doc);
  assert.equal(table.body.length, 31);
  assert.equal(table.body[0].cells[0].text[0], "01");
  assert.equal(table.body[30].cells[0].text[0], "31");
  assertManualColumns(table);
  assert.ok(
    !JSON.stringify(table.body.map((row) => row.raw)).includes("17:24"),
  );
  assert.deepEqual(table.body[5].cells[0].styles.fillColor, [210, 216, 222]);
  assert.deepEqual(table.body[0].cells[0].styles.fillColor, [255, 255, 255]);
  assert.ok(doc.output().startsWith("%PDF-"));
  assert.ok(doc.output().includes("Mariana Costa"));
  assert.ok(doc.output().includes("Aurora Contabilidade"));
  const headers = workHoursHeaders(doc);
  assert.equal(headers.length, 1);
  assert.ok(headers[0].includes("08:00 às 12:00 | 13:00 às 17:24"));
});

test("assinatura única do funcionário fica centralizada entre a tabela e o rodapé", async () => {
  const data = demoData();
  const doc = await timesheetDocument(
    data.schedules[0],
    data.companies[0],
    data.employees[0],
  );
  const pages = pageCommands(doc);
  const label = "Assinatura do funcionário";
  const signatureCommands = pages.flatMap((page) =>
    page.filter((command) => command.includes(`(${label}) Tj`)),
  );
  assert.equal(signatureCommands.length, 1);
  assert.ok(!doc.output().includes("Responsável pela empresa"));
  const finalPage = pages.at(-1)!;
  const signatureIndex = finalPage.indexOf(signatureCommands[0]);
  const number = "(-?\\d+(?:\\.\\d+)?)";
  const lines = [
    ...finalPage
      .slice(0, signatureIndex)
      .join("\n")
      .matchAll(
        new RegExp(
          `${number}\\s+${number}\\s+m\\s+${number}\\s+${number}\\s+l\\s+S`,
          "g",
        ),
      ),
  ];
  const line = lines.at(-1)!;
  assert.ok(line, "a assinatura deve possuir linha para preenchimento manual");
  const scale = doc.internal.scaleFactor;
  const [startX, startY, endX, endY] = line
    .slice(1)
    .map(Number)
    .map((value) => value / scale);
  const pageWidth = doc.internal.pageSize.getWidth();
  const lineY = doc.internal.pageSize.getHeight() - startY;
  assert.ok(Math.abs(startY - endY) < 0.1);
  assert.ok(Math.abs((startX + endX) / 2 - pageWidth / 2) < 0.1);
  assert.ok(endX - startX >= 70);
  assert.ok(lineY > tableOf(doc).finalY! + 8);
  assert.ok(
    lineY + 15 < 291,
    "a assinatura e sua identificação ficam acima do rodapé",
  );
  const position = signatureCommands[0].match(
    new RegExp(`${number}\\s+${number}\\s+Td`),
  )!;
  const labelX = Number(position[1]) / scale;
  const labelWidth = doc.getTextDimensions(label, { fontSize: 8 }).w;
  assert.ok(Math.abs(labelX + labelWidth / 2 - pageWidth / 2) < 0.1);
});

test("cabeçalho reflete jornadas distintas por dia e alterações pontuais sem valores fixos", async () => {
  const data = demoData();
  const schedule = structuredClone(data.schedules[0]);
  for (const day of schedule.dias)
    if (
      day.data.startsWith("2026-12") &&
      new Date(`${day.data}T00:00:00Z`).getUTCDay() === 5 &&
      day.intervalos.length
    )
      day.intervalos[1].end = "16:10";
  const weekly = await timesheetDocument(
    schedule,
    data.companies[0],
    data.employees[0],
  );
  const weeklyHeader = workHoursHeaders(weekly)[0];
  assert.ok(weeklyHeader.includes("Seg"));
  assert.ok(weeklyHeader.includes("Sex"));
  assert.ok(weeklyHeader.includes("16:10"));
  assert.ok(weeklyHeader.includes("17:24"));
  assertManualColumns(tableOf(weekly));
  schedule.dias.find((day) => day.data === "2026-12-01")!.intervalos[1].end =
    "18:10";
  const edited = await timesheetDocument(
    schedule,
    data.companies[0],
    data.employees[0],
  );
  const editedHeader = workHoursHeaders(edited)[0];
  assert.ok(editedHeader.includes("18:10"));
  assert.ok(editedHeader.includes("01/12"));
  assertManualColumns(tableOf(edited));
});

test("folha repete identificação e horários e preserva textos longos e períodos adicionais em páginas extras", async () => {
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
  const company = {
    ...data.companies[0],
    nome:
      "Empresa demonstrativa de servicos profissionais e assessoria empresarial ".repeat(
        3,
      ) + "FIM-DA-EMPRESA",
  };
  const employee = {
    ...data.employees[0],
    nome: "Pessoa com nome demonstrativo extenso ".repeat(3) + "FIM-DO-NOME",
  };
  const doc = await timesheetDocument(schedule, company, employee, {
    preview: true,
  });
  assert.ok(doc.getNumberOfPages() > 1);
  const output = doc.output();
  assert.ok(output.includes("FIM-DA-OBSERVACAO"));
  assert.ok(output.includes("14:00"));
  assert.ok(output.includes("FIM-DA-EMPRESA"));
  assert.ok(output.includes("FIM-DO-NOME"));
  for (const page of pageCommands(doc)) {
    assert.ok(page.some((command) => command.includes("FIM-DA-EMPRESA")));
    assert.ok(page.some((command) => command.includes("FIM-DO-NOME")));
  }
  assert.equal(workHoursHeaders(doc).length, doc.getNumberOfPages());
  assert.equal(output.match(/Assinatura do funcionário/g)?.length, 1);
  assert.ok(!output.includes("Responsável pela empresa"));
  const table = tableOf(doc);
  assert.equal(table.body.length, 31);
  assertManualColumns(table);
  assert.ok(workHoursHeaders(doc).every((header) => header.includes("17:00")));
});
