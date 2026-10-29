import assert from "node:assert/strict";
import { test } from "node:test";
import type { Data } from "../src/lib/store";
import type { Company, Employee, Schedule } from "../src/lib/types";
import { generateDays } from "../src/lib/engine";
import { initialModels, initialRules } from "../src/lib/presets";
import {
  absenceConflicts,
  assessSwap,
  comparePlannedActual,
  coverageGaps,
  operationsForCompany,
  parseActualImport,
  safeDocumentUrl,
  suggestSwapCandidates,
  validateCompanyOperation,
  type CompanyOperation,
} from "../src/lib/company-operations";

const company: Company = {
  id: "company-a",
  nome: "Empresa A",
  cnpj: "",
  cidade: "Recife",
  uf: "PE",
  cct: "",
  permite_6x1: false,
  limite_diario_minutos: 504,
  usa_banco_horas: false,
};
const employee: Employee = {
  id: "employee-a",
  empresa_id: company.id,
  nome: "Pessoa A",
  cargo: "Atendimento",
  setor: "Equipe",
  horario_contratual: "",
  carga_semanal_minutos: 2520,
  dias_descanso: [],
};
const colleague: Employee = { ...employee, id: "employee-b", nome: "Pessoa B" };
const stranger: Employee = {
  ...employee,
  id: "stranger",
  empresa_id: "company-b",
};
const schedule = (employeeId = employee.id, night = false): Schedule => ({
  id: `schedule-${employeeId}`,
  empresa_id: company.id,
  funcionario_id: employeeId,
  modelo_id: null,
  modelo_tipo: "5x2",
  mes: "2026-12-01",
  dias: [
    {
      data: "2026-12-01",
      intervalos: night
        ? [{ start: "22:00", end: "06:00", endDay: 1 }]
        : [
            { start: "08:00", end: "12:00" },
            { start: "13:00", end: "17:00" },
          ],
      folga: false,
      feriado: null,
      observacao: "",
    },
    {
      data: "2026-12-02",
      intervalos: [],
      folga: true,
      feriado: null,
      observacao: "",
    },
  ],
});
const data = (): Data => ({
  companies: [company, { ...company, id: "company-b", nome: "Empresa B" }],
  employees: [employee, colleague, stranger],
  models: [],
  rules: [],
  holidays: [],
  schedules: [schedule(), schedule(colleague.id)],
  logs: [],
  establishments: [
    {
      id: "unit-b",
      empresa_id: "company-b",
      nome: "Outra unidade",
      cidade: "Recife",
      uf: "PE",
      ativo: true,
    },
  ],
  operations: [],
});
const operation = (
  overrides: Partial<CompanyOperation> = {},
): CompanyOperation => ({
  id: "op-a",
  empresa_id: company.id,
  tipo: "ausencia",
  status: "aprovado",
  titulo: "Ausência programada",
  funcionario_id: employee.id,
  data_inicio: "2026-12-01",
  data_fim: "2026-12-02",
  payload: { categoria: "indisponibilidade", motivo: "Informação conferida" },
  ...overrides,
});
const coverage = (
  overrides: Partial<CompanyOperation> = {},
): CompanyOperation =>
  operation({
    tipo: "cobertura",
    funcionario_id: null,
    titulo: "Cobertura de atendimento",
    payload: {
      estabelecimento_id: null,
      setor: "Equipe",
      cargo: "Atendimento",
      inicio: "08:00",
      fim: "17:00",
      minimo: 2,
      dias_semana: [2],
    },
    ...overrides,
  });
const actual = (overrides: Partial<CompanyOperation> = {}): CompanyOperation =>
  operation({
    tipo: "realizado",
    data_fim: "2026-12-01",
    payload: {
      intervalos: [
        { start: "08:05", end: "12:00" },
        { start: "13:00", end: "17:10" },
      ],
      origem: "manual",
      observacao: "Informado pelo DP",
    },
    ...overrides,
  });

test("registros operacionais validam vínculo, localidade, datas e tipos sem cruzar empresas", () => {
  const input = data();
  assert.deepEqual(validateCompanyOperation(operation(), input), []);
  assert.match(
    validateCompanyOperation(
      operation({ funcionario_id: stranger.id }),
      input,
    ).join(" "),
    /pertencer/,
  );
  assert.match(
    validateCompanyOperation(
      coverage({
        payload: { ...coverage().payload, estabelecimento_id: "unit-b" },
      }),
      input,
    ).join(" "),
    /estabelecimento/,
  );
  assert.match(
    validateCompanyOperation(
      operation({ data_inicio: "2026-02-30" }),
      input,
    ).join(" "),
    /período/,
  );
  assert.match(
    validateCompanyOperation(
      operation({ status: "inventado" as "aprovado" }),
      input,
    ).join(" "),
    /Situação/,
  );
  assert.match(
    validateCompanyOperation(operation({ data_fim: "2040-01-01" }), input).join(
      " ",
    ),
    /dez anos/,
  );
});

