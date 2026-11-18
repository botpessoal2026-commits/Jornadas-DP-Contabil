import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { demoData } from "../src/lib/demo";
import { generateDays } from "../src/lib/engine";
import { buildScheduleSnapshot } from "../src/lib/schedule-governance";
import {
  buildWorkRestReport,
  workRestCandidates,
  workRestTotals,
  workRestCSV,
  workRestDetails,
  workRestExcel,
  workRestPDF,
} from "../src/lib/work-rest-report";

function fixture() {
  const data = demoData();
  data.holidays = [];
  data.specialDates = [];
  const model = {
    ...data.models[0],
    id: "cycle",
    tipo: "12x36" as const,
    ciclo_inicio: "2027-01-01",
    turno: [
      { start: "07:00", end: "12:00" },
      { start: "13:00", end: "19:00" },
    ],
  };
  data.models.push(model);
  data.schedules = [
    {
      ...data.schedules[0],
      modelo_id: model.id,
      modelo_tipo: model.tipo,
      mes: "2027-01-01",
      status: "rascunho",
      revisao: 1,
      dias: generateDays("2027-01", model, data.companies[0], [], false),
    },
  ];
  return data;
}
test("relatório conta 16 plantões e 15 folgas no mês de 31 dias e mantém status e datas", async () => {
  const data = fixture();
  const rows = await buildWorkRestReport(data, "2027-01", data.companies[0].id);
  const totals = workRestTotals(rows[0]);
  assert.equal(totals.work.length, 16);
  assert.equal(totals.rest.length, 15);
  assert.equal(totals.starts, 16);
  assert.equal(totals.hours, "176h00");
  assert.deepEqual(totals.rest.slice(0, 3), [
    "2027-01-02",
    "2027-01-04",
    "2027-01-06",
  ]);
  assert.equal(rows[0].status, "Rascunho");
  assert.equal(rows[0].revision, "1");
});
test("funcionário sem escala e dia ausente não se transformam em folga", async () => {
  const data = fixture();
  data.employees.push({
    ...data.employees[0],
    id: "without-schedule",
    nome: "Sem programação",
  });
  data.schedules[0].dias = data.schedules[0].dias.filter(
    (day) => day.data !== "2027-01-02",
  );
  const rows = await buildWorkRestReport(data, "2027-01", data.companies[0].id);
  assert.equal(
    workRestTotals(rows.find((row) => row.employeeId === "without-schedule")!)
      .missing.length,
    31,
  );
  assert.equal(
    workRestTotals(rows.find((row) => row.employeeId === data.employees[0].id)!)
      .rest.length,
    14,
  );
  assert.equal(
    workRestTotals(rows.find((row) => row.employeeId === data.employees[0].id)!)
      .missing.length,
    1,
  );
});
test("relatório respeita empresa, pessoa selecionada, competência e rejeita vínculo cruzado", async () => {
  const data = fixture();
  assert.equal((await buildWorkRestReport(data, "2027-01", null)).length, 2);
  assert.throws(
    () =>
      workRestCandidates(data, data.companies[0].id, [data.employees[1].id]),
    /fora deste contexto/,
  );
  assert.throws(() => workRestCandidates(data, "inexistente"), /indisponível/);
  await assert.rejects(
    buildWorkRestReport(data, "2027-13", null),
    /competência/,
  );
  assert.equal(
    (await buildWorkRestReport(data, "2027-02", data.companies[0].id))[0]
      .status,
    "Sem escala",
  );
});
test("recesso em dia útil é outro sem expediente, não folga; feriado na folga preserva sua natureza", async () => {
  const data = fixture(),
    days = data.schedules[0].dias;
  const rest = days.find((day) => day.data === "2027-01-02")!;
  rest.feriado = "Feriado coincidente";
  rest.calendario = {
    base: {
      intervalos: [],
      folga: true,
      feriado: rest.feriado,
      observacao: "",
    },
  };
  data.specialDates = [
    {
      id: "recess",
      empresa_id: data.companies[0].id,
      estabelecimento_id: null,
      nome: "Recesso",
      categoria: "recesso",
      data_inicio: "2027-01-05",
      data_fim: null,
      alcance: "empresa",
      funcionario_ids: [],
      recorrencia: "unica",
      expediente: "sem_expediente",
      intervalos: [],
      observacoes: "",
      ativo: true,
      data_movel: false,
      uf: null,
      cidade: null,
    },
  ];
  const row = (
    await buildWorkRestReport(data, "2027-01", data.companies[0].id)
  )[0];
  assert.equal(
    row.days.find((day) => day.date === "2027-01-05")!.state,
    "other",
  );
  assert.equal(
    row.days.find((day) => day.date === "2027-01-02")!.state,
    "rest",
  );
});
test("turno noturno separa inícios de plantão de dias civis com continuação", async () => {
  const data = fixture(),
    model = data.models.find((entry) => entry.id === "cycle")!;
  model.turno = [
    { start: "19:00", end: "00:00", endDay: 1 },
    { start: "01:00", end: "07:00", startDay: 1, endDay: 1 },
  ];
  data.schedules[0].dias = generateDays(
    "2027-01",
    model,
    data.companies[0],
    [],
    true,
  );
  const row = (
    await buildWorkRestReport(data, "2027-01", data.companies[0].id)
  )[0];
  const totals = workRestTotals(row);
  assert.equal(totals.starts, 16);
  assert.equal(totals.work.length, 31);
  assert.match(row.days[1].shift, /Continuação/);
  assert.equal(row.days[1].starts, false);
});
test("publicação mantém nomes e dias congelados mesmo após alterações cadastrais", async () => {
  const data = fixture(),
    schedule = data.schedules[0];
  schedule.status = "publicada";
  data.scheduleVersions = [
    {
      id: "version",
      escala_id: schedule.id,
      empresa_id: schedule.empresa_id,
      revisao: 1,
      versao: 1,
      publicado_em: "2027-01-01T00:00:00Z",
      publicado_por: "owner",
      justificativa: "",
      snapshot: buildScheduleSnapshot(data, structuredClone(schedule)),
    },
  ];
  data.employees[0].nome = "Nome atual diferente";
  data.companies[0].nome = "Empresa alterada";
  data.schedules[0].dias = [];
  const row = (
    await buildWorkRestReport(data, "2027-01", data.companies[0].id)
  )[0];
  assert.equal(row.employee, "Mariana Costa");
  assert.equal(row.company, "Aurora Contabilidade");
  assert.equal(workRestTotals(row).work.length, 16);
});
test("CSV, Excel e PDF preservam funcionário, status, competência, datas e totais", async () => {
  const data = fixture();
  data.employees[0].cpf = "52998224725";
  const rows = await buildWorkRestReport(data, "2027-01", data.companies[0].id);
  const csv = workRestCSV(rows);
  assert.match(csv, /Mariana Costa/);
  assert.match(csv, /02\/01\/2027/);
  assert.match(csv, /Rascunho/);
  assert.ok(!csv.includes(data.employees[0].cpf));
  assert.equal(workRestDetails(rows).length, 31);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await workRestExcel(rows)) as never);
  assert.equal(book.getWorksheet("Resumo")!.getRow(2).getCell(7).value, "16");
  assert.equal(book.getWorksheet("Dias e horários")!.rowCount, 32);
  const pdf = await workRestPDF(rows);
  const raw = Buffer.from(await pdf.arrayBuffer()).toString("latin1");
  assert.ok(raw.startsWith("%PDF"));
  assert.ok(raw.includes("Mariana Costa"));
  assert.ok(raw.includes("02/01/2027"));
  assert.ok(raw.includes("2027-01"));
});
