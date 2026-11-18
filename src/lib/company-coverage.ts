import type { Data } from "./store";
import type { Schedule } from "./types";
import { addDays, dateUTC, holidayAt, monthDates, span } from "./engine";
import { holidaysForCompany } from "./company-resources";
import { projectSchedule, specialDateMatchesDate } from "./special-dates";
import {
  resolvePublishedContext,
  usesPublishedContext,
} from "./published-context";
import { validateBusinessHours } from "./business-hours";

type Range = [number, number];
export type CoveragePeriod = {
  start: number;
  end: number;
  actual: number;
  required: number;
  employees: string[];
};
export type CoverageDay = {
  date: string;
  opening: Range[];
  periods: CoveragePeriod[];
  gaps: CoveragePeriod[];
  outside: { employee: string; start: number; end: number }[];
  missing: string[];
  issues: string[];
  status: "fechado" | "coberto" | "descoberto" | "incompleto";
};
export type CompanyCoverageReport = {
  configured: boolean;
  company: string;
  minimum: number;
  days: CoverageDay[];
};
export function mergeCoverageRanges(ranges: Range[]): Range[] {
  const result: Range[] = [];
  for (const [start, end] of ranges
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
function subtract(ranges: Range[], opening: Range[]) {
  let remainder = ranges;
  for (const [start, end] of opening)
    remainder = remainder.flatMap(([a, b]): Range[] =>
      b <= start || a >= end
        ? [[a, b]]
        : [
            ...(a < start ? [[a, start] as Range] : []),
            ...(b > end ? [[end, b] as Range] : []),
          ],
    );
  return remainder;
}
export const coverageClock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Operational coverage uses distinct employees and real interval boundaries, including breaks. */
export function companyCoverage(
  data: Data,
  companyId: string,
  month: string,
  previews: Schedule[] = [],
): CompanyCoverageReport {
  if (!/^(19\d\d|20\d\d|21\d\d|2200)-(0[1-9]|1[0-2])$/.test(month))
    throw new Error(
      "Selecione uma competência válida para conferir a cobertura.",
    );
  const foundCompany = data.companies.find((item) => item.id === companyId);
  if (!foundCompany)
    throw new Error("Empresa indisponível para conferir o funcionamento.");
  const company = foundCompany;
  const hours = validateBusinessHours(company.horario_funcionamento);
  if (!hours)
    return { configured: false, company: company.nome, minimum: 0, days: [] };
  const employees = data.employees.filter(
    (item) => item.empresa_id === companyId,
  );
  if (
    previews.some(
      (item) =>
        item.empresa_id !== companyId ||
        !employees.some((employee) => employee.id === item.funcionario_id),
    )
  )
    throw new Error("A prévia contém um funcionário de outra empresa.");
  const selected = new Set(
    previews.map((item) => `${item.funcionario_id}:${item.mes.slice(0, 7)}`),
  );
  if (selected.size !== previews.length)
    throw new Error("Há escalas repetidas na prévia de cobertura.");
  const relevantMonths = new Set([
    month,
    addDays(`${month}-01`, -1).slice(0, 7),
  ]);
  const source = [
    ...data.schedules.filter(
      (item) => !selected.has(`${item.funcionario_id}:${item.mes.slice(0, 7)}`),
    ),
    ...previews,
  ].filter(
    (item) =>
      item.empresa_id === companyId &&
      relevantMonths.has(item.mes.slice(0, 7)) &&
      employees.some((employee) => employee.id === item.funcionario_id),
  );
  const schedules = source.map((item) =>
    usesPublishedContext(item)
      ? item
      : projectSchedule(
          item,
          company,
          employees.find((employee) => employee.id === item.funcionario_id)!,
          data.specialDates ?? [],
          data.establishments ?? [],
          data.holidays,
        ),
  );
  const starts = new Map<string, Schedule["dias"][number]>(),
    duplicates = new Set<string>();
  for (const schedule of schedules)
    for (const day of schedule.dias)
      if (day.data.startsWith(schedule.mes.slice(0, 7))) {
        const key = `${schedule.funcionario_id}:${day.data}`;
        if (starts.has(key)) duplicates.add(key);
        else starts.set(key, day);
      }
  const events = (date: string) =>
    (data.specialDates ?? [])
      .filter(
        (event) =>
          event.ativo &&
          event.empresa_id === companyId &&
          event.alcance === "empresa" &&
          !event.estabelecimento_id &&
          specialDateMatchesDate(event, date),
      )
      .sort(
        (a, b) =>
          b.data_inicio.localeCompare(a.data_inicio) ||
          a.id.localeCompare(b.id),
      );
  function openingStarts(date: string): {
    ranges: Range[];
    closed: boolean;
    issue?: string;
  } {
    const applicable = events(date),
      latest = applicable[0];
    const holiday =
      !!holidayAt(
        date,
        holidaysForCompany(data.holidays, companyId),
        company,
      ) || applicable.some((event) => event.categoria.startsWith("feriado_"));
    if (latest?.expediente === "individual")
      return {
        ranges: [],
        closed: false,
        issue:
          "Funcionamento da empresa depende de uma decisão individual ainda não definida.",
      };
    if (
      latest?.expediente === "sem_expediente" ||
      (!latest && holiday && hours!.feriados === "fechado")
    )
      return { ranges: [], closed: true };
    try {
      const periods =
        latest?.expediente === "reduzido"
          ? latest.intervalos
          : hours!.semana[String(dateUTC(date).getUTCDay())];
      return { ranges: (periods ?? []).map(span), closed: false };
    } catch {
      return {
        ranges: [],
        closed: false,
        issue: "Confira os períodos de funcionamento desta data especial.",
      };
    }
  }
  const days = monthDates(month).map((date): CoverageDay => {
    const previous = addDays(date, -1),
      currentOpening = openingStarts(date),
      priorOpening = openingStarts(previous);
    const issues = [currentOpening.issue, priorOpening.issue].filter(
      (item): item is string => !!item,
    );
    const opening = currentOpening.closed
      ? []
      : mergeCoverageRanges(
          [
            ...currentOpening.ranges,
            ...priorOpening.ranges.map(([a, b]): Range => [a - 1440, b - 1440]),
          ].map(([a, b]): Range => [Math.max(0, a), Math.min(1440, b)]),
        );
    const ranges = new Map<string, Range[]>(),
      missing: string[] = [];
    for (const employee of employees) {
      const own = starts.get(`${employee.id}:${date}`);
      if (
        !own &&
        employee.situacao !== "inativo" &&
        (!employee.admissao || employee.admissao <= date)
      )
        missing.push(employee.nome);
      const periods: Range[] = [];
      for (const [day, offset] of [
        [date, 0],
        [previous, -1440],
      ] as const) {
        const key = `${employee.id}:${day}`;
        if (duplicates.has(key)) {
          issues.push(`${employee.nome}: há dias repetidos na programação.`);
          continue;
        }
        const entry = starts.get(key);
        if (!entry) continue;
        try {
          periods.push(
            ...entry.intervalos.map((shift): Range => {
              const [a, b] = span(shift);
              return [Math.max(0, a + offset), Math.min(1440, b + offset)];
            }),
          );
        } catch {
          issues.push(`${employee.nome}: há horários inválidos a conferir.`);
        }
      }
      if (date === `${month}-01` && !starts.has(`${employee.id}:${previous}`)) {
        const forecast = schedules
          .find(
            (item) =>
              item.funcionario_id === employee.id &&
              item.mes.slice(0, 7) === month,
          )
          ?.dias.find((item) => item.data === previous);
        if (
          forecast?.intervalos.some((shift) => {
            try {
              return span(shift)[1] > 1440;
            } catch {
              return false;
            }
          })
        )
          issues.push(
            `${employee.nome}: confirme a escala noturna do mês anterior; a projeção não foi contada como registro salvo.`,
          );
      }
      ranges.set(employee.id, mergeCoverageRanges(periods));
    }
    const periods: CoveragePeriod[] = [];
    for (const [a, b] of opening) {
      const points = [
        ...new Set([
          a,
          b,
          ...[...ranges.values()].flatMap((list) =>
            list.flatMap(([start, end]) => [
              Math.max(a, Math.min(b, start)),
              Math.max(a, Math.min(b, end)),
            ]),
          ),
        ]),
      ].sort((x, y) => x - y);
      for (let i = 1; i < points.length; i++) {
        const start = points[i - 1],
          end = points[i];
        const available = employees.filter((employee) =>
          ranges.get(employee.id)!.some(([x, y]) => x <= start && y >= end),
        );
        if (end > start)
          periods.push({
            start,
            end,
            actual: available.length,
            required: hours!.minimo_funcionarios,
            employees: available.map((employee) => employee.nome),
          });
      }
    }
    const outside = employees.flatMap((employee) =>
      subtract(ranges.get(employee.id) ?? [], opening).map(([start, end]) => ({
        employee: employee.nome,
        start,
        end,
      })),
    );
    const gaps = periods.filter((period) => period.actual < period.required);
    return {
      date,
      opening,
      periods,
      gaps,
      outside,
      missing,
      issues: [...new Set(issues)],
      status:
        !opening.length && !issues.length
          ? "fechado"
          : missing.length || issues.length
            ? "incompleto"
            : gaps.length
              ? "descoberto"
              : "coberto",
    };
  });
  return {
    configured: true,
    company: company.nome,
    minimum: hours.minimo_funcionarios,
    days,
  };
}

/** Published days are resolved from their preserved version before operational comparison. */
export async function resolveCompanyCoverage(
  data: Data,
  companyId: string,
  month: string,
  previews: Schedule[] = [],
) {
  const months = new Set([month, addDays(`${month}-01`, -1).slice(0, 7)]);
  const replaced = new Set(
    previews.map((item) => `${item.funcionario_id}:${item.mes.slice(0, 7)}`),
  );
  const schedules = await Promise.all(
    data.schedules.map(async (schedule) => {
      if (
        schedule.empresa_id !== companyId ||
        !months.has(schedule.mes.slice(0, 7)) ||
        replaced.has(
          `${schedule.funcionario_id}:${schedule.mes.slice(0, 7)}`,
        ) ||
        !usesPublishedContext(schedule)
      )
        return schedule;
      return (await resolvePublishedContext(data, schedule)).schedule;
    }),
  );
  return companyCoverage({ ...data, schedules }, companyId, month, previews);
}
