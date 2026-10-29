import { buildAlertSummary } from "./alerts";
import { scheduleRegime } from "./work-regime";
import { evaluate, holidayAt } from "./engine";
import {
  holidaysForCompany,
  modelsForCompany,
  rulesForCompany,
} from "./company-resources";
import type { Data } from "./store";
import type { Company, Employee, Model } from "./types";
import { projectData } from "./special-dates";
import { applicableHolidayDates } from "./workspace-improvements";

export type CompanySituation = "ativa" | "inativa" | "arquivada";
export type CompanyView =
  | "visao_geral"
  | "funcionarios"
  | "modelos"
  | "escalas"
  | "feriados"
  | "regras"
  | "configuracoes"
  | "historico"
  | "operacoes"
  | "relatorios";

/** Missing legacy status means active; it is not an authorization decision. */
export function companySituation(company: Company): CompanySituation {
  return company.situacao ?? "ativa";
}
export function isCompanyActive(company: Company) {
  return companySituation(company) === "ativa";
}
export function companyDisplayName(company: Company) {
  return company.nome_fantasia?.trim() || company.nome;
}
export function matchesCompanySearch(company: Company, query: string) {
  const normalize = (value: string) =>
    value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
  const search = normalize(query.trim());
  if (!search) return true;
  if (
    [
      company.nome,
      company.nome_fantasia ?? "",
      company.codigo_interno ?? "",
      company.cidade,
      company.uf,
      companySituation(company),
    ].some((field) => normalize(field).includes(search))
  )
    return true;
  const digits = search.replace(/\D/g, "");
  return Boolean(
    digits && /^[\d\s./-]+$/.test(search) && company.cnpj.includes(digits),
  );
}
export function formatCompanyCnpj(value: string) {
  return /^\d{14}$/.test(value)
    ? value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : value || "CNPJ não informado";
}

/** A company context never broadens the user's already authorized Data result. */
export function scopeCompanyData(data: Data, companyId: string): Data {
  const company = data.companies.find((entry) => entry.id === companyId);
  if (!company)
    return {
      companies: [],
      employees: [],
      models: [],
      schedules: [],
      holidays: [],
      logs: [],
      rules: [],
      specialDates: [],
      establishments: [],
      operations: [],
      scheduleVersions: [],
    };
  const employees = data.employees.filter(
    (entry) => entry.empresa_id === companyId,
  );
  const employeeIds = new Set(employees.map((entry) => entry.id));
  return {
    ...data,
    companies: [company],
    operations: (data.operations ?? []).filter(
      (entry) => entry.empresa_id === companyId,
    ),
    scheduleVersions: (data.scheduleVersions ?? []).filter(
      (entry) => entry.empresa_id === companyId,
    ),
    specialDates: (data.specialDates ?? []).filter(
      (event) => event.empresa_id === companyId,
    ),
    establishments: (data.establishments ?? []).filter(
      (unit) => unit.empresa_id === companyId,
    ),
    employees,
    models: data.models.filter((entry) => entry.empresa_id === companyId),
    rules: rulesForCompany(data.rules, companyId),
    schedules: data.schedules.filter(
      (entry) =>
        entry.empresa_id === companyId && employeeIds.has(entry.funcionario_id),
    ),
    holidays: holidaysForCompany(data.holidays, companyId).filter(
      (holiday) =>
        Boolean(holidayAt(holiday.data, [holiday], company)) ||
        (data.establishments ?? []).some(
          (unit) =>
            unit.empresa_id === companyId &&
            Boolean(
              holidayAt(holiday.data, [holiday], {
                ...company,
                cidade: unit.cidade,
                uf: unit.uf,
              }),
            ),
        ),
    ),
    // Old events without a reliable company stay in the global history only.
    logs: data.logs.filter(
      (entry) =>
        (entry as typeof entry & { empresa_id?: string | null }).empresa_id ===
        companyId,
    ),
  };
}

export type ModelOrigin =
  "explicit" | "employee" | "company" | "fallback" | "none";
export function resolveEmployeeModelWithOrigin(
  employee: Employee,
  company: Company,
  models: Model[],
  explicitModelId?: string,
  legacyModelIds: readonly (string | null | undefined)[] = [],
): { model: Model | undefined; origin: ModelOrigin } {
  if (employee.empresa_id !== company.id)
    return { model: undefined, origin: "none" };
  const available = modelsForCompany(models, company.id, [
    employee.modelo_padrao_id,
    company.modelo_padrao_id,
    ...legacyModelIds,
  ]);
  for (const [id, origin] of [
    [explicitModelId, "explicit"],
    [employee.modelo_padrao_id, "employee"],
    [company.modelo_padrao_id, "company"],
  ] as const) {
    const model = id ? available.find((entry) => entry.id === id) : undefined;
    if (model) return { model, origin };
  }
  const fallback = available.find((model) => model.empresa_id === company.id);
  return { model: fallback, origin: fallback ? "fallback" : "none" };
}
export function resolveEmployeeModel(
  employee: Employee,
  company: Company,
  models: Model[],
  explicitModelId?: string,
  legacyModelIds: readonly (string | null | undefined)[] = [],
) {
  return resolveEmployeeModelWithOrigin(
    employee,
    company,
    models,
    explicitModelId,
    legacyModelIds,
  ).model;
}

export function companySummary(data: Data, company: Company, month: string) {
  data = projectData(data);
  const scoped = scopeCompanyData(data, company.id);
  const active = scoped.employees.filter(
    (employee) => employee.situacao !== "inativo",
  );
  const schedules = scoped.schedules.filter((schedule) =>
    schedule.mes.startsWith(month.slice(0, 7)),
  );
  const scheduled = new Set(
    schedules.map((schedule) => schedule.funcionario_id),
  );
  let violations = 0,
    attention = 0,
    pendingSources = 0;
  const calculationErrors: { scheduleId: string; message: string }[] = [];
  for (const schedule of schedules) {
    const employee = scoped.employees.find(
      (entry) => entry.id === schedule.funcionario_id,
    );
    try {
      const report = evaluate(
        schedule.dias,
        scoped.rules,
        company,
        schedule.mes,
        scheduleRegime(schedule, scoped.models),
        employee,
      );
      const summary = buildAlertSummary(report.alerts, {
        companyId: company.id,
        companyName: company.nome,
        employeeId: employee?.id,
        employeeName: employee?.nome ?? schedule.nome_funcionario,
        month,
      });
      violations += summary.counts.violations;
      attention += summary.counts.attention;
      pendingSources += summary.counts.pendingSources;
    } catch (error) {
      calculationErrors.push({
        scheduleId: schedule.id,
        message:
          error instanceof Error
            ? error.message
            : "Dados de horário inválidos; revise a escala.",
      });
    }
  }
  return {
    employees: active.length,
    totalEmployees: scoped.employees.length,
    savedSchedules: schedules.length,
    missingSchedules: active.filter((employee) => !scheduled.has(employee.id))
      .length,
    violations,
    attention,
    pendingSources,
    unreadableSchedules: calculationErrors.length,
    calculationErrors,
    applicableHolidays: applicableHolidayDates(scoped, company, month).length,
  };
}
