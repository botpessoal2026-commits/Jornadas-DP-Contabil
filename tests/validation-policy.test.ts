import test from "node:test";
import assert from "node:assert/strict";
import { demoData } from "../src/lib/demo";
import { evaluate } from "../src/lib/engine";
import { alertsForDate, buildAlertSummary } from "../src/lib/alerts";
import {
  validateSchedule,
  validateScheduleInputs,
} from "../src/lib/validation";
import {
  blocksScheduleApproval,
  classificationForAlert,
  classificationLabel,
} from "../src/lib/validation-policy";
import {
  reviewAttestation,
  transitionEligibility,
} from "../src/lib/schedule-governance";
import type { Alert } from "../src/lib/types";

const alert = (change: Partial<Alert> = {}): Alert => ({
  date: "2026-12-01",
  code: "diario",
  message: "Excesso real",
  rule: "Regra",
  source: "Fonte",
  severity: "erro",
  ...change,
});

test("três níveis mantêm irregularidades bloqueantes e trabalho noturno informativo", () => {
  assert.equal(classificationForAlert(alert()), "bloqueante");
  assert.equal(
    classificationForAlert(alert({ code: "noturno", severity: "aviso" })),
    "informativo",
  );
  assert.equal(
    classificationForAlert(alert({ code: "transicao", severity: "aviso" })),
    "atencao",
  );
  assert.equal(
    classificationForAlert(alert({ code: "nova_regra", severity: "aviso" })),
    "atencao",
  );
  assert.equal(
    classificationLabel(alert({ code: "noturno", severity: "aviso" })),
    "Informativo",
  );
  assert.equal(blocksScheduleApproval(alert()), true);
  assert.equal(
    blocksScheduleApproval(alert({ code: "noturno", severity: "aviso" })),
    false,
  );
  // A future actual night-work violation cannot be downgraded by its code.
  assert.equal(
    classificationForAlert(alert({ code: "noturno" })),
    "bloqueante",
  );
});

test("fonte não conferida é pendência clara que continua bloqueando aprovação", () => {
  for (const code of ["pendente", "sem_intervalo", "sem_compensacao_diaria"]) {
    const item = alert({ code, severity: "aviso" });
    assert.equal(classificationForAlert(item), "atencao");
    assert.equal(blocksScheduleApproval(item), true);
  }
  const summary = buildAlertSummary(
    [
      alert({ code: "noturno", severity: "aviso" }),
      alert({ code: "pendente", severity: "aviso" }),
    ],
    { companyId: "a", companyName: "Empresa" },
  );
  assert.equal(summary.violations.length, 0);
  assert.equal(summary.pendingSources.length, 1);
  assert.equal(summary.attention.length, 0);
  assert.equal(summary.informative.length, 1);
  assert.equal(alertsForDate(summary.groups, "2026-12-01").length, 0);
});

test("entrada central reutiliza motor sem cálculos divergentes na conferência", () => {
  const data = demoData(),
    schedule = data.schedules[0],
    company = data.companies[0];
  const employee = data.employees.find(
    (item) => item.id === schedule.funcionario_id,
  )!;
  const raw = evaluate(
    schedule.dias,
    data.rules,
    company,
    schedule.mes,
    schedule.modelo_tipo,
    employee,
  );
  const actual = validateScheduleInputs(
    schedule.dias,
    data.rules,
    company,
    schedule.mes,
    schedule.modelo_tipo,
    employee,
  );
  assert.deepEqual(actual.alerts, raw.alerts);
  assert.equal(
    actual.reviewCounts.violations,
    actual.summary.violations.length,
  );
  assert.equal(
    actual.reviewCounts.pendingSources,
    actual.summary.pendingSources.length,
  );
  assert.equal(
    actual.reviewCounts.informative,
    actual.summary.informative.length,
  );
});

test("conferência central incorpora dias salvos vizinhos e rejeita pessoa de outra empresa", () => {
  const data = demoData(),
    original = data.schedules[0];
  const schedule = {
    ...original,
    dias: original.dias.filter((day) =>
      day.data.startsWith(original.mes.slice(0, 7)),
    ),
  };
  const neighbor = {
    ...original,
    id: "neighbor",
    mes: "2026-11",
    dias: [
      {
        data: "2026-11-30",
        intervalos: [{ start: "22:00", end: "06:00", endDay: 1 }],
        folga: false,
        feriado: null,
        observacao: "Vizinho salvo real",
      },
    ],
  };
  data.schedules.push(neighbor);
  const reviewed = validateSchedule(data, schedule);
  assert.equal(
    reviewed.schedule.dias.find((day) => day.data === "2026-11-30")?.observacao,
    "Vizinho salvo real",
  );
  assert.throws(
    () => validateSchedule(data, { ...schedule, empresa_id: "outra" }),
    /indisponível/,
  );
});

test("atenção exige justificativa registrada; informativo não impede aprovação", () => {
  const schedule = {
    ...demoData().schedules[0],
    status: "em_revisao" as const,
  };
  const counts = {
    violations: 0,
    pendingSources: 0,
    attention: 1,
    informative: 2,
  };
  assert.match(
    transitionEligibility(schedule, "aprovada", counts)!,
    /justificativa/,
  );
  assert.equal(
    transitionEligibility(
      schedule,
      "aprovada",
      counts,
      "Conferido o trabalho no domingo",
    ),
    null,
  );
  assert.equal(reviewAttestation(counts).atencoes_conferidas, false);
  assert.equal(reviewAttestation(counts, true).atencoes_conferidas, true);
  assert.equal(
    transitionEligibility(schedule, "aprovada", { ...counts, attention: 0 }),
    null,
  );
  assert.match(
    transitionEligibility(schedule, "aprovada", { ...counts, attention: -1 })!,
    /incompleta/,
  );
  assert.match(
    transitionEligibility(schedule, "aprovada", {
      ...counts,
      informative: NaN,
    })!,
    /incompleta/,
  );
});
