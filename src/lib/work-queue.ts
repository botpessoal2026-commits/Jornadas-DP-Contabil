import type { Data } from "./store";
import type { Company, Employee } from "./types";
import { evaluate } from "./engine";
import { rulesForCompany } from "./company-resources";
import { buildAlertSummary } from "./alerts";
import { scheduleRegime } from "./work-regime";

export type WorkQueueKind =
  "sem_escala" | "contrato" | "impedimento" | "fontes" | "conferencia";
export type WorkQueueItem = {
  id: string;
  kind: WorkQueueKind;
  company: Company;
  employee: Employee;
  month: string;
  title: string;
  description: string;
  count: number;
  action: "employee" | "schedule" | "rules";
};

export const workQueueLabels: Record<WorkQueueKind, string> = {
  sem_escala: "Sem escala",
  contrato: "Contrato a conferir",
  impedimento: "Impedimentos",
  fontes: "Fontes pendentes",
  conferencia: "Conferência indisponível",
};
const priority: Record<WorkQueueKind, number> = {
  impedimento: 0,
  conferencia: 1,
  contrato: 2,
  fontes: 3,
  sem_escala: 4,
};
const normalized = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

/** Accepts effective calendar data from the workspace; never replaces its resolved boundaries. */
export function buildWorkQueue(data: Data, month: string): WorkQueueItem[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const companies = new Map(
    data.companies
      .filter((company) => (company.situacao ?? "ativa") === "ativa")
      .map((company) => [company.id, company]),
  );
  const schedules = new Map(
    data.schedules
      .filter((schedule) => schedule.mes.slice(0, 7) === month)
      .map((schedule) => [
        JSON.stringify([schedule.empresa_id, schedule.funcionario_id]),
        schedule,
      ]),
  );
  const rules = new Map(
    [...companies.values()].map((company) => [
      company.id,
      rulesForCompany(data.rules, company.id),
    ]),
  );
  const items: WorkQueueItem[] = [];
  for (const employee of data.employees) {
    const company = companies.get(employee.empresa_id);
    if (!company || employee.situacao === "inativo") continue;
    const add = (
      kind: WorkQueueKind,
      description: string,
      count: number,
      action: WorkQueueItem["action"],
    ) =>
      items.push({
        id: JSON.stringify([kind, company.id, employee.id, month]),
        kind,
        company,
        employee,
        month,
        title: workQueueLabels[kind],
        description,
        count,
        action,
      });
    // The existing validator requires explicit weekly load. Daily load is
    // optional; this queue does not invent a new mandatory contract rule.
    if (
      !Number.isInteger(employee.carga_semanal_minutos) ||
      !employee.carga_semanal_minutos ||
      employee.carga_semanal_minutos < 1 ||
      employee.carga_semanal_minutos > 10080
    ) {
      add(
        "contrato",
        "Carga semanal contratual ausente ou inválida. Confira o cadastro do vínculo.",
        1,
        "employee",
      );
    } else if (
      employee.carga_diaria_minutos != null &&
      (!Number.isInteger(employee.carga_diaria_minutos) ||
        employee.carga_diaria_minutos < 1 ||
        employee.carga_diaria_minutos > 1440)
    ) {
      add(
        "contrato",
        "Carga diária contratual inválida. Confira o cadastro do vínculo.",
        1,
        "employee",
      );
    }
    const schedule = schedules.get(JSON.stringify([company.id, employee.id]));
    if (!schedule) {
      add(
        "sem_escala",
        "Não há escala salva para este funcionário nesta competência. Folga registrada é diferente de ausência de escala.",
        1,
        "schedule",
      );
      continue;
    }
    try {
      const report = evaluate(
        schedule.dias,
        rules.get(company.id)!,
        company,
        schedule.mes,
        scheduleRegime(schedule, data.models),
        employee,
      );
      const summary = buildAlertSummary(report.alerts, {
        companyId: company.id,
        companyName: company.nome,
        employeeId: employee.id,
        employeeName: employee.nome,
        month,
      });
      if (summary.counts.violations)
        add(
          "impedimento",
          `${summary.counts.violations} grupo(s) · ${summary.occurrenceCounts.violations} ocorrência(s). ${summary.violations
            .map((group) => group.title)
            .slice(0, 2)
            .join("; ")}.`,
          summary.counts.violations,
          "schedule",
        );
      if (summary.counts.pendingSources)
        add(
          "fontes",
          `${summary.counts.pendingSources} grupo(s) de fontes ou parâmetros pendentes nesta escala. Pendência documental não é excesso de jornada.`,
          summary.counts.pendingSources,
          "rules",
        );
    } catch {
      add(
        "conferencia",
        "Não foi possível conferir os horários salvos. Abra a escala para revisar os dados antes de concluir a competência.",
        1,
        "schedule",
      );
    }
  }
  return items.sort(
    (a, b) =>
      priority[a.kind] - priority[b.kind] ||
      a.company.nome.localeCompare(b.company.nome, "pt-BR") ||
      a.employee.nome.localeCompare(b.employee.nome, "pt-BR") ||
      a.id.localeCompare(b.id),
  );
}

export function filterWorkQueue(
  items: WorkQueueItem[],
  filters: { query?: string; companyId?: string; kind?: string },
) {
  const query = normalized(filters.query ?? "");
  return items.filter(
    (item) =>
      (!filters.companyId || item.company.id === filters.companyId) &&
      (!filters.kind || item.kind === filters.kind) &&
      (!query ||
        normalized(
          `${item.company.nome} ${item.employee.nome} ${item.employee.matricula ?? ""} ${item.employee.setor ?? ""} ${item.title}`,
        ).includes(query)),
  );
}
