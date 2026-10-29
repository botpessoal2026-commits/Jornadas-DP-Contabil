import type { Data } from "./store";
import type { Company, Day, Employee } from "./types";
import { monthDates, addDays, dateUTC } from "./engine";
import { projectDay } from "./special-dates";

/** Count civil dates, not coincident events, using the same scope as the calendar. */
export function applicableHolidayDates(
  data: Data,
  company: Company,
  month: string,
) {
  const people: Employee[] = data.employees.filter(
    (e) => e.empresa_id === company.id,
  );
  const companyPerson: Employee = {
    id: "__company__",
    empresa_id: company.id,
    nome: "",
    cargo: "",
    horario_contratual: "",
    dias_descanso: [],
  };
  const contexts = [companyPerson, ...people];
  const units = (data.establishments ?? []).filter(
    (u) => u.empresa_id === company.id,
  );
  for (const unit of units)
    contexts.push({
      ...companyPerson,
      id: `__unit__${unit.id}`,
      estabelecimento_id: unit.id,
    });
  return monthDates(month).filter((date) =>
    contexts.some((employee) => {
      const day: Day = {
        data: date,
        intervalos: [],
        folga: true,
        feriado: null,
        observacao: "",
      };
      return Boolean(
        projectDay(day, {
          company,
          employee,
          events: data.specialDates ?? [],
          establishments: data.establishments,
          holidays: data.holidays,
        }).feriado,
      );
    }),
  );
}

export function shiftMonth(month: string, offset: number) {
  const d = dateUTC(`${month.slice(0, 7)}-01`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
}
export function calendarWeek(date: string) {
  const start = addDays(date, -((dateUTC(date).getUTCDay() + 6) % 7));
  return { start, end: addDays(start, 6) };
}
export function recentSchedules(data: Data) {
  return [...data.schedules].sort(
    (a, b) =>
      String(b.updated_at ?? b.mes).localeCompare(
        String(a.updated_at ?? a.mes),
      ) || b.id.localeCompare(a.id),
  );
}
