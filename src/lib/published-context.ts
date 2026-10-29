import { loadScheduleVersions, type Data } from "./store";
import type { Company, Employee, LegalRule, Schedule } from "./types";
import type { ScheduleVersion } from "./schedule-governance";
import { rulesForCompany } from "./company-resources";
import { employeeLocation, projectData } from "./special-dates";

export type PublishedReportContext = {
  data: Data;
  schedule: Schedule;
  company: Company;
  employee: Employee;
  rules: LegalRule[];
  version?: ScheduleVersion;
};

export function usesPublishedContext(schedule: Schedule) {
  return schedule.status === "publicada" || schedule.status === "fechada";
}

function contextFrom(data: Data, schedule: Schedule): PublishedReportContext {
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
      "A escala não corresponde a uma empresa e funcionário disponíveis.",
    );
  if (!/^\d{4}-(0[1-9]|1[0-2])(?:-01)?$/.test(schedule.mes))
    throw new Error("A competência da escala é inválida.");
  return {
    data,
    schedule,
    company: employeeLocation(company, employee, data.establishments ?? []),
    employee,
    rules: rulesForCompany(data.rules, company.id),
  };
}

/** A version is usable only for this authorized schedule and its frozen context. */
function snapshotContext(
  version: ScheduleVersion,
  target: Schedule,
): PublishedReportContext {
  const snapshot = version.snapshot;
  const raw = snapshot?.data;
  const arrays = [
    "companies",
    "employees",
    "models",
    "rules",
    "holidays",
    "schedules",
    "logs",
  ] as const;
  if (
    snapshot?.schema_version !== 1 ||
    !raw ||
    arrays.some((key) => !Array.isArray(raw[key]))
  )
    throw new Error(
      "A versão publicada está incompleta. Consulte o histórico antes de emitir o documento.",
    );
  if (
    raw.companies.some((item) => item.id !== target.empresa_id) ||
    raw.employees.some(
      (item) =>
        item.empresa_id !== target.empresa_id ||
        item.id !== target.funcionario_id,
    ) ||
    raw.schedules.some(
      (item) =>
        item.empresa_id !== target.empresa_id ||
        item.funcionario_id !== target.funcionario_id,
    )
  )
    throw new Error(
      "A versão publicada não corresponde ao contexto desta pessoa e empresa.",
    );
  for (const items of [raw.models, raw.rules, raw.holidays]) {
    if (
      items.some(
        (item) => item.empresa_id && item.empresa_id !== target.empresa_id,
      )
    )
      throw new Error("A versão publicada contém recursos de outra empresa.");
  }
  if (
    (raw.specialDates ?? []).some(
      (item) => item.empresa_id !== target.empresa_id,
    ) ||
    (raw.establishments ?? []).some(
      (item) => item.empresa_id !== target.empresa_id,
    )
  )
    throw new Error("A versão publicada contém recursos de outra empresa.");
  const frozen = raw.schedules.find(
    (item) =>
      item.id === target.id &&
      item.empresa_id === target.empresa_id &&
      item.funcionario_id === target.funcionario_id &&
      item.mes.slice(0, 7) === target.mes.slice(0, 7),
  );
  if (
    !frozen ||
    !Array.isArray(frozen.dias) ||
    (frozen.revisao !== undefined && frozen.revisao !== version.revisao)
  )
    throw new Error(
      "A escala da versão publicada está indisponível ou possui revisão incompatível.",
    );
  // Project only the snapshot's adjacent days, dates, employees and parameters.
  const data = projectData(structuredClone(raw));
  // Consumers may pass this isolated context into another report surface.
  // Keep its publication available without loading or reverting to live data.
  data.scheduleVersions = [version];
  const schedule = data.schedules.find((item) => item.id === frozen.id)!;
  return { ...contextFrom(data, schedule), version };
}

/** Current drafts use their displayed projection; published documents use a snapshot. */
export async function resolvePublishedContext(
  data: Data,
  schedule: Schedule,
  loadVersions: typeof loadScheduleVersions = loadScheduleVersions,
): Promise<PublishedReportContext> {
  const current = contextFrom(data, schedule);
  if (!usesPublishedContext(schedule)) return current;
  const eligible = (items: ScheduleVersion[]) =>
    items
      .filter(
        (version) =>
          version.escala_id === schedule.id &&
          version.empresa_id === schedule.empresa_id &&
          Number.isInteger(version.versao) &&
          version.versao > 0 &&
          Number.isInteger(version.revisao) &&
          version.revisao >= 0 &&
          (schedule.revisao === undefined ||
            version.revisao <= schedule.revisao!),
      )
      .sort((a, b) => b.versao - a.versao || b.revisao - a.revisao);
  let version = eligible(data.scheduleVersions ?? [])[0];
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const realReference =
    uuid.test(schedule.id) && uuid.test(schedule.empresa_id);
  // A cached previous publication is not sufficient after reopening/republication.
  // Closed schedules have advanced revisions, so recheck their latest server version.
  const refreshVersions =
    realReference &&
    (schedule.status === "fechada" || version?.revisao !== schedule.revisao);
  if (!version || refreshVersions) {
    if (!realReference)
      throw new Error(
        "A versão publicada não está disponível nesta demonstração. Consulte o histórico ou reabra a escala.",
      );
    version = eligible(await loadVersions(schedule.empresa_id, schedule.id))[0];
  }
  if (!version)
    throw new Error(
      "Não foi encontrada uma versão publicada desta escala. Consulte o histórico antes de emitir o documento.",
    );
  return snapshotContext(version, schedule);
}
