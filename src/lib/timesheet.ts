import { addDays, computeDay, dateUTC, monthDates, span } from "./engine";
import { validateShiftText, shiftEditorText } from "./shift-editor";
import { dayPresentation } from "./special-dates";
import type { Company, Employee, Schedule } from "./types";

export type TimesheetRow = {
  date: string;
  day: string;
  weekday: string;
  planned: string[];
  holiday: string | null;
  rest: boolean;
  missing: boolean;
  workingHoliday: boolean;
  shaded: boolean;
  crossed: boolean;
  observation: string;
};
export type TimesheetOptions = {
  preview?: boolean;
};
export type TimesheetData = {
  company: Company;
  employee: Employee;
  month: string;
  start: string;
  end: string;
  rows: TimesheetRow[];
  preview: boolean;
};

/** The displayed calendar is the source; never regenerate it from a template. */
export function buildTimesheet(
  schedule: Schedule,
  company: Company,
  employee: Employee,
  options: TimesheetOptions = {},
): TimesheetData {
  if (
    schedule.empresa_id !== company.id ||
    employee.empresa_id !== company.id ||
    schedule.funcionario_id !== employee.id
  )
    throw new Error("A escala, o funcionário e a empresa devem corresponder.");
  const month = schedule.mes.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("A competência da escala é inválida.");
  const dates = monthDates(month);
  const byDate = new Map(schedule.dias.map((day) => [day.data, day]));
  if (byDate.size !== schedule.dias.length)
    throw new Error("A escala contém datas duplicadas. Confira o calendário.");
  for (const day of schedule.dias) {
    const validation = validateShiftText(shiftEditorText(day.intervalos));
    if (!validation.shifts)
      throw new Error(`Confira os horários da escala em ${day.data}.`);
  }
  const labels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const rows: TimesheetRow[] = dates.map((date) => {
    const day = byDate.get(date);
    const base = {
      date,
      day: date.slice(-2),
      weekday: labels[dateUTC(date).getUTCDay()],
    };
    const previous = byDate.get(addDays(date, -1));
    const carried = (previous?.intervalos ?? [])
      .filter((shift) => span(shift)[1] > 1440)
      .map((shift) => {
        const [start] = span(shift);
        const from = start >= 1440 ? shift.start : "00:00";
        return `${from}–${shift.end} (continuação)`;
      });
    if (!day)
      return {
        ...base,
        planned: [...carried, "Sem registro do dia"],
        holiday: null,
        rest: false,
        missing: true,
        workingHoliday: false,
        shaded: false,
        crossed: false,
        observation: carried.length
          ? "Registro do dia ausente; continuação conhecida do turno anterior"
          : "Dia sem registro na escala",
      };
    const worked = computeDay(day, [], schedule.dias).worked;
    const presentation = dayPresentation(day, schedule.dias);
    const rest = worked === 0;
    const holiday =
      day.feriado?.trim() ||
      (presentation.isHoliday
        ? (day.eventos ?? [])
            .filter((event) => event.categoria.startsWith("feriado_"))
            .map((event) => event.nome)
            .join(" · ") || presentation.names.join(" · ")
        : null);
    const planned = day.intervalos.map((shift) => {
      const [start, end] = span(shift);
      return `${shift.start}${start >= 1440 ? " (+1)" : ""}–${shift.end}${end >= 1440 ? " (+1)" : ""}`;
    });
    const workingHoliday = Boolean(holiday && !rest);
    return {
      ...base,
      planned: rest ? ["Folga"] : [...carried, ...planned],
      holiday,
      rest,
      missing: false,
      workingHoliday,
      shaded: rest || Boolean(holiday),
      crossed: rest,
      observation: [
        day.eventos?.length || day.calendario?.excecao
          ? [
              workingHoliday ? "Feriado trabalhado (previsto)" : "",
              presentation.description || presentation.label,
              presentation.status,
            ]
              .filter(Boolean)
              .join(" · ")
          : holiday
            ? `Feriado: ${holiday}${workingHoliday ? " · trabalho previsto" : ""}`
            : rest
              ? "Folga"
              : "",
        day.observacao,
      ]
        .filter(Boolean)
        .join(". "),
    };
  });
  return {
    company,
    employee,
    month,
    start: dates[0],
    end: dates.at(-1)!,
    rows,
    preview: options.preview ?? false,
  };
}
