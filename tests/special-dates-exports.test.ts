import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import type { Table } from "jspdf-autotable";
import { demoData } from "../src/lib/demo";
import {
  csvText,
  excelBuffer,
  exportRows,
  pdfDocument,
} from "../src/lib/exports";
import { buildTimesheet } from "../src/lib/timesheet";
import { timesheetDocument } from "../src/lib/timesheet-pdf";
import { projectSchedule, specialDateTotals } from "../src/lib/special-dates";
import type { DayException, Schedule, SpecialDate } from "../src/lib/types";

const data = demoData();
const company = data.companies[0];
const employee = data.employees[0];
const shifts = [
  { start: "08:00", end: "12:00" },
  { start: "13:00", end: "17:24" },
];

function event(change: Partial<SpecialDate>): SpecialDate {
  return {
    id: "data-especial",
    empresa_id: company.id,
    estabelecimento_id: null,
    nome: "Data cadastrada pela empresa",
    data_inicio: "2026-12-01",
    data_fim: null,
    categoria: "ponto_facultativo",
    alcance: "empresa",
    funcionario_ids: [],
    recorrencia: "unica",
    expediente: "normal",
    intervalos: [],
    observacoes: "Programação administrativa",
    ativo: true,
    data_movel: false,
    uf: null,
    cidade: null,
    ...change,
  };
}

function exception(schedule: Schedule, date: string, value: DayException) {
  const day = schedule.dias.find((entry) => entry.data === date)!;
  day.calendario = {
    base: {
      intervalos: structuredClone(day.intervalos),
      folga: day.folga,
      feriado: day.feriado,
      observacao: day.observacao,
    },
    excecao: value,
  };
}

function example() {
  const source = structuredClone(data.schedules[0]);
  exception(source, "2026-12-03", {
    categoria: "feriado",
    nome: "Feriado com atendimento individual",
    expediente: "normal",
    intervalos: shifts,
    observacao: "Atendimento previsto no calendário",
  });
  exception(source, "2026-12-28", {
    categoria: "trabalho",
    nome: "Plantão durante o recesso",
    expediente: "normal",
    intervalos: shifts,
    observacao: "Exceção individual preservada",
  });
  exception(source, "2026-12-07", {
    categoria: "sem_expediente",
    nome: "Decisão administrativa individual",
    expediente: "sem_expediente",
    intervalos: [],
    observacao: "Dispensa de expediente",
  });
  const events = [
    event({
      id: "normal",
      nome: "Ponto facultativo com atendimento",
      data_inicio: "2026-12-01",
    }),
    event({
      id: "off",
      nome: "Ponto facultativo sem expediente",
      data_inicio: "2026-12-02",
      expediente: "sem_expediente",
    }),
    event({
      id: "holiday",
      nome: "Feriado empresarial",
      data_inicio: "2026-12-03",
      categoria: "feriado_especifico",
      expediente: "sem_expediente",
    }),
    event({
      id: "recess",
      nome: "Recesso de final de ano",
      data_inicio: "2026-12-24",
      data_fim: "2026-12-31",
      recorrencia: "periodo",
      categoria: "recesso",
      expediente: "sem_expediente",
    }),
    event({
      id: "reduced",
      nome: "Expediente reduzido pela empresa",
      data_inicio: "2026-12-08",
      expediente: "reduzido",
      intervalos: [{ start: "08:00", end: "12:00" }],
    }),
    event({
      id: "rest",
      nome: "Feriado coincidente com folga",
      data_inicio: "2026-12-05",
      categoria: "feriado_especifico",
      expediente: "normal",
    }),
  ];
  return projectSchedule(source, company, employee, events, [], data.holidays);
}

test("CSV e Excel identificam eventos e expedientes, preservando as colunas e horários anteriores", async () => {
  const schedule = example();
  const before = structuredClone(schedule);
  const rows = exportRows(schedule, data.rules, employee, company);
  assert.deepEqual(Object.keys(rows[0]).slice(0, 7), [
    "Data",
    "Carga contratual semanal",
    "Horário",
    "Feriado",
    "Horas relógio",
    "Horas computadas",
    "Observação",
  ]);
  assert.equal(rows.length, 31);
  assert.equal(rows[0].Empresa, company.nome);
  assert.equal(rows[0].Funcionário, employee.nome);
  assert.match(rows[0]["Tipo do dia"], /Ponto facultativo/i);
  assert.equal(rows[0]["Horas programadas"], "8h24");
  assert.equal(rows[1]["Horas programadas"], "0h00");
  assert.equal(rows[1].Horário, "Sem expediente");
  assert.match(rows[2]["Tipo do dia"], /Feriado trabalhado/i);
  assert.match(rows[2].Evento, /Feriado empresarial/);
  assert.equal(rows[2]["Horas programadas em feriados"], "8h24");
  assert.equal(rows[4]["Horas programadas"], "0h00");
  assert.equal(rows[6]["Horas programadas"], "0h00");
  assert.equal(rows[7]["Horas programadas"], "4h00");
  assert.match(rows[24].Evento, /Natal/);
  assert.match(rows[24].Evento, /Recesso de final de ano/);
  assert.equal(rows[24]["Horas programadas"], "0h00");
  assert.equal(rows[27]["Horas programadas"], "8h24");
  const csv = csvText(rows);
  for (const text of [
    company.nome,
    employee.nome,
    "Ponto facultativo",
    "Recesso de final de ano",
    "Feriado trabalhado",
    "Horas programadas em feriados",
  ])
    assert.ok(csv.includes(text));
  assert.ok(!csv.includes("Pagamento em dobro"));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    await excelBuffer(schedule, data.rules, company, employee),
  );
  const sheet = book.getWorksheet("Escala")!;
  assert.equal(sheet.getCell("A2").value, "2026-12-01");
  assert.equal(sheet.getCell("C2").value, "08:00–12:00 / 13:00–17:24");
  assert.equal(sheet.getCell("H2").value, company.nome);
  const summary = JSON.stringify(
    book.getWorksheet("Resumo e alertas")!.getSheetValues(),
  );
  for (const text of [
    "Feriados trabalhados",
    "Horas programadas em feriados",
    "Dias de recesso",
    "Outros dias sem expediente",
  ])
    assert.ok(summary.includes(text));
  assert.deepEqual(schedule, before);
});

