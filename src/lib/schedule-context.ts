import { addDays, monthDates } from "./engine";
import type { Schedule } from "./types";

/** Saved civil dates take precedence over forecasts outside the edited month. */
export function validationDays(schedule: Schedule, schedules: Schedule[]) {
  const month = schedule.mes.slice(0, 7);
  const dates = monthDates(month);
  const start = addDays(dates[0], -15);
  const end = addDays(dates.at(-1)!, 15);
  const days = new Map(schedule.dias.map((day) => [day.data, day]));
  for (const neighbor of schedules) {
    if (
      neighbor.empresa_id !== schedule.empresa_id ||
      neighbor.funcionario_id !== schedule.funcionario_id ||
      neighbor.mes.slice(0, 7) === month
    )
      continue;
    for (const day of neighbor.dias) {
      if (
        day.data.startsWith(neighbor.mes.slice(0, 7)) &&
        day.data >= start &&
        day.data <= end &&
        !day.data.startsWith(month)
      )
        days.set(day.data, day);
    }
  }
  return [...days.values()].sort((a, b) => a.data.localeCompare(b.data));
}
