import type { Data } from "./store";
import type { Schedule } from "./types";
import { evaluate } from "./engine";
import { buildAlertSummary } from "./alerts";
import { rulesForCompany } from "./company-resources";
import { validationDays } from "./schedule-context";
import { projectSchedule } from "./special-dates";
import { scheduleRegime } from "./work-regime";

/** Drop-in evaluation entry point. It also provides canonical grouped levels. */
export function validateScheduleInputs(...args: Parameters<typeof evaluate>) {
  const [, , company, month, , employee] = args;
  const evaluation = evaluate(...args);
  const summary = buildAlertSummary(evaluation.alerts, {
    companyId: company.id,
    companyName: company.nome,
    employeeId: employee?.id,
    employeeName: employee?.nome,
    month,
  });
  const reviewCounts = {
    violations: summary.counts.violations,
    pendingSources: summary.counts.pendingSources,
    attention: summary.counts.attention,
    informative: summary.informative.length,
  };
  return { ...evaluation, summary, reviewCounts };
}

/** Canonical validation for previews, review and reports using the same inputs. */
export function validateSchedule(data: Data, schedule: Schedule) {
  const company = data.companies.find(
    (item) => item.id === schedule.empresa_id,
  );
  const employee = data.employees.find(
    (item) =>
      item.id === schedule.funcionario_id &&
      item.empresa_id === schedule.empresa_id,
  );
  if (!company || !employee)
    throw new Error(
      "Empresa ou funcionário indisponível para conferir a escala.",
    );
  const rules = rulesForCompany(data.rules, company.id);
  const projected = projectSchedule(
    { ...schedule, dias: validationDays(schedule, data.schedules) },
    company,
    employee,
    data.specialDates ?? [],
    data.establishments ?? [],
    data.holidays,
  );
  const evaluation = validateScheduleInputs(
    projected.dias,
    rules,
    company,
    projected.mes,
    scheduleRegime(projected, data.models),
    employee,
  );
  const { summary, reviewCounts: counts } = evaluation;
  return {
    schedule: projected,
    company,
    employee,
    rules,
    evaluation,
    summary,
    counts,
  };
}
