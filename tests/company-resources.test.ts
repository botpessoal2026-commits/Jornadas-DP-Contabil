import test from "node:test";
import assert from "node:assert/strict";
import { demoData } from "../src/lib/demo";
import {
  activeRule,
  evaluate,
  generateDays,
  holidayAt,
} from "../src/lib/engine";
import {
  holidaysForCompany,
  modelsForCompany,
  rulesForCompany,
} from "../src/lib/company-resources";
import {
  resolveEmployeeModelWithOrigin,
  scopeCompanyData,
} from "../src/lib/company-context";
import { teamScheduleRows } from "../src/lib/team-schedule";
import { exportRows } from "../src/lib/exports";
import type { Day, Holiday, LegalRule } from "../src/lib/types";

const rule = (
  id: string,
  inicio_vigencia: string,
  empresa_id?: string | null,
): LegalRule => ({
  id,
  nome: id,
  empresa_id,
  chave: "regime",
  valor: { limite_semanal_minutos: 2520 },
  inicio_vigencia,
  fonte: "Referência fictícia para teste",
  observacao: "",
  confirmado: true,
});

test("regra particular assume a chave pela vigência sem herdar alterações de outra empresa ou futuras gerais", () => {
  const rules = [
    rule("general-past", "2025-01-01"),
    rule("general-tie", "2026-06-01", null),
    rule("general-future", "2027-01-01"),
    rule("alpha", "2026-06-01", "alpha"),
    rule("alpha-next", "2028-01-01", "alpha"),
    rule("beta", "2026-08-01", "beta"),
    { ...rule("global-night", "2026-01-01"), chave: "noturno" },
  ];
  const before = structuredClone(rules);
  const alpha = rulesForCompany(rules, "alpha");
  assert.deepEqual(
    alpha.map((entry) => entry.id),
    ["general-past", "alpha", "alpha-next", "global-night"],
  );
  assert.equal(activeRule(alpha, "regime", "2026-05-31")?.id, "general-past");
  assert.equal(activeRule(alpha, "regime", "2026-06-01")?.id, "alpha");
  assert.equal(activeRule(alpha, "regime", "2027-12-01")?.id, "alpha");
  assert.equal(activeRule(alpha, "regime", "2028-01-01")?.id, "alpha-next");
  assert.equal(
    activeRule(rulesForCompany(rules, "beta"), "regime", "2026-07-01")?.id,
    "general-tie",
  );
  assert.equal(
    activeRule(rulesForCompany(rules, "new-company"), "regime", "2027-12-01")
      ?.id,
    "general-future",
  );
  assert.deepEqual(rulesForCompany(alpha, "alpha"), alpha);
  assert.deepEqual(rules, before);
});

test("feriado exclusivo não alcança outra empresa da mesma cidade e mantém a localização dos gerais", () => {
  const data = demoData();
  const alpha = data.companies[0];
  const beta = { ...data.companies[1], cidade: alpha.cidade, uf: alpha.uf };
  const holiday: Holiday = {
    id: "alpha-holiday",
    nome: "Expediente exclusivo Alfa",
    data: "2026-12-01",
    abrangencia: "municipal",
    uf: alpha.uf,
    cidade: alpha.cidade,
    empresa_id: alpha.id,
  };
  const holidays: Holiday[] = [
    { ...holiday, id: "general", nome: "Geral", empresa_id: null },
    holiday,
    {
      ...holiday,
      id: "foreign-location",
      data: "2026-12-02",
      empresa_id: null,
      cidade: "Outra cidade",
    },
    { ...holiday, id: "only-alpha", data: "2026-12-03" },
  ];
  assert.equal(holidayAt(holiday.data, holidays, alpha)?.id, holiday.id);
  assert.equal(holidayAt(holiday.data, holidays, beta)?.id, "general");
  assert.equal(holidayAt("2026-12-02", holidays, alpha), undefined);
  assert.equal(holidayAt("2026-12-03", holidays, beta), undefined);
  assert.deepEqual(
    holidaysForCompany(holidays, beta.id).map((entry) => entry.id),
    ["general", "foreign-location"],
  );
  const alphaDay = generateDays(
    "2026-12",
    data.models[0],
    alpha,
    holidays,
  ).find((day) => day.data === "2026-12-03")!;
  const betaDay = generateDays("2026-12", data.models[0], beta, holidays).find(
    (day) => day.data === "2026-12-03",
  )!;
  assert.equal(alphaDay.folga, true);
  assert.equal(betaDay.folga, false);
});

