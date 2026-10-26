import { test } from "node:test";
import assert from "node:assert/strict";
import { demoData } from "../src/lib/demo";
import type { Data } from "../src/lib/store";
import type { Company, Employee, Model } from "../src/lib/types";
import {
  companySituation,
  companySummary,
  formatCompanyCnpj,
  isCompanyActive,
  matchesCompanySearch,
  resolveEmployeeModel,
  resolveEmployeeModelWithOrigin,
  scopeCompanyData,
} from "../src/lib/company-context";

function fixture() {
  const original = demoData();
  const alpha: Company = {
    ...original.companies[0],
    id: "alpha",
    nome: "Empresa Alfa",
    modelo_padrao_id: "alpha-model",
  };
  const beta: Company = {
    ...alpha,
    id: "beta",
    nome: "Empresa Beta",
    cidade: "Olinda",
    modelo_padrao_id: "beta-model",
  };
  const personA: Employee = {
    ...original.employees[0],
    id: "person-a",
    empresa_id: alpha.id,
    modelo_padrao_id: "individual-model",
  };
  const personB: Employee = {
    ...personA,
    id: "person-b",
    empresa_id: beta.id,
    modelo_padrao_id: "beta-model",
  };
  const shared: Model = {
    ...original.models[0],
    id: "shared",
    empresa_id: null,
  };
  const models: Model[] = [
    shared,
    { ...shared, id: "alpha-model", empresa_id: alpha.id },
    { ...shared, id: "individual-model", empresa_id: alpha.id },
    { ...shared, id: "beta-model", empresa_id: beta.id },
  ];
  const data: Data = {
    ...original,
    companies: [alpha, beta],
    employees: [personA, personB],
    models,
    schedules: [
      {
        ...original.schedules[0],
        id: "scale-a",
        empresa_id: alpha.id,
        funcionario_id: personA.id,
      },
      {
        ...original.schedules[0],
        id: "scale-b",
        empresa_id: beta.id,
        funcionario_id: personB.id,
      },
      // Inconsistent input must not leak an employee from a different company.
      {
        ...original.schedules[0],
        id: "bad-reference",
        empresa_id: alpha.id,
        funcionario_id: personB.id,
      },
    ],
    holidays: [
      {
        id: "national",
        data: "2026-12-25",
        nome: "Nacional",
        abrangencia: "nacional",
        uf: null,
        cidade: null,
      },
      {
        id: "state",
        data: "2026-12-03",
        nome: "Estadual",
        abrangencia: "estadual",
        uf: "PE",
        cidade: null,
      },
      {
        id: "recife",
        data: "2026-12-04",
        nome: "Municipal Recife",
        abrangencia: "municipal",
        uf: "PE",
        cidade: "Recife",
      },
      {
        id: "olinda",
        data: "2026-12-05",
        nome: "Municipal Olinda",
        abrangencia: "municipal",
        uf: "PE",
        cidade: "Olinda",
      },
      {
        id: "other-state",
        data: "2026-12-06",
        nome: "Outro estado",
        abrangencia: "estadual",
        uf: "SP",
        cidade: null,
      },
    ],
    logs: [
      {
        id: "log-a",
        tabela: "funcionarios",
        acao: "UPDATE",
        alterado_em: "2026-10-22T12:00:00Z",
        empresa_id: alpha.id,
      },
      {
        id: "log-b",
        tabela: "funcionarios",
        acao: "UPDATE",
        alterado_em: "2026-10-22T12:00:00Z",
        empresa_id: beta.id,
      },
      {
        id: "legacy-log",
        tabela: "funcionarios",
        acao: "UPDATE",
        alterado_em: "2026-10-22T12:00:00Z",
      },
    ] as Data["logs"],
  };
  return { data, alpha, beta, personA, personB, shared, models };
}

test("contexto individual restringe funcionários, escalas, modelos e histórico sem associação arbitrária", () => {
  const { data, alpha } = fixture();
  const before = JSON.stringify(data);
  const scoped = scopeCompanyData(data, alpha.id);
  assert.deepEqual(
    scoped.companies.map((company) => company.id),
    ["alpha"],
  );
  assert.deepEqual(
    scoped.employees.map((person) => person.id),
    ["person-a"],
  );
  assert.deepEqual(
    scoped.schedules.map((schedule) => schedule.id),
    ["scale-a"],
  );
  assert.deepEqual(
    scoped.models.map((model) => model.id),
    ["alpha-model", "individual-model"],
  );
  assert.deepEqual(
    scoped.logs.map((log) => log.id),
    ["log-a"],
  );
  assert.equal(JSON.stringify(data), before);
});

test("feriados oficiais seguem localização e não se tornam globais por compartilhar o usuário", () => {
  const { data, alpha, beta } = fixture();
  assert.deepEqual(
    scopeCompanyData(data, alpha.id).holidays.map((holiday) => holiday.id),
    ["national", "state", "recife"],
  );
  assert.deepEqual(
    scopeCompanyData(data, beta.id).holidays.map((holiday) => holiday.id),
    ["national", "state", "olinda"],
  );
});

