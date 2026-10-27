"use client";
import { useEffect, useId, useMemo, useState } from "react";
import { formatMinutes } from "@/lib/engine";
import { categoryLabels, dayPresentation } from "@/lib/special-dates";
import {
  fieldsFromShifts,
  shiftEditorText,
  validateShiftFields,
  validateShiftText,
  type ShiftFields,
  type TimeField,
} from "@/lib/shift-editor";
import type { Day, DayException, DayPlan } from "@/lib/types";

type DayKind =
  | "trabalho"
  | "folga"
  | "feriado"
  | "feriado_trabalhado"
  | "ponto_facultativo"
  | "recesso"
  | "sem_expediente";

const originLabels = {
  empresa: "Empresa",
  estabelecimento: "Estabelecimento",
  individual: "Individual",
  oficial: "Calendário oficial",
};

const dayPlan = (day: Day): DayPlan =>
  day.calendario?.base ?? {
    intervalos: structuredClone(day.intervalos),
    folga: day.folga,
    feriado: day.feriado,
    observacao: day.observacao,
  };

/** Edit the employee's stored intent, rather than a temporarily clipped view. */
export function dayEditorSource(day: Day, calendarDays?: Day[]) {
  const exception = day.calendario?.excecao;
  const presentation = dayPresentation(day, calendarDays);
  const intervals = exception?.intervalos ?? day.intervalos;
  const kind: DayKind = exception
    ? exception.categoria === "feriado" && intervals.length
      ? "feriado_trabalhado"
      : exception.categoria
    : presentation.kind;
  return {
    kind,
    intervals,
    name: exception
      ? exception.nome
      : day.feriado || day.eventos?.at(-1)?.nome || "",
    expedient:
      exception?.expediente ??
      (presentation.hasWork ? "normal" : "sem_expediente"),
    notes:
      exception?.observacao ??
      day.calendario?.base.observacao ??
      day.observacao,
  };
}

/** Keep the source plan independently from the employee's explicit exception. */
export function individualDay(
  day: Day,
  exception: DayException,
  inheritedDay?: Day,
): Day {
  const base = dayPlan(day);
  const inheritedHoliday = inheritedDay ? inheritedDay.feriado : base.feriado;
  const holiday =
    exception.categoria === "feriado"
      ? [
          ...new Set([inheritedHoliday, exception.nome.trim()].filter(Boolean)),
        ].join(" · ")
      : inheritedHoliday;
  return {
    ...day,
    intervalos: structuredClone(exception.intervalos),
    folga: exception.intervalos.length === 0,
    feriado: holiday || null,
    observacao: exception.observacao,
    calendario: {
      ...day.calendario,
      base,
      excecao: structuredClone(exception),
    },
  };
}

const fields: { key: TimeField; label: string }[] = [
  { key: "entry", label: "Entrada" },
  { key: "breakStart", label: "Início do intervalo" },
  { key: "breakEnd", label: "Retorno" },
  { key: "exit", label: "Saída" },
];