test("horas de feriado noturno usam a data civil e a duração de relógio sem duplicar eventos coincidentes", () => {
  const source = structuredClone(data.schedules[0]);
  for (const day of source.dias) {
    day.intervalos = [];
    day.folga = true;
    day.feriado = null;
  }
  source.dias.find((day) => day.data === "2026-12-01")!.intervalos = [
    { start: "22:00", end: "05:00", endDay: 1 },
  ];
  source.dias.find((day) => day.data === "2026-12-01")!.folga = false;
  const schedule = projectSchedule(
    source,
    company,
    employee,
    [
      event({
        id: "night1",
        nome: "Feriado noturno",
        data_inicio: "2026-12-02",
        categoria: "feriado_especifico",
      }),
      event({
        id: "night2",
        nome: "Outra identificação na mesma data",
        data_inicio: "2026-12-02",
        categoria: "feriado_nacional",
      }),
    ],
    [],
    [],
  );
  const totals = specialDateTotals(schedule, data.rules);
  assert.equal(totals.holidays, 1);
  assert.equal(totals.workingHolidays, 1);
  assert.equal(totals.holidayMinutes, 300);
  const row = exportRows(schedule, data.rules, employee, company)[1];
  assert.equal(row["Horas programadas em feriados"], "5h00");
  assert.equal(row["Horas programadas"], "5h00");
  assert.notEqual(row["Horas computadas"], row["Horas programadas"]);
  assert.equal(row.Horário, "Continuação do turno anterior");
});

test("folha de ponto mantém marcações livres e diferencia feriado trabalhado, recesso e dispensa", async () => {
  const schedule = example();
  const built = buildTimesheet(schedule, company, employee);
  assert.equal(built.rows[0].rest, false);
  assert.equal(built.rows[0].crossed, false);
  assert.match(built.rows[0].observation, /Ponto facultativo/);
  assert.equal(built.rows[1].rest, true);
  assert.equal(built.rows[1].crossed, true);
  assert.equal(built.rows[2].workingHoliday, true);
  assert.equal(built.rows[2].shaded, true);
  assert.equal(built.rows[2].crossed, false);
  assert.match(built.rows[24].observation, /Natal/);
  assert.match(built.rows[24].observation, /Recesso de final de ano/);
  assert.equal(built.rows[24].crossed, true);
  assert.equal(built.rows[27].rest, false);
  assert.equal(built.rows[27].crossed, false);
  const doc = await timesheetDocument(schedule, company, {
    ...employee,
    cpf: "12345678909",
  });
  const table = (doc as typeof doc & { lastAutoTable: Table }).lastAutoTable;
  assert.equal(table.columns.length, 9);
  assert.equal(table.body.length, 31);
  for (const row of table.body) {
    for (const col of [2, 3, 4, 5, 6, 7])
      assert.deepEqual(row.cells[col].text, [""]);
    for (const cell of Object.values(row.cells)) {
      assert.ok(cell.x >= 9.9);
      assert.ok(cell.x + cell.width <= 200.1);
    }
  }
  assert.deepEqual(table.body[1].cells[0].styles.fillColor, [210, 216, 222]);
  assert.deepEqual(table.body[2].cells[0].styles.fillColor, [210, 216, 222]);
  assert.deepEqual(table.body[0].cells[0].styles.fillColor, [255, 255, 255]);
  const output = doc.output();
  assert.ok(output.startsWith("%PDF-"));
  assert.ok(output.includes("123.456.789-09"));
  assert.equal(output.match(/Assinatura do funcionário/g)?.length, 1);
  assert.ok(!output.includes("Responsável pela empresa"));
});

test("PDF da escala contém natureza, eventos, totalizadores e alertas sem alterar o planejamento", async () => {
  const schedule = example();
  const before = structuredClone(schedule);
  const doc = await pdfDocument(schedule, data.rules, company, employee);
  const output = doc.output();
  assert.ok(output.startsWith("%PDF-"));
  assert.ok(doc.getNumberOfPages() >= 4);
  for (const text of [
    "Recesso de final de ano",
    "Ponto facultativo",
    "Feriado trabalhado",
    "Horas programadas em feriados",
    "2026-12-31",
  ])
    assert.ok(output.includes(text), `PDF deve conter ${text}`);
  assert.deepEqual(schedule, before);
});

test("calendário legado mantém valores e estrutura original das sete colunas existentes", () => {
  const schedule = structuredClone(data.schedules[0]);
  const rows = exportRows(schedule, data.rules, employee);
  assert.equal(rows[0].Horário, "08:00–12:00 / 13:00–17:24");
  assert.equal(rows[24].Horário, "Folga");
  assert.equal(rows[24].Feriado, "Natal");
  assert.equal(rows[24]["Horas relógio"], "0h00");
  assert.equal(rows[24]["Horas computadas"], "0h00");
  assert.equal(
    buildTimesheet(schedule, company, employee).rows[24].observation,
    "Feriado: Natal",
  );
});