test("biblioteca não é padrão implícito e vínculos globais legados permanecem explícitos", () => {
  const data = demoData();
  const company = { ...data.companies[0], modelo_padrao_id: null };
  const employee = { ...data.employees[0], modelo_padrao_id: null };
  const global = { ...data.models[0], empresa_id: null };
  const own = { ...global, id: "alpha-own", empresa_id: company.id };
  const foreign = { ...own, id: "beta-own", empresa_id: data.companies[1].id };
  const models = [global, foreign, own];
  assert.deepEqual(modelsForCompany(models, company.id), [own]);
  assert.deepEqual(modelsForCompany(models, company.id, [global.id]), [
    global,
    own,
  ]);
  assert.deepEqual(
    resolveEmployeeModelWithOrigin(employee, company, [global]),
    { model: undefined, origin: "none" },
  );
  assert.equal(
    resolveEmployeeModelWithOrigin(employee, company, models, global.id).model
      ?.id,
    own.id,
  );
  assert.equal(
    resolveEmployeeModelWithOrigin(employee, company, models, global.id, [
      global.id,
    ]).origin,
    "explicit",
  );
  assert.equal(
    resolveEmployeeModelWithOrigin(
      { ...employee, modelo_padrao_id: global.id },
      company,
      models,
    ).origin,
    "employee",
  );
  assert.equal(
    resolveEmployeeModelWithOrigin(
      employee,
      { ...company, modelo_padrao_id: global.id },
      models,
    ).origin,
    "company",
  );
  assert.throws(
    () => generateDays("2026-12", foreign, company, []),
    /modelo de jornada deve pertencer/,
  );
});

test("contexto separa recursos próprios da biblioteca e uma nova empresa não herda particulares", () => {
  const data = demoData();
  const company = data.companies[0];
  const fresh = { ...company, id: "new-company", nome: "Nova empresa" };
  data.companies.push(fresh);
  data.models.push({ ...data.models[0], id: "own", empresa_id: company.id });
  data.rules = [
    rule("global", "2025-01-01"),
    rule("private", "2026-01-01", company.id),
  ];
  data.holidays = [
    {
      id: "private",
      nome: "Feriado Alfa",
      data: "2026-12-01",
      abrangencia: "nacional",
      uf: null,
      cidade: null,
      empresa_id: company.id,
    },
  ];
  const scoped = scopeCompanyData(data, company.id);
  assert.deepEqual(
    scoped.models.map((entry) => entry.id),
    ["own"],
  );
  assert.deepEqual(
    scoped.rules.map((entry) => entry.id),
    ["global", "private"],
  );
  const empty = scopeCompanyData(data, fresh.id);
  assert.equal(empty.employees.length, 0);
  assert.equal(empty.models.length, 0);
  assert.equal(empty.schedules.length, 0);
  assert.equal(empty.holidays.length, 0);
  assert.deepEqual(
    empty.rules.map((entry) => entry.id),
    ["global"],
  );
});

test("calendário e grade consolidada calculam cada vínculo com a regra noturna da sua empresa", () => {
  const data = demoData();
  const alpha = data.companies[0],
    beta = data.companies[1];
  const days: Day[] = [
    {
      data: "2026-12-01",
      intervalos: [{ start: "22:00", end: "06:00", endDay: 1 }],
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
  ];
  data.schedules[0].dias = structuredClone(days);
  data.schedules[1].dias = structuredClone(days);
  const night = (
    id: string,
    empresa_id: string | null,
    seconds: number,
  ): LegalRule => ({
    ...rule(id, "2026-01-01", empresa_id),
    chave: "noturno",
    valor: {
      inicio_minutos: 1320,
      fim_minutos: 300,
      hora_reduzida_segundos: seconds,
      adicional_percentual: 20,
    },
  });
  data.rules = [
    night("general", null, 3150),
    night("alpha", alpha.id, 3600),
    night("beta", beta.id, 1800),
  ];
  const before = structuredClone(data);
  const alphaReport = evaluate(days, data.rules, alpha, "2026-12");
  const betaReport = evaluate(days, data.rules, beta, "2026-12");
  assert.equal(alphaReport.total, 480);
  assert.equal(betaReport.total, 900);
  const rows = teamScheduleRows(data, "2026-12", null);
  assert.equal(rows[0].days[0].hours, "2h00");
  assert.equal(rows[1].days[0].hours, "4h00");
  assert.equal(rows[0].days[1].hours, "6h00");
  assert.equal(rows[1].days[1].hours, "11h00");
  assert.equal(
    exportRows(data.schedules[0], data.rules)[0]["Horas computadas"],
    "2h00",
  );
  assert.equal(
    exportRows(data.schedules[1], data.rules)[0]["Horas computadas"],
    "4h00",
  );
  assert.deepEqual(data, before);
});
