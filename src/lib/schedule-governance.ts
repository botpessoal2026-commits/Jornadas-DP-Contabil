import type { Data } from "./store";
import type { Schedule, ScheduleReview, ScheduleStatus } from "./types";

export const scheduleStatusLabels: Record<ScheduleStatus, string> = {
  rascunho: "Rascunho",
  em_revisao: "Em revisão",
  aprovada: "Aprovada",
  publicada: "Publicada",
  fechada: "Fechada",
};
export type ScheduleSnapshot = {
  schema_version: 1;
  data: Data;
};
export type ScheduleVersion = {
  id: string;
  escala_id: string;
  empresa_id: string;
  revisao: number;
  versao: number;
  publicado_em: string;
  publicado_por: string;
  justificativa: string;
  snapshot: ScheduleSnapshot;
};
export type ReviewCounts = { violations: number; pendingSources: number };

export function scheduleStatus(schedule: Schedule): ScheduleStatus {
  return schedule.status ?? "rascunho";
}
export function isScheduleLocked(schedule: Schedule) {
  return ["aprovada", "publicada", "fechada"].includes(
    scheduleStatus(schedule),
  );
}

/** Legal validation stays in the existing engine; this adds a workflow gate. */
export function transitionEligibility(
  schedule: Schedule,
  next: ScheduleStatus,
  review: ReviewCounts,
  reason = "",
): string | null {
  if (
    ![review.violations, review.pendingSources].every(
      (value) => Number.isInteger(value) && value >= 0,
    )
  )
    return "A conferência da escala está incompleta. Atualize os dados.";
  if (!schedule.id) return "Salve a escala antes de encaminhar para revisão.";
  const current = scheduleStatus(schedule);
  if (current === next) return "A escala já está nessa situação.";
  const forwards: Partial<Record<ScheduleStatus, ScheduleStatus>> = {
    rascunho: "em_revisao",
    em_revisao: "aprovada",
    aprovada: "publicada",
    publicada: "fechada",
  };
  if (next === "rascunho" && current !== "rascunho") {
    return reason.trim().length >= 10
      ? null
      : "Informe uma justificativa de pelo menos 10 caracteres para reabrir.";
  }
  if (forwards[current] !== next)
    return "Conclua as etapas de revisão, aprovação e publicação na ordem.";
  if (["aprovada", "publicada", "fechada"].includes(next)) {
    if (review.violations > 0)
      return "Resolva os impedimentos antes de aprovar, publicar ou fechar.";
    if (review.pendingSources > 0)
      return "Confira as fontes e regras pendentes antes de aprovar, publicar ou fechar.";
  }
  return null;
}

export function reviewAttestation(review: ReviewCounts): ScheduleReview {
  return {
    conferida: true,
    impedimentos: review.violations,
    fontes_pendentes: review.pendingSources,
  };
}

/** Capture raw calendar inputs as well as the schedule, not just display text. */
export function buildScheduleSnapshot(
  data: Data,
  schedule: Schedule,
): ScheduleSnapshot {
  const company = data.companies.find(
    (entry) => entry.id === schedule.empresa_id,
  );
  const employee = data.employees.find(
    (entry) =>
      entry.id === schedule.funcionario_id &&
      entry.empresa_id === schedule.empresa_id,
  );
  if (!company || !employee)
    throw new Error("Empresa ou funcionário indisponível para a versão.");
  const context: Data = {
    companies: [company],
    employees: [employee],
    models: data.models.filter(
      (entry) => !entry.empresa_id || entry.empresa_id === company.id,
    ),
    rules: data.rules.filter(
      (entry) => !entry.empresa_id || entry.empresa_id === company.id,
    ),
    holidays: data.holidays.filter(
      (entry) => !entry.empresa_id || entry.empresa_id === company.id,
    ),
    schedules: data.schedules
      .filter(
        (entry) =>
          entry.funcionario_id === employee.id &&
          entry.empresa_id === company.id,
      )
      .map((entry) => (entry.id === schedule.id ? schedule : entry)),
    logs: [],
    specialDates: (data.specialDates ?? []).filter(
      (entry) => entry.empresa_id === company.id,
    ),
    establishments: (data.establishments ?? []).filter(
      (entry) => entry.empresa_id === company.id,
    ),
  };
  if (!context.schedules.some((entry) => entry.id === schedule.id))
    context.schedules.push(schedule);
  return JSON.parse(
    JSON.stringify({ schema_version: 1, data: context }),
  ) as ScheduleSnapshot;
}

export function applyDemoTransition(
  data: Data,
  schedule: Schedule,
  next: ScheduleStatus,
  reason: string,
  actor = "demo-user",
  review: ReviewCounts = { violations: 0, pendingSources: 0 },
  now = new Date().toISOString(),
): Data {
  const current = data.schedules.find((entry) => entry.id === schedule.id);
  if (!current || current.empresa_id !== schedule.empresa_id)
    throw new Error("Escala indisponível para esta empresa.");
  if ((current.revisao ?? 0) !== (schedule.revisao ?? 0))
    throw new Error(
      "A escala foi alterada em outra sessão. Atualize antes de continuar.",
    );
  const error = transitionEligibility(current, next, review, reason);
  if (error) throw new Error(error);
  const updated: Schedule = {
    ...current,
    status: next,
    revisao: (current.revisao ?? 0) + 1,
    ultima_justificativa: reason.trim(),
    updated_at: now,
    ...(next === "aprovada"
      ? {
          conferido_por: actor,
          conferido_em: now,
          conferencia: reviewAttestation(review),
        }
      : {}),
    ...(next === "rascunho"
      ? { conferido_por: null, conferido_em: null, conferencia: null }
      : {}),
  };
  const schedules = data.schedules.map((entry) =>
    entry.id === current.id ? updated : entry,
  );
  const scheduleVersions = [...(data.scheduleVersions ?? [])];
  if (next === "publicada") {
    const previous = scheduleVersions.filter(
      (entry) => entry.escala_id === schedule.id,
    );
    scheduleVersions.push({
      id: globalThis.crypto.randomUUID(),
      escala_id: schedule.id,
      empresa_id: schedule.empresa_id,
      revisao: updated.revisao!,
      versao: Math.max(0, ...previous.map((entry) => entry.versao)) + 1,
      publicado_em: now,
      publicado_por: actor,
      justificativa: reason.trim(),
      snapshot: buildScheduleSnapshot({ ...data, schedules }, updated),
    });
  }
  return {
    ...data,
    schedules,
    scheduleVersions,
    logs: [
      {
        id: globalThis.crypto.randomUUID(),
        tabela: "escalas",
        acao: "UPDATE",
        alterado_em: now,
        empresa_id: current.empresa_id,
        registro_id: current.id,
        ator_id: actor,
        antes: current,
        depois: updated,
        campos: ["status", "revisao", "ultima_justificativa"],
      },
      ...data.logs,
    ],
  };
}
