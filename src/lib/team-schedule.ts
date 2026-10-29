import { validateScheduleInputs } from "./validation";
import type { Data } from "./store";
import type { Company, Employee, Schedule } from "./types";
import { alertsForDate, buildAlertSummary } from "./alerts";
import { rulesForCompany } from "./company-resources";
import { scheduleRegime } from "./work-regime";
import { projectData, dayPresentation } from "./special-dates";
import { computeDay, formatMinutes, monthDates, span } from "./engine";

export type TeamDay = {
  date: string;
  state: "work" | "rest" | "missing" | "invalid";
  hours?: string;
  shifts: string[];
  holiday?: string | null;
  problem: "violation" | "attention" | null;
  eventLabel?: string;
  dayKind?: string;
};
export type TeamRow = {
  company: Company;
  employee: Employee;
  schedule?: Schedule;
  reviewIncomplete: boolean;
  days: TeamDay[];
};

export type TeamFilters = {
  query?: string;
  sector?: string;
  establishmentId?: string;
  regime?: string;
  status?: "all" | "active" | "inactive";
  schedule?: "all" | "missing" | "violation" | "attention";
};

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

/** Filters saved calendars, never inferring rest from a missing record. */
export function filterTeamRows(
  rows: TeamRow[],
  filters: TeamFilters,
  models: Data["models"] = [],
): TeamRow[] {
  const query = normalized(filters.query ?? "");
  return rows.filter((row) => {
    const active =
      row.employee.situacao !== "inativo" &&
      (row.company.situacao ?? "ativa") === "ativa";
    const model = models.find(
      (entry) =>
        entry.id ===
          (row.schedule?.modelo_id ??
            row.employee.modelo_padrao_id ??
            row.company.modelo_padrao_id) &&
        (entry.empresa_id === row.company.id || entry.empresa_id === null),
    );
    return (
      (!query ||
        normalized(
          `${row.employee.nome} ${row.employee.matricula ?? ""} ${row.employee.setor ?? ""} ${row.company.nome}`,
        ).includes(query)) &&
      (!filters.sector || row.employee.setor === filters.sector) &&
      (!filters.establishmentId ||
        (filters.establishmentId === "__main"
          ? !row.employee.estabelecimento_id
          : row.employee.estabelecimento_id === filters.establishmentId)) &&
      (!filters.regime ||
        (row.schedule?.modelo_tipo ?? model?.tipo) === filters.regime) &&
      (!filters.status ||
        filters.status === "all" ||
        (filters.status === "active" ? active : !active)) &&
      (!filters.schedule ||
        filters.schedule === "all" ||
        (filters.schedule === "missing"
          ? row.days.some((day) => day.state === "missing")
          : row.days.some(
              (day) =>
                day.problem ===
                (filters.schedule === "violation" ? "violation" : "attention"),
            )))
    );
  });
}

/** Read only saved, authorized schedules with a matching company/employee pair. */
export function teamScheduleRows(
  data: Data,
  month: string,
  companyId: string | null,
): TeamRow[] {
  data = projectData(data);
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
      const rules = rulesForCompany(data.rules, company.id);
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
          const report = validateScheduleInputs(
            schedule.dias,
            rules,
            company,
            schedule.mes,
            scheduleRegime(schedule, data.models),
            employee,
          );
          groups = report.summary.groups;
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
          const result = computeDay(day, rules, schedule.dias);
          const presentation = dayPresentation(day, schedule.dias);
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
            eventLabel: presentation.description || undefined,
            dayKind: presentation.kind,
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
