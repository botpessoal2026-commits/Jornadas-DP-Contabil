import type { Data } from "./store";
import type { Company, Employee, Schedule } from "./types";
import { alertsForDate, buildAlertSummary } from "./alerts";
import {
  computeDay,
  evaluate,
  formatMinutes,
  monthDates,
  span,
} from "./engine";

export type TeamDay = {
  date: string;
  state: "work" | "rest" | "missing" | "invalid";
  hours?: string;
  shifts: string[];
  holiday?: string | null;
  problem: "violation" | "attention" | null;
};
export type TeamRow = {
  company: Company;
  employee: Employee;
  schedule?: Schedule;
  reviewIncomplete: boolean;
  days: TeamDay[];
};

/** Read only saved, authorized schedules with a matching company/employee pair. */
export function teamScheduleRows(
  data: Data,
  month: string,
  companyId: string | null,
): TeamRow[] {
  const companies = new Map(
    data.companies
      .filter((company) => companyId === null || company.id === companyId)
      .map((company) => [company.id, company]),
  );
  const dates = monthDates(month);
  return data.employees
    .filter((employee) => companies.has(employee.empresa_id))
    .map((employee) => {
      const company = companies.get(employee.empresa_id)!;
      const schedule = data.schedules.find(
        (entry) =>
          entry.empresa_id === company.id &&
          entry.funcionario_id === employee.id &&
          entry.mes.slice(0, 7) === month,
      );
      let groups: ReturnType<typeof buildAlertSummary>["groups"] = [];
      let reviewIncomplete = false;
      if (schedule) {
        try {
          const report = evaluate(
            schedule.dias,
            data.rules,
            company,
            schedule.mes,
            schedule.modelo_tipo,
            employee,
          );
          groups = buildAlertSummary(report.alerts, {
            companyId: company.id,
            companyName: company.nome,
            employeeId: employee.id,
            employeeName: employee.nome,
            month,
          }).groups;
        } catch {
          // Invalid legacy shifts are shown for review instead of dropping the row.
          reviewIncomplete = true;
        }
      }
      const days: TeamDay[] = dates.map((date) => {
        const day = schedule?.dias.find((entry) => entry.data === date);
        if (!schedule || !day)
          return { date, state: "missing", shifts: [], problem: null };
        try {
          const result = computeDay(day, data.rules, schedule.dias);
          const alerts = alertsForDate(groups, date);
          return {
            date,
            state: result.worked > 0 ? "work" : "rest",
            hours: formatMinutes(result.computed),
            shifts: day.intervalos.map(
              (shift) =>
                `${shift.start}–${shift.end}${span(shift)[1] >= 1440 ? " (+1)" : ""}`,
            ),
            holiday: day.feriado,
            problem: alerts.some((alert) => alert.category === "violation")
              ? "violation"
              : alerts.some((alert) => alert.category === "attention")
                ? "attention"
                : null,
          };
        } catch {
          return {
            date,
            state: "invalid",
            shifts: [],
            holiday: day.feriado,
            problem: "attention",
          };
        }
      });
      return { company, employee, schedule, days, reviewIncomplete };
    })
    .sort(
      (a, b) =>
        a.company.nome.localeCompare(b.company.nome, "pt-BR") ||
        a.employee.nome.localeCompare(b.employee.nome, "pt-BR"),
    );
}