/** Mount with key={day.data}; callbacks should be stable setters/useCallback. */
export default function DayEditor({
  day,
  inheritedDay,
  calendarDays,
  onChange,
  onValidityChange,
}: {
  day: Day;
  inheritedDay?: Day;
  calendarDays?: Day[];
  onChange: (day: Day | null) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const id = useId();
  const [inherited] = useState<Day>(() => {
    const source = inheritedDay ?? { ...day, ...dayPlan(day) };
    return {
      ...source,
      calendario: {
        ...source.calendario,
        base: dayPlan(source),
        excecao: null,
      },
    };
  });
  const [source] = useState(() => dayEditorSource(day, calendarDays));
  const [manual, setManual] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [values, setValues] = useState<ShiftFields>(() =>
    fieldsFromShifts(source.intervals),
  );
  const [kind, setKind] = useState<DayKind>(source.kind);
  const [name, setName] = useState(source.name);
  const [expedient, setExpedient] = useState<DayException["expediente"]>(
    source.expedient,
  );
  const [advanced, setAdvanced] = useState(source.intervals.length > 2);
  const [raw, setRaw] = useState(() => shiftEditorText(source.intervals));
  const [notes, setNotes] = useState(source.notes);
  const work =
    kind === "trabalho" ||
    kind === "feriado_trabalhado" ||
    ((kind === "ponto_facultativo" || kind === "recesso") &&
      expedient !== "sem_expediente");
  const special = !["trabalho", "folga"].includes(kind);
  const origins = cleared && !manual ? inherited.eventos : day.eventos;
  const result = useMemo(
    () =>
      !work
        ? { shifts: [], errors: {}, worked: 0, pause: 0 }
        : advanced
          ? validateShiftText(raw)
          : validateShiftFields(values),
    [work, advanced, raw, values],
  );
  const nameError = special && !name.trim();
  const valid = result.shifts !== null && !nameError;
  useEffect(() => {
    onChange(
      !valid || result.shifts === null
        ? null
        : !manual
          ? cleared
            ? inherited
            : day
          : individualDay(
              day,
              {
                categoria: kind === "feriado_trabalhado" ? "feriado" : kind,
                nome: special ? name.trim() : "",
                expediente: !work
                  ? "sem_expediente"
                  : expedient === "reduzido"
                    ? "reduzido"
                    : "normal",
                intervalos: result.shifts,
                observacao: notes,
              },
              inherited,
            ),
    );
    onValidityChange?.(valid);
  }, [
    result,
    notes,
    day,
    onChange,
    onValidityChange,
    valid,
    manual,
    cleared,
    inherited,
    kind,
    special,
    name,
    expedient,
    work,
  ]);
  function edit() {
    setManual(true);
    setCleared(false);
  }
  function removeException() {
    const next = dayEditorSource(inherited);
    setKind(next.kind);
    setName(next.name);
    setExpedient(next.expedient);
    setValues(fieldsFromShifts(next.intervals));
    setRaw(shiftEditorText(next.intervals));
    setAdvanced(next.intervals.length > 2);
    setNotes(next.notes);
    setManual(false);
    setCleared(true);
  }
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
      <div className="span2 muted">
        Esta edição cria uma exceção somente para este funcionário nesta data.
        Os eventos da empresa e dos demais funcionários permanecem preservados.
      </div>
      {Boolean(origins?.length) && (
        <div
          className="span2 rounded-lg bg-[#f1f6fc] p-3"
          aria-label="Origem das datas especiais"
        >
          <strong>Datas especiais aplicáveis</strong>
          <ul className="mt-2 space-y-2">
            {origins?.map((event) => (
              <li key={event.id}>
                {categoryLabels[event.categoria]}: {event.nome}
                <span className="muted"> · {originLabels[event.origem]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="span2" htmlFor={`${id}-kind`}>
        Tipo do dia
        <select
          id={`${id}-kind`}
          value={kind}
          onChange={(event) => {
            edit();
            const next = event.target.value as DayKind;
            setKind(next);
            if (next === "ponto_facultativo") setExpedient("normal");
            else if (
              next === "recesso" ||
              next === "sem_expediente" ||
              next === "feriado" ||
              next === "folga"
            )
              setExpedient("sem_expediente");
            else setExpedient("normal");
          }}
        >
          <option value="trabalho">Trabalho</option>
          <option value="folga">Folga</option>
          <option value="feriado">Feriado</option>
          <option value="feriado_trabalhado">Feriado trabalhado</option>
          <option value="ponto_facultativo">Ponto facultativo</option>
          <option value="recesso">Recesso</option>
          <option value="sem_expediente">Dia sem expediente</option>
        </select>
      </label>
      {special && (
        <label className="span2" htmlFor={`${id}-name`}>
          Nome da data especial
          <input
            id={`${id}-name`}
            value={name}
            required
            maxLength={300}
            onChange={(event) => {
              edit();
              setName(event.target.value);
            }}
            aria-invalid={nameError}
            aria-describedby={nameError ? `${id}-name-error` : undefined}
          />
          {nameError && (
            <span className="field-error" id={`${id}-name-error`}>
              Informe o nome do feriado ou o motivo da data especial.
            </span>
          )}
        </label>
      )}
      {(kind === "ponto_facultativo" || kind === "recesso") && (
        <label className="span2" htmlFor={`${id}-expedient`}>
          Situação do expediente
          <select
            id={`${id}-expedient`}
            value={expedient}
            onChange={(event) => {
              edit();
              setExpedient(event.target.value as DayException["expediente"]);
            }}
          >
            <option value="normal">Expediente normal</option>
            <option value="sem_expediente">Sem expediente</option>
            <option value="reduzido">Expediente reduzido</option>
          </select>
        </label>
      )}
      {work && (
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
                onChange={(event) => {
                  edit();
                  setRaw(event.target.value);
                }}
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
                  onChange={(event) => {
                    edit();
                    setValues((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }));
                  }}
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
                  onChange={(event) => {
                    edit();
                    setValues((current) => ({
                      ...current,
                      [`${key}Day`]: Number(event.target.value) as 0 | 1,
                    }));
                  }}
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
            {!work
              ? kind === "folga"
                ? "Folga sem períodos de trabalho."
                : "Sem expediente nesta data; nenhuma marcação de frequência é presumida."
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
          onChange={(event) => {
            edit();
            setNotes(event.target.value);
          }}
        />
      </label>
      {(manual || Boolean(day.calendario?.excecao)) && !cleared && (
        <div className="span2">
          <button
            type="button"
            className="button small"
            onClick={removeException}
          >
            Remover exceção individual
          </button>
          <p className="muted mt-2">
            Restaura a programação herdada, mantendo os eventos da empresa.
            Salve a edição e a escala para registrar.
          </p>
        </div>
      )}
    </>
  );
}
