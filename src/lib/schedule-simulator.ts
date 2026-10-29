import { clock, minutes, span } from "./engine";
import type { Shift, WeekPattern } from "./types";

export type WeeklySimulationInput = {
  weeklyMinutes: number;
  workdays: number[];
  start: string;
  /** Worked minutes before the pause, counted from the shift start. */
  breakAfterMinutes: number;
  breakMinutes: number;
  unavailableDays?: number[];
  /** Optional explicit restrictions; these do not establish legal validity. */
  maxWorkedMinutesPerDay?: number;
  maxShiftMinutes?: number;
  minimumRestMinutes?: number;
};
export type WeeklySimulationDay = {
  weekday: number;
  workedMinutes: number;
  elapsedMinutes: number;
  shifts: Shift[];
};
export type WeeklyComparison = {
  before: { minutes: number; workdays: number; restDays: number };
  after: { minutes: number; workdays: number; restDays: number };
  minutesDifference: number;
};
export type WeeklySimulation =
  | { ok: false; errors: string[] }
  | {
      ok: true;
      pattern: WeekPattern;
      days: WeeklySimulationDay[];
      totalMinutes: number;
      restDays: number;
      warnings: string[];
      comparison: WeeklyComparison | null;
    };

const weekOrder = [1, 2, 3, 4, 5, 6, 0];
const names = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
];
const validDay = (day: number) => Number.isInteger(day) && day >= 0 && day <= 6;
const integerMinutes = (value: number) => Number.isInteger(value) && value >= 0;

