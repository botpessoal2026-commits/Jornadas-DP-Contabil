"use client";
import { useId, useState } from "react";
import type { BusinessHours, Shift } from "@/lib/types";
import { businessWeekdays, validateBusinessHours } from "@/lib/business-hours";

export default function BusinessHoursFields({
  value,
}: {
  value?: BusinessHours | null;
}) {
  const id = useId();
  const [enabled, setEnabled] = useState(!!value);
  const [week, setWeek] = useState<BusinessHours["semana"]>(
    () =>
      value?.semana ??
      Object.fromEntries(businessWeekdays.map((_, day) => [String(day), []])),
  );
  const [minimum, setMinimum] = useState(value?.minimo_funcionarios ?? 1);
  const [holidays, setHolidays] = useState<BusinessHours["feriados"]>(
    value?.feriados ?? "fechado",
  );
  const raw = enabled
    ? { semana: week, minimo_funcionarios: minimum, feriados: holidays }
    : null;
  let error = "";
  try {
    validateBusinessHours(raw);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Confira os horários.";
  }
  function update(day: number, periods: Shift[]) {
    setWeek((current) => ({ ...current, [String(day)]: periods }));
  }
  return (
    <fieldset
      className="span2 business-hours-fields"
      aria-label="Horário de funcionamento da empresa"
    >
      <legend>Horário de funcionamento da empresa</legend>
      <p className="muted">
        Informe quando a empresa abre. Esse horário orienta a cobertura e o
        revezamento; os turnos e contratos dos funcionários continuam sendo
        conferidos separadamente.
      </p>
      <label className="check-label mt-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Cadastrar horário de funcionamento
      </label>
      <input
        type="hidden"
        name="horario_funcionamento"
        value={raw ? JSON.stringify(raw) : ""}
      />
      {enabled && (
        <>
          <div className="business-hours-week mt-3">
            {businessWeekdays.map((name, day) => {
              const periods = week[String(day)] ?? [],
                full =
                  periods.length === 1 &&
                  periods[0].start === "00:00" &&
                  periods[0].end === "00:00" &&
                  periods[0].endDay === 1;
              const mode = !periods.length ? "closed" : full ? "24h" : "hours";
              return (
                <div className="business-hours-day" key={day}>
                  <label htmlFor={`${id}-${day}-mode`}>
                    {name}
                    <select
                      id={`${id}-${day}-mode`}
                      value={mode}
                      onChange={(event) =>
                        update(
                          day,
                          event.target.value === "closed"
                            ? []
                            : event.target.value === "24h"
                              ? [{ start: "00:00", end: "00:00", endDay: 1 }]
                              : [{ start: "08:00", end: "18:00" }],
                        )
                      }
                    >
                      <option value="closed">Fechado</option>
                      <option value="hours">Por horário</option>
                      <option value="24h">24 horas</option>
                    </select>
                  </label>
                  {mode === "hours" && (
                    <div>
                      {periods.map((period, index) => (
                        <div className="business-hours-period" key={index}>
                          <label>
                            Abertura {name} · período {index + 1}
                            <input
                              type="time"
                              required
                              value={period.start}
                              onChange={(event) =>
                                update(
                                  day,
                                  periods.map((item, i) =>
                                    i === index
                                      ? { ...item, start: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </label>
                          <label>
                            Fechamento {name} · período {index + 1}
                            <input
                              type="time"
                              required
                              value={period.end}
                              onChange={(event) =>
                                update(
                                  day,
                                  periods.map((item, i) =>
                                    i === index
                                      ? { ...item, end: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </label>
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={
                                period.endDay === 1 ||
                                (period.endDay === undefined &&
                                  period.end <= period.start)
                              }
                              onChange={(event) =>
                                update(
                                  day,
                                  periods.map((item, i) =>
                                    i === index
                                      ? {
                                          ...item,
                                          endDay: event.target.checked ? 1 : 0,
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                            Fecha no dia seguinte · {name} · período {index + 1}
                          </label>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="button small"
                        onClick={() =>
                          update(
                            day,
                            periods.length === 2
                              ? [periods[0]]
                              : [
                                  { start: "08:00", end: "12:00" },
                                  { start: "13:00", end: "18:00" },
                                ],
                          )
                        }
                      >
                        {periods.length === 2
                          ? `Remover pausa de ${name}`
                          : `Adicionar pausa em ${name}`}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="filters mt-3">
            <label>
              Cobertura mínima durante o funcionamento
              <input
                type="number"
                min="1"
                max="200"
                step="1"
                required
                value={minimum}
                onChange={(event) => setMinimum(Number(event.target.value))}
              />
            </label>
            <label>
              Funcionamento em feriados
              <select
                value={holidays}
                onChange={(event) =>
                  setHolidays(event.target.value as BusinessHours["feriados"])
                }
              >
                <option value="fechado">Fechado nos feriados</option>
                <option value="seguir_semana">
                  Seguir os horários da semana
                </option>
              </select>
            </label>
          </div>
          <p className="muted mt-2">
            A cobertura mínima é uma meta operacional da empresa inteira.
            Eventos específicos de fechamento ou expediente reduzido continuam
            sendo considerados.
          </p>
          {error && (
            <p className="auth-field-error mt-3" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
