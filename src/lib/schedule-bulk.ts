import { validateScheduleInputs } from "./validation";
import { buildAlertSummary } from "./alerts";
import { rulesForCompany } from "./company-resources";
import { minutes, monthDates } from "./engine";
import { projectData } from "./special-dates";
import { scheduleRegime } from "./work-regime";
import type { Data } from "./store";
import type { DayPlan, Schedule, Shift } from "./types";

export type BulkReview = {
  schedule: Schedule;
  employeeName: string;
  violations: number;
  attention: number;
  pending: number;
  total: number;
  clockTotal: number;
  error?: string;
};

/** Reuse the same calendar projection and validator for every selected person. */
export function reviewBulkSchedules(
  data: Data,
  schedules: Schedule[],
): BulkReview[] {
  const identities = new Set<string>();
  for (const schedule of schedules) {
    const key = `${schedule.empresa_id}:${schedule.funcionario_id}:${schedule.mes.slice(0, 7)}`;
    if (identities.has(key))
      throw new Error(
        "O lote contém uma escala repetida para o mesmo funcionário e competência.",
      );
    identities.add(key);
  }
  const projected = projectData({
    ...data,
    schedules: [
      ...data.schedules.filter(
        (schedule) =>
          !identities.has(
            `${schedule.empresa_id}:${schedule.funcionario_id}:${schedule.mes.slice(0, 7)}`,
          ),
      ),
      ...schedules,
    ],
  });
  return schedules.map((source) => {
    const company = data.companies.find(
      (entry) => entry.id === source.empresa_id,
    );
    const employee = data.employees.find(
      (entry) =>
        entry.id === source.funcionario_id &&
        entry.empresa_id === source.empresa_id,
    );
    const schedule = projected.schedules.find(
      (entry) =>
        entry.empresa_id === source.empresa_id &&
        entry.funcionario_id === source.funcionario_id &&
        entry.mes.slice(0, 7) === source.mes.slice(0, 7),
    )!;
    const base = {
      schedule,
      employeeName: employee?.nome ?? "Funcionário indisponível",
      violations: 0,
      attention: 0,
      pending: 0,
      total: 0,
      clockTotal: 0,
    };
    try {
      if (!company || !employee)
        throw new Error("Vínculo fora da empresa autorizada.");
      if (
        (company.situacao ?? "ativa") !== "ativa" ||
        employee.situacao === "inativo"
      )
        throw new Error(
          "Empresa ou vínculo inativo; somente consulta permitida.",
        );
      const result = validateScheduleInputs(
        schedule.dias,
        rulesForCompany(projected.rules, company.id),
        company,
        schedule.mes,
        scheduleRegime(schedule, projected.models),
        employee,
      );
      const summary = result.summary;
      return {
        ...base,
        violations: summary.counts.violations,
        attention: summary.counts.attention,
        pending: summary.counts.pendingSources,
        total: result.total,
        clockTotal: result.clockTotal,
      };
    } catch (error) {
      return {
        ...base,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível conferir esta escala.",
      };
    }
  });
}

/** Explicit individual changes keep original plans and coincident holiday nature. */
export function applyBulkDayChanges(
  schedule: Schedule,
  dates: string[],
  shifts: Shift[] | null,
  notes?: string,
): Schedule {
  const allowed = new Set(monthDates(schedule.mes.slice(0, 7)));
  const chosen = new Set(dates);
  if (!chosen.size) throw new Error("Selecione ao menos um dia para editar.");
  if (
    [...chosen].some(
      (date) =>
        !allowed.has(date) || !schedule.dias.some((day) => day.data === date),
    )
  )
    throw new Error("A seleção contém um dia fora desta escala.");
  if (shifts !== null && (!shifts.length || minutes(shifts) <= 0))
    throw new Error("Informe períodos válidos para o trabalho.");
  return {
    ...schedule,
    dias: schedule.dias.map((day) => {
      if (!chosen.has(day.data)) return day;
      const base: DayPlan = day.calendario?.base ?? {
        intervalos: structuredClone(day.intervalos),
        folga: day.folga,
        feriado: day.feriado,
        observacao: day.observacao,
      };
      const intervals = structuredClone(shifts ?? []);
      const observation =
        notes ?? day.calendario?.excecao?.observacao ?? base.observacao;
      return {
        ...day,
        intervalos: intervals,
        folga: intervals.length === 0,
        observacao: observation,
        calendario: {
          ...day.calendario,
          base: structuredClone(base),
          excecao: {
            categoria: shifts === null ? "folga" : "trabalho",
            nome: "",
            expediente: shifts === null ? "sem_expediente" : "normal",
            intervalos: structuredClone(intervals),
            observacao: observation,
          },
        },
      };
    }),
  };
}
