/** Carga explícita, nunca inferida de observações ou do teto legal. */
export function contractMinutesFromHours(value: string): number | null {
  if (!value.trim()) return null;
  const hours = Number(value.replace(",", "."));
  const rawMinutes = hours * 60;
  const minutes = Math.round(rawMinutes);
  if (
    !Number.isFinite(hours) ||
    minutes < 1 ||
    minutes > 10080 ||
    Math.abs(rawMinutes - minutes) > 0.000001
  )
    throw new Error(
      "Informe a carga semanal entre 1 minuto e 168 horas, sem frações de minuto.",
    );
  return minutes;
}
