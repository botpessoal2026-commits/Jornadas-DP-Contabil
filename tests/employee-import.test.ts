import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { demoData } from "../src/lib/demo";
import {
  contractDurationText,
  contractMinutesFromHours,
} from "../src/lib/contract";
import {
  guessEmployeeImportMapping,
  parseEmployeeCSV,
  previewEmployeeImport,
  readEmployeeWorkbook,
} from "../src/lib/employee-import";
import { specialDateImpact } from "../src/lib/special-date-impact";
import type { SpecialDate } from "../src/lib/types";

test("duração em HH:MM e horas/minutos preserva equivalência decimal e rejeita minuto inválido", () => {
  for (const text of ["08:24", "8h24", "8H24", "8,4"])
    assert.equal(contractMinutesFromHours(text), 504);
  assert.equal(contractMinutesFromHours("168:00"), 10080);
  assert.equal(contractDurationText(504), "08:24");
  assert.equal(contractDurationText(null), "");
  for (const text of [
    "08:60",
    "08:90",
    "168h01",
    "8h4",
    "0:00",
    "1e2",
    "8:2:4",
  ])
    assert.throws(() => contractMinutesFromHours(text));
});

test("CSV aceita acentos, aspas, separador e linhas em campos sem executar fórmulas", () => {
  const rows = parseEmployeeCSV(
    '\uFEFFnome;cpf;horario\r\n"Ana; Silva";;"Linha 1\nLinha 2 ""citada"""\r\n',
  );
  assert.equal(rows[1][0], "Ana; Silva");
  assert.equal(rows[1][2], 'Linha 1\nLinha 2 "citada"');
  assert.equal(
    guessEmployeeImportMapping(["Nome do funcionário", "Matrícula", "Admissão"])
      .nome,
    0,
  );
  assert.throws(() => parseEmployeeCSV('nome;cpf\n"sem fechamento;'), /aspas/);
  assert.deepEqual(parseEmployeeCSV('"nome, campo, livre";cpf\nAna;')[1], [
    "Ana",
    "",
  ]);
});

test("importação valida CPF, duplicatas e escopo sem sobrescrever cadastro", () => {
  const data = demoData(),
    company = data.companies[0];
  const rows = parseEmployeeCSV(
    "nome;cpf;matricula;carga diaria;carga semanal;admissao\nAna Silva;529.982.247-25;A-01;08:24;42h00;15/10/2026",
  );
  const mapping = guessEmployeeImportMapping(rows[0]);
  const original = JSON.stringify(data);
  const preview = previewEmployeeImport({
    rows,
    mapping,
    company,
    existing: data.employees,
    makeId: () => "new-person",
  });
  assert.equal(preview.issues.length, 0);
  assert.equal(preview.employees[0].empresa_id, company.id);
  assert.equal(preview.employees[0].cpf, "52998224725");
  assert.equal(preview.employees[0].admissao, "2026-10-15");
  assert.equal(preview.employees[0].carga_diaria_minutos, 504);
  assert.deepEqual(preview.employees[0].dias_descanso, []);
  assert.equal(JSON.stringify(data), original);
  const duplicate = previewEmployeeImport({
    rows,
    mapping,
    company,
    existing: [...data.employees, preview.employees[0]],
  });
  assert.equal(duplicate.employees.length, 0);
  assert.equal(duplicate.issues.length, 2);
  const otherCompany = { ...preview.employees[0], empresa_id: "other-company" };
  assert.equal(
    previewEmployeeImport({ rows, mapping, company, existing: [otherCompany] })
      .issues.length,
    0,
  );
});

test("importação bloqueia CPF inválido, datas impossíveis e vínculos externos", () => {
  const data = demoData(),
    company = data.companies[0];
  const rows = parseEmployeeCSV(
    "nome;cpf;admissao;modelo;estabelecimento;descansos\nAna;111.111.111-11;31/02/2026;externo;unidade externa;7",
  );
  const preview = previewEmployeeImport({
    rows,
    mapping: guessEmployeeImportMapping(rows[0]),
    company,
    existing: [],
    models: [{ ...data.models[0], id: "externo", empresa_id: "other" }],
    establishments: [
      {
        id: "external",
        empresa_id: "other",
        nome: "unidade externa",
        cidade: "Recife",
        uf: "PE",
        ativo: true,
      },
    ],
  });
  assert.equal(preview.employees.length, 0);
  assert.deepEqual(
    new Set(preview.issues.map((issue) => issue.field)),
    new Set([
      "CPF",
      "Admissão",
      "Modelo individual",
      "Estabelecimento",
      "Descansos",
    ]),
  );
  assert.throws(
    () =>
      previewEmployeeImport({
        rows,
        mapping: { nome: 0, cpf: 0 },
        company,
        existing: [],
      }),
    /coluna diferente/,
  );
});

test("XLSX lê valores e datas e rejeita fórmulas mesmo com resultado calculado", async () => {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("Funcionários");
  sheet.addRow(["nome", "admissao"]);
  sheet.addRow(["Ana", new Date("2026-10-15T00:00:00Z")]);
  let buffer = await book.xlsx.writeBuffer();
  assert.equal(
    (
      await readEmployeeWorkbook(
        Uint8Array.from(buffer as unknown as Uint8Array).buffer,
      )
    )[1][1],
    "2026-10-15",
  );
  sheet.getCell("A2").value = { formula: '"Ana"', result: "Ana" };
  buffer = await book.xlsx.writeBuffer();
  await assert.rejects(
    () =>
      readEmployeeWorkbook(
        Uint8Array.from(buffer as unknown as Uint8Array).buffer,
      ),
    /fórmula/,
  );
});

test("impacto de evento usa o calendário real e mantém exceção individual sem mutação", () => {
  const data = demoData(),
    company = data.companies[0],
    employee = data.employees[0];
  const schedule = data.schedules.find(
    (item) =>
      item.empresa_id === company.id && item.funcionario_id === employee.id,
  )!;
  const day = schedule.dias.find((item) => item.data === "2026-12-01")!;
  day.calendario = {
    base: {
      intervalos: day.intervalos,
      folga: false,
      feriado: null,
      observacao: "",
    },
    excecao: {
      categoria: "trabalho",
      nome: "",
      expediente: "normal",
      intervalos: day.intervalos,
      observacao: "Acordado",
    },
  };
  const event: SpecialDate = {
    id: "impact",
    empresa_id: company.id,
    estabelecimento_id: null,
    nome: "Recesso",
    data_inicio: "2026-12-01",
    data_fim: "2026-12-03",
    categoria: "recesso",
    alcance: "empresa",
    funcionario_ids: [],
    recorrencia: "periodo",
    expediente: "sem_expediente",
    intervalos: [],
    observacoes: "",
    ativo: true,
    data_movel: false,
    uf: null,
    cidade: null,
  };
  const original = JSON.stringify(data);
  const result = specialDateImpact(
    data,
    company.id,
    event,
    event.id,
    "2026-12",
  );
  assert.equal(result.people, 1);
  assert.equal(result.days, 3);
  assert.equal(result.preservedExceptions, 1);
  assert.ok(result.afterMinutes < result.beforeMinutes);
  assert.equal(JSON.stringify(data), original);
  assert.throws(
    () =>
      specialDateImpact(
        data,
        company.id,
        { ...event, empresa_id: "other" },
        event.id,
        "2026-12",
      ),
    /empresa ativa/,
  );
});
