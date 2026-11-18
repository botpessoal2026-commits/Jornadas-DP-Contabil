import type { BusinessHours, Shift } from "./types";
import { span } from "./engine";
export const businessWeekdays = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];
export function businessHoursPersistenceError(
  error: { code?: string; message: string },
  includesHours: boolean,
) {
  return includesHours &&
    (["PGRST204", "42703", "42883", "PGRST202"].includes(error.code ?? "") ||
      /Campo não permitido.*horario_funcionamento/.test(error.message))
    ? "Horário de funcionamento ainda não ativado no banco. Execute a migration 202611180002_company_business_hours.sql no Supabase e tente salvar novamente."
    : error.message;
}
type Range = [number, number];
export function validateBusinessHours(value: unknown): BusinessHours | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("Confira o horário de funcionamento da empresa.");
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) => !["semana", "minimo_funcionarios", "feriados"].includes(key),
    )
  )
    throw new Error("O horário de funcionamento contém campos desconhecidos.");
  if (
    !Number.isInteger(data.minimo_funcionarios) ||
    Number(data.minimo_funcionarios) < 1 ||
    Number(data.minimo_funcionarios) > 200
  )
    throw new Error(
      "Informe entre 1 e 200 funcionários para a cobertura mínima.",
    );
  if (!["fechado", "seguir_semana"].includes(String(data.feriados)))
    throw new Error("Escolha o funcionamento nos feriados.");
  if (
    !data.semana ||
    typeof data.semana !== "object" ||
    Array.isArray(data.semana) ||
    Object.keys(data.semana).length !== 7
  )
    throw new Error("Informe o funcionamento dos sete dias da semana.");
  const week = data.semana as Record<string, unknown>,
    ranges: Range[] = [],
    normalized: BusinessHours["semana"] = {};
  businessWeekdays.forEach((name, day) => {
    const shifts = week[String(day)];
    if (!Array.isArray(shifts) || shifts.length > 2)
      throw new Error(`${name}: informe até dois períodos ou marque fechado.`);
    normalized[String(day)] = shifts
      .map((input: unknown): Shift => {
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new Error(`${name}: confira os períodos de funcionamento.`);
        const shift = input as Shift;
        if (
          Object.keys(shift).some(
            (key) => !["start", "end", "startDay", "endDay"].includes(key),
          ) ||
          (shift.startDay ?? 0) !== 0 ||
          typeof shift.start !== "string" ||
          typeof shift.end !== "string"
        )
          throw new Error(`${name}: confira a abertura e o fechamento.`);
        const [start, end] = span(shift);
        ranges.push([day * 1440 + start, day * 1440 + end]);
        return {
          start: shift.start,
          end: shift.end,
          ...(end >= 1440 ? { endDay: 1 } : {}),
        };
      })
      .sort((a, b) => a.start.localeCompare(b.start));
  });
  for (let i = 0; i < ranges.length; i++)
    for (let j = 0; j < ranges.length; j++)
      for (const offset of [-10080, 0, 10080]) {
        if (i === j && !offset) continue;
        if (
          ranges[i][0] < ranges[j][1] + offset &&
          ranges[j][0] + offset < ranges[i][1]
        )
          throw new Error(
            "Há períodos de funcionamento sobrepostos, inclusive na virada do dia. Confira os horários.",
          );
      }
  return {
    semana: normalized,
    minimo_funcionarios: Number(data.minimo_funcionarios),
    feriados: data.feriados as BusinessHours["feriados"],
  };
}
export function businessHoursFromForm(value: FormDataEntryValue | null) {
  if (!value) return null;
  try {
    return validateBusinessHours(JSON.parse(String(value)));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(
        "Não foi possível ler o horário de funcionamento. Confira os campos.",
        { cause: error },
      );
    throw error;
  }
}
export function businessHoursLabel(hours?: BusinessHours | null) {
  if (!hours) return "Horário de funcionamento não informado";
  return businessWeekdays
    .map(
      (name, day) =>
        `${name}: ${hours.semana[String(day)]?.map((shift) => `${shift.start}–${shift.end}${span(shift)[1] >= 1440 ? " (+1 dia)" : ""}`).join(" / ") || "Fechado"}`,
    )
    .join("; ");
}
