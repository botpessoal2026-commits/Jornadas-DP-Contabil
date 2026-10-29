import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { demoData } from "../src/lib/demo";
import { pdfDocument, reportFilename } from "../src/lib/exports";
import {
  consolidatedExcel,
  consolidatedCSV,
  reportEntries,
  scheduleICS,
  zipFiles,
} from "../src/lib/report-bundle";
import { auditChanges, auditLocalDate } from "../src/lib/audit-presentation";

test("downloads identificam empresa, pessoa e competência sem CPF ou caminhos", () => {
  const data = demoData(),
    schedule = data.schedules[0],
    employee = {
      ...data.employees[0],
      cpf: "12345678901",
      nome: "Mariana / Costa",
    };
  const name = reportFilename(
    "Folha de ponto",
    schedule,
    "PDF",
    { nome: "Aurora Contabilidade" },
    employee,
  );
  assert.equal(
    name,
    "folha-de-ponto-aurora-contabilidade-mariana-costa-2026-12.pdf",
  );
  assert.ok(!name.includes(employee.cpf));
  assert.ok(!/[\\/]/.test(name));
  assert.notEqual(
    name,
    reportFilename(
      "Folha de ponto",
      schedule,
      "PDF",
      { nome: "Outra empresa" },
      employee,
    ),
  );
});

test("PDF compacto reduz páginas e mantém os dias sem alterar a conferência completa", async () => {
  const data = demoData(),
    schedule = data.schedules[0];
  const compact = await pdfDocument(
    schedule,
    data.rules,
    data.companies[0],
    data.employees[0],
    { compact: true, preview: true },
  );
  const complete = await pdfDocument(
    schedule,
    data.rules,
    data.companies[0],
    data.employees[0],
  );
  assert.ok(compact.getNumberOfPages() < complete.getNumberOfPages());
  assert.equal(compact.getNumberOfPages(), 1);
  const raw = compact.output();
  assert.ok(raw.includes("17:24"));
  assert.ok(raw.includes("31"));
  assert.ok(raw.includes("Cont Cont"));
  assert.ok(complete.getNumberOfPages() >= 4);
});

test("lote resolve vínculos conhecidos e rejeita pessoa de outra empresa ou escala repetida", () => {
  const data = demoData();
  assert.equal(
    reportEntries(data, [data.schedules[0]])[0].employee.id,
    data.schedules[0].funcionario_id,
  );
  assert.throws(
    () =>
      reportEntries(data, [
        { ...data.schedules[0], empresa_id: data.companies[1].id },
      ]),
    /não corresponde/,
  );
  assert.throws(
    () => reportEntries(data, [data.schedules[0], data.schedules[0]]),
    /repetida/,
  );
  assert.throws(
    () =>
      reportEntries(data, [
        data.schedules[0],
        { ...data.schedules[0], mes: "2026-12-01" },
      ]),
    /repetida/,
  );
  assert.throws(() => reportEntries(data, []), /Selecione/);
});

test("Excel consolidado mantém identificação e todos os dias das pessoas selecionadas", async () => {
  const data = demoData(),
    entries = reportEntries(data, data.schedules);
  const bytes = await consolidatedExcel(entries);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes.buffer as ArrayBuffer);
  const sheet = book.getWorksheet("Escalas selecionadas")!;
  assert.equal(sheet.rowCount, 1 + data.schedules.length * 31);
  const rows = JSON.stringify(sheet.getSheetValues());
  for (const entry of entries) {
    assert.ok(rows.includes(entry.employee.nome));
    assert.ok(rows.includes(entry.company.nome));
  }
  assert.equal(
    book.getWorksheet("Identificação do lote")!.rowCount,
    2 + entries.length,
  );
});

test("ZIP padrão grava CRC conhecido, diretório e nomes únicos sem aceitar caminhos", () => {
  const bytes = new TextEncoder().encode("123456789");
  const zip = zipFiles([
    { name: "escala.pdf", bytes },
    { name: "escala.pdf", bytes },
  ]);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), 0xcbf43926);
  const raw = new TextDecoder().decode(zip);
  assert.ok(raw.includes("escala.pdf"));
  assert.ok(raw.includes("escala-2.pdf"));
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 8, true), 2);
  const directory = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(directory, true), 0x02014b50);
  assert.throws(() => zipFiles([{ name: "../escala.pdf", bytes }]), /inválido/);
});

test("perfil de colunas preserva identificação obrigatória e situação da revisão", () => {
  const data = demoData();
  const entries = reportEntries(data, [
    { ...data.schedules[0], status: "em_revisao", revisao: 3 },
  ]);
  const csv = consolidatedCSV(entries, [
    "Situação da escala",
    "Revisão da escala",
  ]);
  const header = csv.split("\r\n")[0];
  for (const key of [
    "Data",
    "Empresa",
    "Funcionário",
    "Horário",
    "Revisão da escala",
  ])
    assert.ok(header.includes(key));
  assert.ok(!header.includes("Observação"));
  assert.ok(csv.includes("Em revisão"));
  assert.ok(csv.includes('"3"'));
});

test("calendário ICS atravessa meia-noite e dobra linhas por bytes sem expor CPF", () => {
  const data = demoData();
  const entries = reportEntries(data, [
    {
      ...data.schedules[0],
      dias: [
        {
          data: "2026-12-31",
          folga: false,
          feriado: null,
          observacao: "Observação; com vírgula, e acentuação ".repeat(9),
          intervalos: [{ start: "22:00", end: "05:00", endDay: 1 }],
        },
      ],
    },
  ]);
  const ics = scheduleICS(entries, new Date("2026-10-28T12:00:00Z"));
  assert.ok(ics.includes("DTSTART:20261231T220000"));
  assert.ok(ics.includes("DTEND:20270101T050000"));
  assert.ok(ics.includes("DTSTAMP:20261028T120000Z"));
  assert.ok(ics.includes("\\;"));
  assert.ok(ics.includes("\\,"));
  for (const line of ics.split("\r\n"))
    assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  assert.ok(!ics.includes("CPF"));
});

test("histórico explica alterações de dias e duração em linguagem do DP", () => {
  const day = {
    data: "2026-12-05",
    intervalos: [],
    folga: true,
    feriado: null,
    observacao: "",
  };
  const changes = auditChanges({
    id: "log",
    tabela: "escalas",
    acao: "UPDATE",
    alterado_em: "2026-10-28T12:00:00Z",
    antes: { dias: [day], carga_diaria_minutos: 480 },
    depois: {
      dias: [
        {
          ...day,
          folga: false,
          intervalos: [{ start: "08:00", end: "17:00" }],
        },
      ],
      carga_diaria_minutos: 504,
    },
  });
  assert.ok(
    changes.some((change) => change.includes("Dia 05/12: Folga → 08:00–17:00")),
  );
  assert.ok(changes.includes("Carga diária: 8h00 → 8h24"));
  assert.equal(auditLocalDate("2026-10-28T01:00:00Z"), "2026-10-27");
});

test("histórico legado com dias incompletos continua consultável", () => {
  const changes = auditChanges({
    id: "legacy-log",
    tabela: "escalas",
    acao: "UPDATE",
    alterado_em: "2026-10-28T12:00:00Z",
    antes: { dias: [null, { data: "2026-12-05", intervalos: "legado" }] },
    depois: {
      dias: [
        { data: "2026-12-05", intervalos: [{ start: "08:00", end: "12:00" }] },
      ],
    },
  });
  assert.ok(changes.some((change) => change.includes("Dia 05/12")));
  assert.equal(auditLocalDate("sem data"), "");
});
