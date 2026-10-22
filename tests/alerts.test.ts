import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alertsForDate,
  buildAlertSummary,
  classifyAlert,
  periodForAlert,
} from "../src/lib/alerts";
import { evaluate, generateDays } from "../src/lib/engine";
import { demoData } from "../src/lib/demo";
import type { Alert } from "../src/lib/types";

const context = {
  companyId: "company-a",
  companyName: "Empresa A",
  employeeId: "employee-a",
  employeeName: "Ana",
  month: "2026-12",
};
const issue = (change: Partial<Alert> = {}): Alert => ({
  date: "2026-12-01",
  code: "diario",
  message: "14h00 supera limite diário de 8h00.",
  rule: "Limite diário",
  source: "Fonte cadastrada",
  severity: "erro",
  ...change,
});

test("violações são prioritárias; ausência de configuração não infla contador trabalhista", () => {
  const summary = buildAlertSummary(
    [
      issue({ code: "pendente", severity: "aviso" }),
      issue({ code: "sem_regime" }),
      issue({ code: "noturno", severity: "aviso" }),
      issue(),
    ],
    context,
  );
  assert.deepEqual(summary.counts, {
    violations: 1,
    attention: 1,
    pendingSources: 2,
  });
  assert.deepEqual(
    summary.groups.map((group) => group.category),
    ["violation", "attention", "pending_source", "pending_source"],
  );
  assert.equal(
    classifyAlert(issue({ code: "contrato_pendente" })),
    "attention",
  );
  assert.equal(
    classifyAlert(issue({ code: "sem_intervalo" })),
    "pending_source",
  );
});

test("incompatibilidade repetida 6x1 agrupa ocorrências preservando cada período", () => {
  const message =
    "Escala 6x1 não autorizada na configuração da empresa. Confira a CCT.";
  const summary = buildAlertSummary(
    [
      issue({ code: "6x1", date: "2026-12-07", message }),
      issue({ code: "6x1", date: "2026-12-14", message }),
    ],
    context,
  );
  assert.equal(summary.violations.length, 1);
  const group = summary.violations[0];
  assert.equal(group.count, 2);
  assert.deepEqual(group.dates, ["2026-12-07", "2026-12-14"]);
  assert.deepEqual(group.periods, [
    { start: "2026-12-07", end: "2026-12-13" },
    { start: "2026-12-14", end: "2026-12-20" },
  ]);
  assert.deepEqual(summary.occurrenceCounts, {
    violations: 2,
    attention: 0,
    pendingSources: 0,
  });
  assert.equal(group.companyName, "Empresa A");
  assert.equal(group.employeeName, "Ana");
  assert.equal(group.action, "period");
});

test("datas nas mensagens semanais identificam ocorrências da mesma incompatibilidade", () => {
  const summary = buildAlertSummary(
    [
      issue({
        code: "semanal",
        date: "2026-12-07",
        message: "Semana 2026-12-07: 50h00 excede 44h00.",
      }),
      issue({
        code: "semanal",
        date: "2026-12-14",
        message: "Semana 2026-12-14: 50h00 excede 44h00.",
      }),
    ],
    context,
  );
  assert.equal(summary.violations.length, 1);
  assert.equal(summary.violations[0].count, 2);
  assert.match(summary.violations[0].occurrences[1].message, /2026-12-14/);
});

test("limites e fontes diferentes não se perdem ao agrupar", () => {
  const summary = buildAlertSummary(
    [
      issue(),
      issue({ message: "14h00 supera limite diário de 6h00." }),
      issue({ source: "Outra categoria/CCT" }),
      issue({ ruleId: "outra-revisao-da-regra" }),
    ],
    context,
  );
  assert.equal(summary.violations.length, 4);
});

test("identificadores são estáveis na reordenação e específicos de empresa/funcionário", () => {
  const alerts = [issue(), issue({ date: "2026-12-02" })];
  const initial = buildAlertSummary(alerts, context).violations[0];
  const reordered = buildAlertSummary([...alerts].reverse(), context)
    .violations[0];
  assert.equal(initial.id, reordered.id);
  assert.deepEqual(
    initial.occurrences.map((o) => o.id),
    reordered.occurrences.map((o) => o.id),
  );
  assert.notEqual(
    initial.id,
    buildAlertSummary(alerts, { ...context, employeeId: "employee-b" })
      .violations[0].id,
  );
  assert.notEqual(
    initial.id,
    buildAlertSummary(alerts, { ...context, companyId: "company-b" })
      .violations[0].id,
  );
  assert.equal(
    buildAlertSummary([...alerts, ...alerts], context).violations[0].count,
    2,
  );
});

test("calendário marca todos os dias da semana, sem pintar pendência de fonte/contrato", () => {
  const summary = buildAlertSummary(
    [
      issue({ code: "semanal" }),
      issue({ code: "pendente", severity: "aviso" }),
      issue({ code: "contrato_pendente", severity: "aviso" }),
    ],
    context,
  );
  assert.equal(alertsForDate(summary.groups, "2026-11-30").length, 1);
  assert.equal(alertsForDate(summary.groups, "2026-12-06").length, 1);
  assert.equal(alertsForDate(summary.groups, "2026-12-07").length, 0);
  assert.equal(alertsForDate(summary.groups, "2026-12-01")[0].code, "semanal");
});

test("violações diárias marcam somente a data; períodos explícitos são respeitados", () => {
  const summary = buildAlertSummary(
    [
      issue(),
      issue({
        code: "semanal",
        period: { start: "2026-12-08", end: "2026-12-10" },
      }),
    ],
    context,
  );
  assert.equal(alertsForDate(summary.groups, "2026-12-01").length, 1);
  assert.equal(alertsForDate(summary.groups, "2026-12-02").length, 0);
  assert.equal(alertsForDate(summary.groups, "2026-12-09").length, 1);
  assert.equal(periodForAlert({ date: "abc", code: "semanal" }), undefined);
});

test("motor oferece referência de regra e período semanal sem alterar alertas legados", () => {
  const data = demoData();
  const company = { ...data.companies[0], permite_6x1: false };
  const model = data.models.find((model) => model.tipo === "6x1")!;
  const rules = data.rules.filter(
    (rule) => rule.chave !== "regime" || rule.inicio_vigencia === "1988-10-05",
  );
  const report = evaluate(
    generateDays("2026-12", model, company, []),
    rules,
    company,
    "2026-12",
    model.tipo,
    data.employees[0],
  );
  const repeated = report.alerts.filter((alert) => alert.code === "6x1");
  assert.ok(repeated.length > 1);
  assert.ok(repeated.every((alert) => alert.ruleId && alert.period));
  const summary = buildAlertSummary(report.alerts, context);
  assert.equal(
    summary.violations.filter((group) => group.code === "6x1").length,
    1,
  );
  assert.equal(
    summary.violations.find((group) => group.code === "6x1")!.count,
    repeated.length,
  );
});
