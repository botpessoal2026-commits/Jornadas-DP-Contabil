import type { Alert } from "./types";

/** Three presentation levels share one policy; missing evidence is never certified. */
export type AlertClassification = "bloqueante" | "atencao" | "informativo";

export const classificationLabels: Record<AlertClassification, string> = {
  bloqueante: "Bloqueante",
  atencao: "Atenção",
  informativo: "Informativo",
};

export function isPendingSource(alert: Pick<Alert, "code">) {
  return alert.code === "pendente" || alert.code.startsWith("sem_");
}

export function classificationForAlert(
  alert: Pick<Alert, "code" | "severity">,
): AlertClassification {
  // A missing rule is an unresolved prerequisite, not an invented excess.
  if (isPendingSource(alert) || alert.code === "contrato_pendente")
    return "atencao";
  if (alert.severity === "erro") return "bloqueante";
  // Night work alone does not establish an irregularity. Its missing rules,
  // limits, interval and rest are validated by their own engine alerts.
  if (alert.code === "noturno") return "informativo";
  return "atencao";
}

export function classificationLabel(alert: Pick<Alert, "code" | "severity">) {
  return classificationLabels[classificationForAlert(alert)];
}

export function blocksScheduleApproval(
  alert: Pick<Alert, "code" | "severity">,
) {
  return (
    isPendingSource(alert) || classificationForAlert(alert) === "bloqueante"
  );
}
