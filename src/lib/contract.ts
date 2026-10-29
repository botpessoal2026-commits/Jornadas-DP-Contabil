/** Carga explícita, nunca inferida de observações ou do teto legal. */
export function contractMinutesFromHours(value: string): number | null {
  const input = value.trim().toLocaleLowerCase("pt-BR");
  if (!input) return null;
  const clock = /^(\d{1,3})\s*(?::|h)\s*(\d{2})$/.exec(input);
  const hours = clock
    ? Number(clock[1]) + Number(clock[2]) / 60
    : /^\d+(?:[.,]\d+)?$/.test(input)
      ? Number(input.replace(",", "."))
      : NaN;
  const rawMinutes = hours * 60;
  const minutes = Math.round(rawMinutes);
  if (
    !Number.isFinite(hours) ||
    (clock !== null && Number(clock[2]) > 59) ||
    minutes < 1 ||
    minutes > 10080 ||
    Math.abs(rawMinutes - minutes) > 0.000001
  )
    throw new Error(
      "Informe a carga semanal entre 1 minuto e 168 horas em HH:MM (ex.: 42:00), 8h24 ou horas decimais, sem frações de minuto.",
    );
  return minutes;
}

/** Human input, while persistence and calculations remain integer minutes. */
export function contractDurationText(value?: number | null): string {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
    : "";
}