test("empresa não autorizada ou inexistente falha fechada sem recursos compartilhados", () => {
  const { data } = fixture();
  const scoped = scopeCompanyData(data, "not-authorized");
  for (const entries of Object.values(scoped)) assert.equal(entries.length, 0);
});

test("modelo individual tem precedência e não é reescrito ao alterar o padrão da empresa", () => {
  const { alpha, personA, models } = fixture();
  const before = JSON.stringify(personA);
  assert.equal(
    resolveEmployeeModel(personA, alpha, models)?.id,
    "individual-model",
  );
  assert.equal(
    resolveEmployeeModel(
      personA,
      { ...alpha, modelo_padrao_id: "shared" },
      models,
    )?.id,
    "individual-model",
  );
  assert.equal(
    resolveEmployeeModelWithOrigin(personA, alpha, models).origin,
    "employee",
  );
  assert.equal(JSON.stringify(personA), before);
});

test("seleção explícita, modelo da empresa e sugestão compartilham somente modelos compatíveis", () => {
  const { alpha, beta, personA, models } = fixture();
  assert.equal(
    resolveEmployeeModel(personA, alpha, models, "shared")?.id,
    "individual-model",
  );
  assert.equal(
    resolveEmployeeModel(personA, alpha, models, "beta-model")?.id,
    "individual-model",
  );
  assert.equal(
    resolveEmployeeModel({ ...personA, modelo_padrao_id: null }, alpha, models)
      ?.id,
    "alpha-model",
  );
  assert.equal(
    resolveEmployeeModelWithOrigin(
      { ...personA, modelo_padrao_id: null },
      alpha,
      models,
    ).origin,
    "company",
  );
  const noDefault = { ...alpha, modelo_padrao_id: null };
  assert.equal(
    resolveEmployeeModelWithOrigin(
      { ...personA, modelo_padrao_id: null },
      noDefault,
      models,
    ).origin,
    "fallback",
  );
  assert.equal(resolveEmployeeModel(personA, beta, models), undefined);
  assert.equal(
    resolveEmployeeModel(
      personA,
      alpha,
      models.filter((model) => model.empresa_id === beta.id),
    ),
    undefined,
  );
});

test("indicadores usam somente dados da empresa/competência, sem presumir aprovação", () => {
  const { data, alpha, personA } = fixture();
  data.employees.push({
    ...personA,
    id: "without-scale",
    modelo_padrao_id: null,
  });
  data.employees.push({ ...personA, id: "inactive", situacao: "inativo" });
  const summary = companySummary(data, alpha, "2026-12");
  assert.equal(summary.employees, 2);
  assert.equal(summary.totalEmployees, 3);
  assert.equal(summary.savedSchedules, 1);
  assert.equal(summary.missingSchedules, 1);
  assert.equal(summary.applicableHolidays, 3);
  assert.ok(summary.pendingSources > 0);
  assert.equal(companySummary(data, alpha, "2027-01").savedSchedules, 0);
  assert.equal(companySummary(data, alpha, "2027-01").missingSchedules, 2);
});

test("violação contratual nos indicadores não é contaminada por funcionário da outra empresa", () => {
  const { data, alpha } = fixture();
  data.employees[0].carga_semanal_minutos = 1800;
  const before = companySummary(data, alpha, "2026-12");
  assert.ok(before.violations > 0);
  data.employees[1].carga_semanal_minutos = 60;
  assert.equal(
    companySummary(data, alpha, "2026-12").violations,
    before.violations,
  );
});

test("situação legada permanece ativa e CNPJ vazio não recebe identificação fictícia", () => {
  const { alpha } = fixture();
  assert.equal(companySituation(alpha), "ativa");
  assert.equal(isCompanyActive({ ...alpha, situacao: "arquivada" }), false);
  assert.equal(isCompanyActive({ ...alpha, situacao: "inativa" }), false);
  assert.equal(formatCompanyCnpj("11222333000181"), "11.222.333/0001-81");
  assert.equal(formatCompanyCnpj(""), "CNPJ não informado");
});

test("horário legado inválido mantém cadastro acessível e sinaliza conferência incompleta", () => {
  const { data, alpha } = fixture();
  data.schedules[0].dias[0].intervalos = [{ start: "abc", end: "18:00" }];
  const summary = companySummary(data, alpha, "2026-12");
  assert.equal(summary.savedSchedules, 1);
  assert.equal(summary.unreadableSchedules, 1);
  assert.match(summary.calculationErrors[0].message, /Horário inválido/);
});

test("busca aceita CNPJ formatado e acentos sem transformar código misto em busca numérica", () => {
  const { alpha } = fixture();
  const company = {
    ...alpha,
    nome: "Aliança Contábil",
    codigo_interno: "ALFA-42",
    situacao: "arquivada" as const,
  };
  assert.equal(matchesCompanySearch(company, "alianca"), true);
  assert.equal(matchesCompanySearch(company, "11.222.333/0001-81"), true);
  assert.equal(matchesCompanySearch(company, "ALFA-42"), true);
  assert.equal(matchesCompanySearch(company, "arquivada"), true);
  assert.equal(matchesCompanySearch(company, "BETA-1"), false);
  assert.equal(matchesCompanySearch(company, "   "), true);
});
