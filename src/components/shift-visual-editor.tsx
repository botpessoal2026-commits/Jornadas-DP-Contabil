"use client";
import { useEffect, useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Shift } from "@/lib/types";
import { formatMinutes } from "@/lib/engine";
import { shiftEditorText, validateShiftText } from "@/lib/shift-editor";

/** Optional editor; applying always passes through the existing shift parser. */
export default function ShiftVisualEditor({
  value,
  label,
  onApply,
}: {
  value: string;
  label: string;
  onApply: (value: string) => void;
}) {
  const id = useId();
  const [periods, setPeriods] = useState<Shift[]>(
    () => validateShiftText(value).shifts ?? [],
  );
  const [error, setError] = useState("");
  useEffect(() => {
    const parsed = validateShiftText(value);
    if (parsed.shifts) setPeriods(parsed.shifts);
    setError(parsed.errors.intervals ?? "");
  }, [value]);
  const update = (index: number, fields: Partial<Shift>) => {
    setPeriods((current) =>
      current.map((period, i) =>
        i === index ? { ...period, ...fields } : period,
      ),
    );
    setError("");
  };
  function text() {
    return periods
      .map(
        (period) =>
          `${period.start}${period.startDay ? " +1" : ""}-${period.end}${period.endDay ? " +1" : ""}`,
      )
      .join(", ");
  }
  return (
    <details className="shift-visual-editor">
      <summary>Editor visual · {label}</summary>
      <p className="muted">
        Aplique os períodos para atualizar o horário do modelo. Remova todos
        para folga.
      </p>
      {periods.map((period, index) => (
        <fieldset key={index} className="shift-visual-period">
          <legend>Período {index + 1}</legend>
          <label htmlFor={`${id}-${index}-start`}>
            Início
            <input
              id={`${id}-${index}-start`}
              type="time"
              value={period.start}
              onChange={(event) => update(index, { start: event.target.value })}
            />
          </label>
          <label htmlFor={`${id}-${index}-start-day`}>
            Dia do início
            <select
              id={`${id}-${index}-start-day`}
              aria-label="Dia do início"
              value={period.startDay ?? 0}
              onChange={(event) =>
                update(index, { startDay: Number(event.target.value) })
              }
            >
              <option value={0}>Dia da jornada</option>
              <option value={1}>Dia seguinte (+1)</option>
            </select>
          </label>
          <label htmlFor={`${id}-${index}-end`}>
            Término
            <input
              id={`${id}-${index}-end`}
              type="time"
              value={period.end}
              onChange={(event) => update(index, { end: event.target.value })}
            />
          </label>
          <label htmlFor={`${id}-${index}-end-day`}>
            Dia do término
            <select
              id={`${id}-${index}-end-day`}
              aria-label="Dia do término"
              value={period.endDay ?? 0}
              onChange={(event) =>
                update(index, { endDay: Number(event.target.value) })
              }
            >
              <option value={0}>Dia da jornada</option>
              <option value={1}>Dia seguinte (+1)</option>
            </select>
          </label>
          <button
            className="button small"
            type="button"
            aria-label={`Remover período ${index + 1} de ${label}`}
            onClick={() =>
              setPeriods((current) => current.filter((_, i) => i !== index))
            }
          >
            <Trash2 size={15} aria-hidden="true" /> Remover
          </button>
        </fieldset>
      ))}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button
          className="button small"
          type="button"
          disabled={periods.length >= 8}
          onClick={() =>
            setPeriods((current) => [
              ...current,
              { start: "08:00", end: "12:00", startDay: 0, endDay: 0 },
            ])
          }
        >
          <Plus size={15} aria-hidden="true" /> Adicionar período
        </button>
        <button
          className="button small primary"
          type="button"
          onClick={() => {
            const parsed = validateShiftText(text());
            if (!parsed.shifts) {
              setError(
                parsed.errors.intervals ?? "Confira os horários dos períodos.",
              );
              return;
            }
            onApply(shiftEditorText(parsed.shifts));
            setError("");
          }}
        >
          Aplicar horários de {label}
        </button>
      </div>
      {validateShiftText(text()).shifts && (
        <p className="muted">
          Trabalho previsto: {formatMinutes(validateShiftText(text()).worked)}.
        </p>
      )}
    </details>
  );
}