test("ausência conferida indica trabalho civil e não modifica escala nem pagamentos", () => {
  const input = data();
  input.schedules = [schedule(employee.id, true)];
  const before = structuredClone(input);
  assert.deepEqual(absenceConflicts(input, operation()), [
    { date: "2026-12-01", minutes: 120 },
    { date: "2026-12-02", minutes: 360 },
  ]);
  assert.deepEqual(
    absenceConflicts(input, operation({ status: "pendente" })),
    [],
  );
  assert.deepEqual(input, before);
});

test("cobertura conta pessoas distintas, pausas e ausências aprovadas nas fronteiras reais", () => {
  const input = data();
  assert.deepEqual(
    coverageGaps(input, coverage(), "2026-12").map((gap) => [
      gap.from.slice(11, 16),
      gap.to.slice(11, 16),
      gap.scheduled,
    ]),
    [["12:00", "13:00", 0]],
  );
  input.operations = [operation()];
  const gaps = coverageGaps(
    input,
    coverage({ data_fim: "2026-12-01" }),
    "2026-12",
  );
  assert.deepEqual(
    gaps.map((gap) => gap.scheduled),
    [1, 0, 1],
  );
  assert.ok(gaps.every((gap) => !gap.names.includes(employee.nome)));
});

test("cobertura noturna inclui madrugada e indisponibilidade da data seguinte", () => {
  const input = data();
  input.schedules = [schedule(employee.id, true)];
  const op = coverage({
    data_fim: "2026-12-01",
    payload: {
      ...coverage().payload,
      minimo: 1,
      inicio: "22:00",
      fim: "06:00",
    },
  });
  assert.deepEqual(coverageGaps(input, op, "2026-12"), []);
  input.operations = [operation({ data_inicio: "2026-12-02" })];
  const gaps = coverageGaps(input, op, "2026-12");
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].from, "2026-12-02T00:00:00.000Z");
  assert.equal(gaps[0].to, "2026-12-02T06:00:00.000Z");
});

test("ausência na virada do mês encontra a continuação real sem inventar escala no novo mês", () => {
  const input = data();
  const night = schedule(employee.id, true);
  night.dias[0].data = "2026-12-31";
  night.dias = night.dias.slice(0, 1);
  input.schedules = [night];
  assert.deepEqual(
    absenceConflicts(
      input,
      operation({ data_inicio: "2027-01-01", data_fim: "2027-01-01" }),
    ),
    [{ date: "2027-01-01", minutes: 360 }],
  );
});

test("troca simula os dois calendários, mantém exceções e bloqueia falta de parâmetros", () => {
  const input = data();
  const before = structuredClone(input);
  const op = operation({
    tipo: "troca",
    status: "pendente",
    payload: {
      destino_funcionario_id: colleague.id,
      data_origem: "2026-12-01",
      data_destino: "2026-12-02",
      justificativa: "Pedido dos vínculos",
    },
  });
  const result = assessSwap(input, op);
  assert.equal(result.schedules.length, 2);
  assert.equal(result.canApply, false);
  assert.ok(result.alerts.length > 0);
  assert.equal(
    result.schedules[0].dias[0].calendario?.excecao?.categoria,
    "folga",
  );
  assert.equal(
    result.schedules[1].dias[1].calendario?.excecao?.categoria,
    "trabalho",
  );
  assert.deepEqual(input, before);
  assert.equal(
    assessSwap(input, {
      ...op,
      payload: { ...op.payload, destino_funcionario_id: stranger.id },
    }).schedules.length,
    0,
  );
  assert.ok(
    suggestSwapCandidates(input, op).every(
      (suggestion) => suggestion.employee.empresa_id === company.id,
    ),
  );
});

test("troca com fontes conferidas e horários compatíveis pode ser aplicada após revisão", () => {
  const input = data();
  const model = {
    ...initialModels[0],
    id: "model-own",
    empresa_id: company.id,
  };
  input.models = [model];
  input.rules = initialRules.map((rule, index) => ({
    ...rule,
    id: `confirmed-rule-${index}`,
    confirmado: true,
    valor: {
      ...rule.valor,
      fundamento_tipo: "cct",
      fundamento_referencia: "Instrumento RH-527, compensação diária",
      periodo_compensacao: "ano",
      comprovado: true,
    },
  }));
  input.schedules = [employee, colleague].map((person) => ({
    ...schedule(person.id),
    modelo_id: model.id,
    mes: "2026-10-01",
    dias: generateDays("2026-10", model, company, [], false),
  }));
  const op = operation({
    tipo: "troca",
    status: "pendente",
    data_inicio: "2026-10-01",
    data_fim: "2026-10-01",
    payload: {
      destino_funcionario_id: colleague.id,
      data_origem: "2026-10-01",
      data_destino: "2026-10-01",
      justificativa: "Horários equivalentes conferidos",
    },
  });
  const assessment = assessSwap(input, op);
  assert.equal(assessment.canApply, true, JSON.stringify(assessment));
  assert.equal(
    assessSwap(input, { ...op, status: "aprovado" }).canApply,
    false,
  );
});

