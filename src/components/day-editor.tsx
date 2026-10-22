"use client";
import { useEffect, useId, useMemo, useState } from "react";
import { formatMinutes } from "@/lib/engine";
import {
  fieldsFromShifts,
  shiftEditorText,
  validateShiftFields,
  validateShiftText,
  type ShiftFields,
  type TimeField,
} from "@/lib/shift-editor";
import type { Day } from "@/lib/types";

const fields: { key: TimeField; label: string }[] = [
  { key: "entry", label: "Entrada" },
  { key: "breakStart", label: "Início do intervalo" },
  { key: "breakEnd", label: "Retorno" },
  { key: "exit", label: "Saída" },
];

/** Mount with key={day.data}; callbacks should be stable setters/useCallback. */
export default function DayEditor({
  day,
  onChange,
  onValidityChange,
}: {
  day: Day;
  onChange: (day: Day | null) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const id = useId();
  const [values, setValues] = useState<ShiftFields>(() =>
    fieldsFromShifts(day.intervalos),
  );
  const [kind, setKind] = useState(
    day.intervalos.length ? "trabalho" : "folga",
  );
  const [advanced, setAdvanced] = useState(day.intervalos.length > 2);
  const [raw, setRaw] = useState(() => shiftEditorText(day.intervalos));
  const [notes, setNotes] = useState(day.observacao);
  const result = useMemo(
    () =>
      kind === "folga"
        ? { shifts: [], errors: {}, worked: 0, pause: 0 }
        : advanced
          ? validateShiftText(raw)
          : validateShiftFields(values),
    [kind, advanced, raw, values],
  );
  const valid = result.shifts !== null;
  useEffect(() => {
    onChange(
      result.shifts === null
        ? null
        : {
            ...day,
            intervalos: result.shifts,
            folga: result.shifts.length === 0,
            observacao: notes,
          },
    );
    onValidityChange?.(valid);
  }, [result, notes, day, onChange, onValidityChange, valid]);
  function switchMode() {
    if (advanced) {
      const parsed = validateShiftText(raw);
      if (!parsed.shifts || parsed.shifts.length > 2) return;
      setValues(fieldsFromShifts(parsed.shifts));
    } else {
      const parsed = validateShiftFields(values);
      if (parsed.shifts) setRaw(shiftEditorText(parsed.shifts));
      else if (Object.values(values).some((v) => typeof v === "string" && v))
        return;
    }
    setAdvanced(!advanced);
  }
  return (
    <>
      <label className="span2" htmlFor={`${id}-kind`}>
        Tipo do dia
        <select
          id={`${id}-kind`}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="trabalho">Trabalho</option>
          <option value="folga">Folga</option>
        </select>
      </label>
      {kind === "trabalho" && (
        <>
          <p className="span2 muted" id={`${id}-help`}>
            Use HH:MM ou escolha um horário sugerido. Os campos de intervalo são
            opcionais; preencha os dois para incluir uma pausa. Para atravessar
            meia-noite, selecione Dia seguinte no horário correspondente.
          </p>
          {advanced ? (
            <div className="span2">
              <label htmlFor={`${id}-raw`}>
                Intervalos de trabalho (vazio = folga)
              </label>
              <input
                id={`${id}-raw`}
                name="intervalos"
                value={raw}
                onChange={(event) => setRaw(event.target.value)}
                aria-invalid={Boolean(result.errors.intervals)}
                aria-describedby={`${id}-raw-help${result.errors.intervals ? ` ${id}-raw-error` : ""}`}
                placeholder="08:00-12:00, 13:00-17:24"
              />
              <p className="muted" id={`${id}-raw-help`}>
                Separe períodos por vírgula. Use +1 junto aos horários do dia
                seguinte: 22:00-02:00 +1, 03:00 +1-06:00 +1. Todos os períodos
                existentes são preservados.
              </p>
              {result.errors.intervals && (
                <p className="field-error" id={`${id}-raw-error`} role="alert">
                  {result.errors.intervals}
                </p>
              )}
            </div>
          ) : (
            fields.map(({ key, label }) => (
              <div key={key}>
                <label htmlFor={`${id}-${key}`}>{label}</label>
                <input
                  id={`${id}-${key}`}
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  list={`${id}-times`}
                  placeholder="HH:MM"
                  value={values[key]}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  aria-invalid={Boolean(result.errors[key])}
                  aria-describedby={`${id}-help${result.errors[key] ? ` ${id}-${key}-error` : ""}`}
                />
                <label
                  className="day-offset-label"
                  htmlFor={`${id}-${key}-day`}
                >
                  Data: {label.toLocaleLowerCase("pt-BR")}
                </label>
                <select
                  id={`${id}-${key}-day`}
                  value={values[`${key}Day`]}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [`${key}Day`]: Number(event.target.value) as 0 | 1,
                    }))
                  }
                >
                  <option value="0">Dia da jornada</option>
                  <option value="1">Dia seguinte (+1)</option>
                </select>
                {result.errors[key] && (
                  <p
                    className="field-error"
                    id={`${id}-${key}-error`}
                    role="alert"
                  >
                    {result.errors[key]}
                  </p>
                )}
              </div>
            ))
          )}
          <datalist id={`${id}-times`}>
            {Array.from(
              { length: 48 },
              (_, i) =>
                `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
            ).map((time) => (
              <option key={time} value={time} />
            ))}
          </datalist>
          <div className="span2">
            <button
              type="button"
              className="button small"
              onClick={switchMode}
              disabled={
                advanced && (!result.shifts || result.shifts.length > 2)
              }
            >
              {advanced
                ? "Usar campos separados"
                : "Editar períodos adicionais em texto"}
            </button>
            {advanced && result.shifts && result.shifts.length > 2 && (
              <p className="muted">
                Esta jornada tem mais de dois períodos. Use o editor de texto
                para preservar todos os horários.
              </p>
            )}
          </div>
        </>
      )}
      <div
        className="span2 day-editor-summary"
        role="status"
        aria-live="polite"
      >
        {valid ? (
          <>
            <strong>Duração diária: {formatMinutes(result.worked)}</strong>
            <br />
            {kind === "folga"
              ? "Folga sem períodos de trabalho."
              : `Pausas entre períodos: ${formatMinutes(result.pause)}. Duração de relógio; a conferência aplica a regra noturna vigente.`}
          </>
        ) : (
          "Corrija os horários indicados para salvar a edição. O texto digitado foi preservado."
        )}
      </div>
      <label className="span2" htmlFor={`${id}-notes`}>
        Observação
        <textarea
          id={`${id}-notes`}
          name="observacao"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
    </>
  );
}
