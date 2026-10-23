import type { Alert } from "./types";

export type AlertCategory = "violation" | "attention" | "pending_source";
export type AlertPeriod = { start: string; end: string };
export type AlertContext = {
  companyId: string;
  companyName: string;
  employeeId?: string;
  employeeName?: string;
  month?: string;
};
export type AlertOccurrence = {
  id: string;
  date: string;
  message: string;
  period?: AlertPeriod;
};
export type AlertGroup = AlertContext & {
  id: string;
  category: AlertCategory;
  code: string;
  title: string;
  message: string;
  rule: string;
  source: string;
  ruleId?: string;
  severity: Alert["severity"];
  count: number;
  dates: string[];
  periods: AlertPeriod[];
  occurrences: AlertOccurrence[];
  action: "day" | "period" | "rules" | "employee";
  suggestedAction: string;
};
export type AlertSummary = {
  groups: AlertGroup[];
  violations: AlertGroup[];
  attention: AlertGroup[];
  pendingSources: AlertGroup[];
  /** Counts distinct issues; repeated occurrences have their own counters. */
  counts: { violations: number; attention: number; pendingSources: number };
  occurrenceCounts: {
    violations: number;
    attention: number;
    pendingSources: number;
  };
};

const weeklyCodes = new Set([
  "semana_incompleta",
  "contrato_semanal",
  "semanal",
  "transicao",
  "descanso",
  "6x1",
  "domingo",
]);
const titles: Record<string, string> = {
  diario: "Carga diária excedida",
  semanal: "Carga semanal excedida",
  contrato_semanal: "Carga contratual excedida",
  contrato_diario: "Carga diária contratual excedida",
  descanso_contratual: "Trabalho em descanso contratual",
  contrato_pendente: "Contrato precisa de revisão",
  intrajornada: "Intervalo intrajornada insuficiente",
  interjornada: "Descanso entre jornadas insuficiente",
  descanso: "Descanso semanal insuficiente",
  sobreposicao: "Horários sobrepostos",
  sobreposicao_civil: "Horários sobrepostos entre dias",
  "6x1": "Modelo 6×1 sem autorização da empresa",
  domingo: "Descanso no domingo precisa de revisão",
  noturno: "Trabalho noturno",
  "12x36": "Regime 12×36 precisa de revisão",
  transicao: "Semana com transição de regra",
  semana_incompleta: "Faltam dias para conferir a semana",
  pendente: "Fonte da regra precisa de conferência",
};
const priority: Record<AlertCategory, number> = {
  violation: 0,
  attention: 1,
  pending_source: 2,
};

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

/** Calendar date arithmetic uses UTC only; it does not reinterpret local shifts. */
export function periodForAlert(alert: Pick<Alert, "code" | "date" | "period">) {
  if (alert.period) return alert.period;
  if (!weeklyCodes.has(alert.code) || !validDate(alert.date)) return undefined;
  const date = new Date(`${alert.date}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const start = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6);
  return { start, end: date.toISOString().slice(0, 10) };
}

export function classifyAlert(
  alert: Pick<Alert, "code" | "severity">,
): AlertCategory {
  if (alert.code === "pendente" || alert.code.startsWith("sem_"))
    return "pending_source";
  if (alert.code === "contrato_pendente") return "attention";
  return alert.severity === "erro" ? "violation" : "attention";
}

/** Deterministic identifier, independent of array order or React rendering. */
function stableId(value: string) {
  let hash = 14695981039346656037n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16, "0");
}

function issueMessage(message: string) {
  // A week/date identifies an occurrence, not a different issue. Other values
  // (hours, required breaks, legal limits) remain part of the grouping key.
  return message.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "{data}").trim();
}

export function buildAlertSummary(
  alerts: Alert[],
  context: AlertContext,
): AlertSummary {
  const grouped = new Map<string, AlertGroup>();
  for (const alert of alerts) {
    const category = classifyAlert(alert);
    const period = periodForAlert(alert);
    const action =
      category === "pending_source"
        ? "rules"
        : alert.code === "contrato_pendente"
          ? "employee"
          : period
            ? "period"
            : "day";
    const key = JSON.stringify([
      context.companyId,
      context.employeeId ?? "",
      category,
      alert.code,
      alert.severity,
      alert.ruleId ?? alert.rule,
      alert.source,
      issueMessage(alert.message),
    ]);
    const occurrence: AlertOccurrence = {
      id: `occurrence-${stableId(JSON.stringify([key, alert.date, period, alert.message]))}`,
      date: alert.date,
      message: alert.message,
      ...(period ? { period } : {}),
    };
    let group = grouped.get(key);
    if (!group) {
      group = {
        ...context,
        id: `alert-${stableId(key)}`,
        category,
        code: alert.code,
        title:
          titles[alert.code] ??
          (category === "pending_source"
            ? "Parâmetro legal não configurado"
            : alert.rule),
        message: alert.message,
        rule: alert.rule,
        source: alert.source,
        ruleId: alert.ruleId,
        severity: alert.severity,
        count: 0,
        dates: [],
        periods: [],
        occurrences: [],
        action,
        suggestedAction:
          action === "rules"
            ? "Conferir a fonte, os valores e a vigência nos parâmetros legais."
            : action === "employee"
              ? "Revisar a carga semanal estruturada no cadastro do funcionário."
              : action === "period"
                ? "Revisar os turnos e descansos no período indicado."
                : "Abrir o dia e revisar os horários ou a regra aplicável.",
      };
      grouped.set(key, group);
    }
    // Repeated input objects do not inflate issue/occurrence counters.
    if (!group.occurrences.some((existing) => existing.id === occurrence.id))
      group.occurrences.push(occurrence);
  }
  const groups = [...grouped.values()];
  for (const group of groups) {
    group.occurrences.sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
    group.count = group.occurrences.length;
    group.message = group.occurrences[0].message;
    group.dates = [...new Set(group.occurrences.map((o) => o.date))];
    group.periods = group.occurrences
      .flatMap((o) => (o.period ? [o.period] : []))
      .filter(
        (period, index, periods) =>
          periods.findIndex(
            (p) => p.start === period.start && p.end === period.end,
          ) === index,
      );
  }
  groups.sort(
    (a, b) =>
      priority[a.category] - priority[b.category] ||
      a.dates[0].localeCompare(b.dates[0]) ||
      a.id.localeCompare(b.id),
  );
  const violations = groups.filter((group) => group.category === "violation");
  const attention = groups.filter((group) => group.category === "attention");
  const pendingSources = groups.filter(
    (group) => group.category === "pending_source",
  );
  const occurrences = (items: AlertGroup[]) =>
    items.reduce((sum, group) => sum + group.count, 0);
  return {
    groups,
    violations,
    attention,
    pendingSources,
    counts: {
      violations: violations.length,
      attention: attention.length,
      pendingSources: pendingSources.length,
    },
    occurrenceCounts: {
      violations: occurrences(violations),
      attention: occurrences(attention),
      pendingSources: occurrences(pendingSources),
    },
  };
}

/** Only schedule issues mark cells. Source and employee setup use their own actions. */
export function alertsForDate(
  groups: AlertGroup[],
  date: string,
): AlertGroup[] {
  return groups.filter(
    (group) =>
      group.action !== "rules" &&
      group.action !== "employee" &&
      group.occurrences.some((occurrence) =>
        occurrence.period
          ? occurrence.period.start <= date && occurrence.period.end >= date
          : occurrence.date === date,
      ),
  );
}