function makeShift(start: number, end: number): Shift {
  const time = (value: number) =>
    `${String(Math.floor((value % 1440) / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return {
    start: time(start),
    end: time(end),
    startDay: Math.floor(start / 1440),
    endDay: Math.floor(end / 1440),
  };
}

function summarize(pattern: WeekPattern) {
  let total = 0;
  let workdays = 0;
  for (const day of weekOrder) {
    const shifts = pattern[String(day)] ?? [];
    const value = minutes(shifts);
    total += value;
    if (value > 0) workdays++;
  }
  return { minutes: total, workdays, restDays: 7 - workdays };
}

/**
 * Distributes whole clock minutes in a stable Monday-to-Sunday order. This is a
 * mathematical proposal, never a replacement for the dated schedule validator.
 */
export function simulateWeeklyPattern(
  input: WeeklySimulationInput,
  currentPattern?: WeekPattern,
): WeeklySimulation {
  const errors: string[] = [];
  if (
    !Number.isInteger(input.weeklyMinutes) ||
    input.weeklyMinutes < 1 ||
    input.weeklyMinutes > 10080
  )
    errors.push(
      "Informe uma carga semanal inteira entre 1 minuto e 168 horas.",
    );
  if (
    !input.workdays.length ||
    input.workdays.some((day) => !validDay(day)) ||
    new Set(input.workdays).size !== input.workdays.length
  )
    errors.push("Selecione de um a sete dias de trabalho diferentes.");
  if (input.unavailableDays?.some((day) => !validDay(day)))
    errors.push("Confira os dias de indisponibilidade.");
  let start = 0;
  try {
    start = clock(input.start);
  } catch {
    errors.push("Informe o início no formato HH:MM.");
  }
  if (
    !integerMinutes(input.breakAfterMinutes) ||
    !integerMinutes(input.breakMinutes) ||
    input.breakMinutes > 1440
  )
    errors.push("Informe durações inteiras e não negativas para o intervalo.");
  for (const [value, label] of [
    [input.maxWorkedMinutesPerDay, "limite de trabalho diário"],
    [input.maxShiftMinutes, "limite do turno"],
    [input.minimumRestMinutes, "descanso mínimo"],
  ] as const)
    if (value !== undefined && (!Number.isInteger(value) || value < 1))
      errors.push(`Confira o ${label} informado.`);
  if (errors.length) return { ok: false, errors };
  const selected = weekOrder.filter((day) => input.workdays.includes(day));
  const unavailable = selected.filter((day) =>
    input.unavailableDays?.includes(day),
  );
  if (unavailable.length)
    errors.push(
      `Há indisponibilidade em: ${unavailable.map((day) => names[day]).join(", ")}.`,
    );
  const quotient = Math.floor(input.weeklyMinutes / selected.length);
  const remainder = input.weeklyMinutes % selected.length;
  if (quotient < 1)
    errors.push(
      "A carga deve permitir pelo menos um minuto em cada dia selecionado.",
    );
  const pattern: WeekPattern = Object.fromEntries(
    weekOrder.map((day) => [String(day), []]),
  );
  const days: WeeklySimulationDay[] = [];
  for (const [index, weekday] of selected.entries()) {
    const worked = quotient + (index < remainder ? 1 : 0);
    const elapsed = worked + input.breakMinutes;
    if (elapsed > 1440) {
      errors.push(
        `O turno de ${names[weekday]} ultrapassa 24 horas; reduza a carga ou distribua em mais dias.`,
      );
      continue;
    }
    if (
      input.breakMinutes > 0 &&
      (input.breakAfterMinutes < 1 || input.breakAfterMinutes >= worked)
    ) {
      errors.push(
        `O intervalo de ${names[weekday]} deve ocorrer entre a entrada e a saída, com trabalho antes e depois.`,
      );
      continue;
    }
    if (
      input.maxWorkedMinutesPerDay !== undefined &&
      worked > input.maxWorkedMinutesPerDay
    )
      errors.push(
        `A carga de ${names[weekday]} ultrapassa o limite diário informado.`,
      );
    if (input.maxShiftMinutes !== undefined && elapsed > input.maxShiftMinutes)
      errors.push(
        `A duração do turno de ${names[weekday]} ultrapassa o limite informado.`,
      );
    const shifts =
      input.breakMinutes > 0
        ? [
            makeShift(start, start + input.breakAfterMinutes),
            makeShift(
              start + input.breakAfterMinutes + input.breakMinutes,
              start + elapsed,
            ),
          ]
        : [makeShift(start, start + worked)];
    // Check against the same representation consumed by the existing engine.
    try {
      if (minutes(shifts) !== worked) throw new Error("Total inconsistente.");
      if (
        shifts.some((shift) => span(shift)[1] > 1440) &&
        input.unavailableDays?.includes((weekday + 1) % 7)
      )
        errors.push(
          `O turno de ${names[weekday]} invade uma indisponibilidade no dia seguinte.`,
        );
      pattern[String(weekday)] = shifts;
      days.push({
        weekday,
        workedMinutes: worked,
        elapsedMinutes: elapsed,
        shifts,
      });
    } catch {
      errors.push(
        `Não foi possível representar o turno de ${names[weekday]} até o dia seguinte.`,
      );
    }
  }
  if (input.minimumRestMinutes !== undefined && days.length) {
    for (const [index, day] of days.entries()) {
      const next = days[(index + 1) % days.length];
      const currentIndex = weekOrder.indexOf(day.weekday);
      const nextIndex =
        weekOrder.indexOf(next.weekday) + (index === days.length - 1 ? 7 : 0);
      const end = span(day.shifts.at(-1)!)[1];
      const gap = (nextIndex - currentIndex) * 1440 + start - end;
      if (gap < input.minimumRestMinutes)
        errors.push(
          `O descanso após ${names[day.weekday]} fica abaixo do mínimo informado, inclusive na repetição semanal.`,
        );
    }
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  let comparison: WeeklyComparison | null = null;
  const warnings = [
    "Proposta matemática em horas de relógio. A escala mensal ainda deve ser conferida com contrato, feriados, indisponibilidades, vigências e instrumento aplicável antes de aprovar.",
  ];
  if (days.length > 5)
    warnings.push(
      "A distribuição tem menos de dois dias sem início de turno. Confira os repousos exigidos na competência e o regime aplicável.",
    );
  if (currentPattern) {
    try {
      const before = summarize(currentPattern);
      const after = summarize(pattern);
      comparison = {
        before,
        after,
        minutesDifference: after.minutes - before.minutes,
      };
    } catch {
      warnings.push(
        "O modelo anterior contém horários inválidos; a comparação não está disponível.",
      );
    }
  }
  return {
    ok: true,
    pattern,
    days,
    totalMinutes: days.reduce((total, day) => total + day.workedMinutes, 0),
    restDays: 7 - days.length,
    warnings,
    comparison,
  };
}
