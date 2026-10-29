"use client";
import { useId, useState } from "react";
import { Calculator } from "lucide-react";
import { contractDurationText, contractMinutesFromHours } from "@/lib/contract";
import { formatMinutes, minutes } from "@/lib/engine";
import { shiftEditorText } from "@/lib/shift-editor";
import {
  simulateWeeklyPattern,
  type WeeklySimulationInput,
} from "@/lib/schedule-simulator";
import type { WeekPattern } from "@/lib/types";

const weekdays = [
  { day: 1, label: "Segunda" },
  { day: 2, label: "Terça" },
  { day: 3, label: "Quarta" },
  { day: 4, label: "Quinta" },
  { day: 5, label: "Sexta" },
  { day: 6, label: "Sábado" },
  { day: 0, label: "Domingo" },
];
function initialTotal(pattern: WeekPattern) {
  try {
    return (
      Object.values(pattern).reduce(
        (sum, shifts) => sum + minutes(shifts),
        0,
      ) || 2520
    );
  } catch {
    return 2520;
  }
}
const duration = (value: string) => {
  if (!value.trim())
    throw new Error(
      "Preencha as durações. Para simular sem intervalo, use 00:00.",
    );
  return value.trim() === "00:00" ? 0 : contractMinutesFromHours(value);
};

export default function ScheduleSimulator({
  currentPattern,
  onApply,
  constraints,
}: {
  currentPattern: WeekPattern;
  onApply: (pattern: WeekPattern) => void;
  constraints?: Pick<
    WeeklySimulationInput,
    | "unavailableDays"
    | "maxWorkedMinutesPerDay"
    | "maxShiftMinutes"
    | "minimumRestMinutes"
  >;
}) {
  const id = useId();
  const [weekly, setWeekly] = useState(() =>
    contractDurationText(initialTotal(currentPattern)),
  );
  const [selected, setSelected] = useState(() => {
    const existing = weekdays
      .filter(({ day }) => currentPattern[String(day)]?.length)
      .map(({ day }) => day);
    return existing.length ? existing : [1, 2, 3, 4, 5];
  });
  const [start, setStart] = useState("08:00");
  const [breakAfter, setBreakAfter] = useState("04:00");
  const [pause, setPause] = useState("01:00");
  const [attempted, setAttempted] = useState(false);
  const [applied, setApplied] = useState(false);
  const change = () => {
    setAttempted(false);
    setApplied(false);
  };
  const result = (() => {
    try {
      return simulateWeeklyPattern(
        {
          weeklyMinutes: duration(weekly) ?? 0,
          workdays: selected,
          start,
          breakAfterMinutes: duration(breakAfter) ?? 0,
          breakMinutes: duration(pause) ?? 0,
          ...constraints,
        },
        currentPattern,
      );
    } catch (error) {
      return {
        ok: false as const,
        errors: [
          error instanceof Error
            ? error.message
            : "Confira as durações informadas.",
        ],
      };
    }
  })();
  return (
    <details className="schedule-simulator section-divider span2">
      <summary>
        <Calculator size={16} aria-hidden="true" /> Simular distribuição semanal
      </summary>
      <p className="muted">
        Distribua a carga exata em minutos e confira a proposta antes de
        aplicá-la ao modelo. Não altera escalas já salvas.
      </p>
      <div className="form-grid">
        <label htmlFor={`${id}-weekly`}>
          Carga semanal desejada
          <input
            id={`${id}-weekly`}
            value={weekly}
            inputMode="text"
            placeholder="42:00"
            onChange={(event) => {
              setWeekly(event.target.value);
              change();
            }}
          />
        </label>
        <label htmlFor={`${id}-start`}>
          Início do turno
          <input
            id={`${id}-start`}
            type="time"
            value={start}
            onChange={(event) => {
              setStart(event.target.value);
              change();
            }}
          />
        </label>
        <label htmlFor={`${id}-after`}>
          Trabalho antes do intervalo
          <input
            id={`${id}-after`}
            value={breakAfter}
            placeholder="04:00"
            onChange={(event) => {
              setBreakAfter(event.target.value);
              change();
            }}
          />
        </label>
        <label htmlFor={`${id}-pause`}>
          Duração do intervalo
          <input
            id={`${id}-pause`}
            value={pause}
            placeholder="01:00"
            onChange={(event) => {
              setPause(event.target.value);
              change();
            }}
          />
          <span className="muted">
            Use 00:00 para simular sem intervalo; a conferência legal continua
            necessária.
          </span>
        </label>
      </div>
      <fieldset>
        <legend>Dias de trabalho</legend>
        <div className="actions">
          {weekdays.map(({ day, label }) => (
            <label key={day} className="checkbox">
              <input
                type="checkbox"
                checked={selected.includes(day)}
                onChange={(event) => {
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, day]
                      : current.filter((value) => value !== day),
                  );
                  change();
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <button
        className="button small"
        type="button"
        onClick={() => {
          setAttempted(true);
          setApplied(false);
        }}
      >
        Calcular proposta
      </button>
      {attempted && !result.ok && (
        <div role="alert" className="field-error">
          {result.errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
      {attempted && result.ok && (
        <div aria-live="polite">
          <p>
            <strong>Total exato: {formatMinutes(result.totalMinutes)}</strong> ·{" "}
            {result.days.length} dias de trabalho · {result.restDays} dias sem
            início de turno.
          </p>
          <div className="table-scroll">
            <table>
              <caption>Proposta de horários por dia da semana</caption>
              <thead>
                <tr>
                  <th>Dia</th>
                  <th>Horários propostos</th>
                  <th>Trabalho</th>
                </tr>
              </thead>
              <tbody>
                {weekdays.map(({ day, label }) => (
                  <tr key={day}>
                    <td>{label}</td>
                    <td>
                      {shiftEditorText(result.pattern[String(day)]) || "Folga"}
                    </td>
                    <td>
                      {formatMinutes(minutes(result.pattern[String(day)]))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.comparison && (
            <div className="table-scroll">
              <table>
                <caption>Comparação com o modelo atual</caption>
                <thead>
                  <tr>
                    <th>Indicador</th>
                    <th>Atual</th>
                    <th>Proposta</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Carga semanal</td>
                    <td>{formatMinutes(result.comparison.before.minutes)}</td>
                    <td>{formatMinutes(result.comparison.after.minutes)}</td>
                  </tr>
                  <tr>
                    <td>Dias de trabalho</td>
                    <td>{result.comparison.before.workdays}</td>
                    <td>{result.comparison.after.workdays}</td>
                  </tr>
                  <tr>
                    <td>Dias sem início de turno</td>
                    <td>{result.comparison.before.restDays}</td>
                    <td>{result.comparison.after.restDays}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {result.warnings.map((warning) => (
            <p className="muted" key={warning}>
              {warning}
            </p>
          ))}
          <button
            className="button small primary"
            type="button"
            onClick={() => {
              if (result.ok) {
                onApply(structuredClone(result.pattern));
                setApplied(true);
              }
            }}
          >
            Aplicar proposta ao modelo
          </button>
          {applied && (
            <p role="status">
              Horários aplicados aos campos. Salve o modelo para concluir.
            </p>
          )}
        </div>
      )}
    </details>
  );
}
