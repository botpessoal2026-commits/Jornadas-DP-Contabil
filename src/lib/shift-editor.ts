import { clock, minutes, span } from "./engine";
import type { Shift } from "./types";

export type TimeField = "entry" | "breakStart" | "breakEnd" | "exit";
export type ShiftFields = Record<TimeField, string> &
  Record<`${TimeField}Day`, 0 | 1>;
export type ShiftValidation = {
  shifts: Shift[] | null;
  errors: Partial<Record<TimeField | "intervals", string>>;
  worked: number;
  pause: number;
};
export const emptyShiftFields: ShiftFields = {
  entry: "",
  breakStart: "",
  breakEnd: "",
  exit: "",
  entryDay: 0,
  breakStartDay: 0,
  breakEndDay: 0,
  exitDay: 0,
};

export function fieldsFromShifts(shifts: Shift[]): ShiftFields {
  const first = shifts[0],
    second = shifts[1];
  if (!first) return { ...emptyShiftFields };
  const [start, end] = span(first);
  const [nextStart, nextEnd] = second ? span(second) : [0, 0];
  return {
    entry: first.start,
    entryDay: start >= 1440 ? 1 : 0,
    breakStart: second ? first.end : "",
    breakStartDay: second && end >= 1440 ? 1 : 0,
    breakEnd: second?.start ?? "",
    breakEndDay: second && nextStart >= 1440 ? 1 : 0,
    exit: second?.end ?? first.end,
    exitDay: (second ? nextEnd : end) >= 1440 ? 1 : 0,
  };
}

function timeError(value: string) {
  if (!value) return "Informe o horário no formato HH:MM.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    return "Horário inválido. Use HH:MM, de 00:00 a 23:59.";
}

export function validateShiftFields(fields: ShiftFields): ShiftValidation {
  const errors: ShiftValidation["errors"] = {};
  const hasBreak = Boolean(fields.breakStart || fields.breakEnd);
  const keys: TimeField[] = hasBreak
    ? ["entry", "breakStart", "breakEnd", "exit"]
    : ["entry", "exit"];
  for (const key of keys) {
    const error = timeError(fields[key]);
    if (error) errors[key] = error;
    if (fields[`${key}Day`] !== 0 && fields[`${key}Day`] !== 1)
      errors[key] = "Selecione a data da jornada ou o dia seguinte.";
  }
  if (Object.keys(errors).length)
    return { shifts: null, errors, worked: 0, pause: 0 };
  const absolute = (key: TimeField) =>
    clock(fields[key]) + fields[`${key}Day`] * 1440;
  const entry = absolute("entry"),
    exit = absolute("exit");
  if (exit <= entry)
    errors.exit =
      "A saída deve ocorrer depois da entrada. Para atravessar meia-noite, selecione Dia seguinte.";
  let pause = 0;
  if (hasBreak) {
    const breakStart = absolute("breakStart"),
      breakEnd = absolute("breakEnd");
    if (breakStart <= entry)
      errors.breakStart =
        "O início do intervalo deve ocorrer depois da entrada.";
    if (breakEnd <= breakStart)
      errors.breakEnd =
        "O retorno deve ocorrer depois do início do intervalo. Confira a data selecionada.";
    if (exit <= breakEnd)
      errors.exit = "A saída deve ocorrer depois do retorno do intervalo.";
    pause = breakEnd - breakStart;
  }
  if (Object.keys(errors).length)
    return { shifts: null, errors, worked: 0, pause: 0 };
  const makeShift = (a: TimeField, b: TimeField): Shift => ({
    start: fields[a],
    end: fields[b],
    ...(fields[`${a}Day`] ? { startDay: 1 } : {}),
    endDay: fields[`${b}Day`],
  });
  const shifts = hasBreak
    ? [makeShift("entry", "breakStart"), makeShift("breakEnd", "exit")]
    : [makeShift("entry", "exit")];
  try {
    return { shifts, errors: {}, worked: minutes(shifts), pause };
  } catch {
    return {
      shifts: null,
      errors: {
        exit: "Cada período de trabalho deve durar até 24 horas e terminar até o dia seguinte.",
      },
      worked: 0,
      pause: 0,
    };
  }
}

/** Explicit offsets preserve periods starting after midnight, including first period. */
export function shiftEditorText(shifts: Shift[]) {
  return shifts
    .map((shift) => {
      const [start, end] = span(shift);
      return `${shift.start}${start >= 1440 ? " +1" : ""}-${shift.end}${end >= 1440 ? " +1" : ""}`;
    })
    .join(", ");
}

export function validateShiftText(value: string): ShiftValidation {
  if (!value.trim()) return { shifts: [], errors: {}, worked: 0, pause: 0 };
  const shifts: Shift[] = [];
  try {
    for (const [index, part] of value.split(",").entries()) {
      const match = part
        .trim()
        .match(/^(\d{2}:\d{2})(?:\s*\+(1))?\s*-\s*(\d{2}:\d{2})(?:\s*\+(1))?$/);
      if (!match)
        throw new Error(
          `Período ${index + 1}: use HH:MM-HH:MM. Exemplo: 08:00-12:00, 13:00-17:24.`,
        );
      clock(match[1]);
      clock(match[3]);
      const previous = shifts.at(-1);
      const inferredStart = previous && span(previous)[1] >= 1440 ? 1 : 0;
      const startDay = match[2] ? 1 : inferredStart;
      const endDay = match[4] ? 1 : startDay;
      const shift: Shift = { start: match[1], end: match[3], startDay, endDay };
      if (
        clock(shift.end) + endDay * 1440 <=
        clock(shift.start) + startDay * 1440
      )
        throw new Error(
          `Período ${index + 1}: o fim deve ocorrer depois do início. Indique +1 no horário do dia seguinte.`,
        );
      const [start] = span(shift);
      if (previous && start < span(previous)[1])
        throw new Error(
          `Período ${index + 1}: os períodos se sobrepõem ou estão fora de ordem.`,
        );
      shifts.push(shift);
    }
    const ranges = shifts.map(span);
    return {
      shifts,
      errors: {},
      worked: minutes(shifts),
      pause: ranges
        .slice(1)
        .reduce((total, range, i) => total + range[0] - ranges[i][1], 0),
    };
  } catch (error) {
    return {
      shifts: null,
      errors: {
        intervals:
          error instanceof Error
            ? error.message
            : "Confira os períodos informados.",
      },
      worked: 0,
      pause: 0,
    };
  }
}