test("planejado e realizado distinguem ausência de informação, zero e diferença de relógio", () => {
  const input = data();
  const absent = comparePlannedActual(
    input,
    company.id,
    employee.id,
    "2026-12",
  );
  assert.equal(absent[0].planned, 480);
  assert.equal(absent[0].actual, null);
  assert.equal(absent[0].delta, null);
  input.operations = [actual()];
  const comparison = comparePlannedActual(
    input,
    company.id,
    employee.id,
    "2026-12",
  );
  assert.equal(comparison[0].actual, 485);
  assert.equal(comparison[0].delta, 5);
  input.operations = [
    actual({
      payload: {
        intervalos: [],
        origem: "manual",
        observacao: "Zero declarado",
      },
    }),
  ];
  assert.equal(
    comparePlannedActual(input, company.id, employee.id, "2026-12")[0].actual,
    0,
  );
  input.operations = [actual({ status: "pendente" })];
  assert.equal(
    comparePlannedActual(input, company.id, employee.id, "2026-12")[0].actual,
    null,
  );
  assert.throws(
    () => comparePlannedActual(input, company.id, stranger.id, "2026-12"),
    /contexto/,
  );
});

test("realizado noturno usa data civil e recusa duplicidade de registros conferidos", () => {
  const input = data();
  input.operations = [
    actual({
      payload: {
        intervalos: [{ start: "22:00", end: "06:00", endDay: 1 }],
        origem: "manual",
        observacao: "Plantão real",
      },
    }),
  ];
  const rows = comparePlannedActual(input, company.id, employee.id, "2026-12");
  assert.equal(rows[0].actual, 120);
  assert.equal(rows[1].actual, 360);
  input.operations.push({ ...input.operations[0], id: "duplicate" });
  assert.equal(
    comparePlannedActual(input, company.id, employee.id, "2026-12")[0]
      .duplicate,
    true,
  );
  assert.equal(
    comparePlannedActual(input, company.id, employee.id, "2026-12")[1].actual,
    null,
  );
});

test("importação de realizado é uma prévia sem preencher horários a partir do planejamento", () => {
  const input = data();
  const before = structuredClone(input);
  const rows = parseActualImport(
    "Data;Períodos\n2026-12-01;08:05-12:00,13:00-17:10\n2026-12-02;ZERO",
    input,
    company.id,
    employee.id,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "pendente");
  assert.equal(
    (rows[0].payload.intervalos as { start: string }[])[0].start,
    "08:05",
  );
  assert.deepEqual(rows[1].payload.intervalos, []);
  assert.deepEqual(input, before);
  assert.throws(
    () => parseActualImport("2026-12-01;", input, company.id, employee.id),
    /ZERO/,
  );
  assert.throws(
    () =>
      parseActualImport(
        "2026-12-01;08:00-12:00\n2026-12-01;08:00-12:00",
        input,
        company.id,
        employee.id,
      ),
    /única/,
  );
  assert.throws(
    () =>
      parseActualImport(
        "2026-02-30;08:00-12:00",
        input,
        company.id,
        employee.id,
      ),
    /única/,
  );
  assert.throws(
    () =>
      parseActualImport(
        "2026-12-01;25:00-12:00",
        input,
        company.id,
        employee.id,
      ),
    /inválido/,
  );
});

test("marcações sobrepostas, offsets não numéricos e endereço inseguro são recusados", () => {
  const input = data();
  assert.match(
    validateCompanyOperation(
      actual({
        payload: {
          ...actual().payload,
          intervalos: [
            { start: "08:00", end: "12:00" },
            { start: "11:00", end: "13:00" },
          ],
        },
      }),
      input,
    ).join(" "),
    /sobrepostas/,
  );
  assert.match(
    validateCompanyOperation(
      actual({
        payload: {
          ...actual().payload,
          intervalos: [{ start: "22:00", end: "05:00", endDay: "1" }],
        },
      }),
      input,
    ).join(" "),
    /inválidas/,
  );
  assert.equal(
    safeDocumentUrl("https://example.com/documento.pdf"),
    "https://example.com/documento.pdf",
  );
  assert.throws(() => safeDocumentUrl("javascript:alert(1)"), /HTTPS/);
  assert.throws(
    () => safeDocumentUrl("https://user:senha@example.com"),
    /HTTPS/,
  );
  assert.throws(() => safeDocumentUrl("http://example.com"), /HTTPS/);
});

test("documentos sem término continuam disponíveis após mês inicial sem cruzar escopo", () => {
  const input = data();
  input.operations = [
    operation({
      tipo: "documento",
      funcionario_id: null,
      data_fim: "2026-12-01",
      payload: {
        fonte: "Publicação",
        referencia: "Instrumento individual",
        vigencia_fim: null,
        url: null,
      },
    }),
    operation({ id: "foreign", empresa_id: "company-b" }),
  ];
  assert.equal(operationsForCompany(input, company.id, "2027-01").length, 1);
  assert.deepEqual(validateCompanyOperation(input.operations[0], input), []);
});
