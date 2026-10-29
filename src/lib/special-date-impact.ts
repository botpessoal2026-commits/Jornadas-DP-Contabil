import type { Data } from "./store";
import type { SpecialDate } from "./types";
import { projectData } from "./special-dates";
import { computeDay } from "./engine";

export type SpecialDateImpact = {
  people: number;
  days: number;
  beforeMinutes: number;
  afterMinutes: number;
  preservedExceptions: number;
  errors: number;
  changes: {
    employee: string;
    date: string;
    before: number;
    after: number;
    exception: boolean;
  }[];
};

/** Simulate on copies, using the same boundary reconciliation and projection as the calendar. */
export function specialDateImpact(
  data: Data,
  companyId: string,
  next: SpecialDate | null,
  eventId: string,
  month: string,
): SpecialDateImpact {
  if (next && next.empresa_id !== companyId)
    throw new Error("O evento deve pertencer à empresa ativa.");
  const events = data.specialDates ?? [];
  if (
    events.some(
      (event) => event.id === eventId && event.empresa_id !== companyId,
    )
  )
    throw new Error("Evento indisponível nesta empresa.");
  const before = projectData(data);
  const after = projectData({
    ...data,
    specialDates: [
      ...events.filter((event) => event.id !== eventId),
      ...(next ? [next] : []),
    ],
  });
  const result: SpecialDateImpact = {
    people: 0,
    days: 0,
    beforeMinutes: 0,
    afterMinutes: 0,
    preservedExceptions: 0,
    errors: 0,
    changes: [],
  };
  const people = new Set<string>();
  for (const schedule of before.schedules.filter(
    (item) =>
      item.empresa_id === companyId && item.mes.startsWith(month.slice(0, 7)),
  )) {
    const target = after.schedules.find((item) => item.id === schedule.id);
    if (!target) continue;
    for (const day of schedule.dias.filter((item) =>
      item.data.startsWith(month.slice(0, 7)),
    )) {
      const changed = target.dias.find((item) => item.data === day.data);
      if (
        !changed ||
        JSON.stringify([
          day.intervalos,
          day.eventos,
          day.feriado,
          day.folga,
        ]) ===
          JSON.stringify([
            changed.intervalos,
            changed.eventos,
            changed.feriado,
            changed.folga,
          ])
      )
        continue;
      try {
        const oldMinutes = computeDay(day, [], schedule.dias).worked;
        const newMinutes = computeDay(changed, [], target.dias).worked;
        const exception = Boolean(
          day.calendario?.excecao &&
          JSON.stringify(day.calendario.excecao) ===
            JSON.stringify(changed.calendario?.excecao),
        );
        const employee = data.employees.find(
          (item) =>
            item.id === schedule.funcionario_id &&
            item.empresa_id === companyId,
        );
        result.changes.push({
          employee:
            employee?.nome ?? schedule.nome_funcionario ?? "Funcionário",
          date: day.data,
          before: oldMinutes,
          after: newMinutes,
          exception,
        });
        result.beforeMinutes += oldMinutes;
        result.afterMinutes += newMinutes;
        if (exception) result.preservedExceptions++;
        people.add(schedule.funcionario_id);
      } catch {
        result.errors++;
      }
    }
  }
  result.days = result.changes.length;
  result.people = people.size;
  return result;
}
