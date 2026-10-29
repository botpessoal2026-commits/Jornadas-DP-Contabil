"use client";
import { useId, useState } from "react";
import { Copy } from "lucide-react";
import { formatMinutes, span } from "@/lib/engine";
import { shiftEditorText, validateShiftText } from "@/lib/shift-editor";
import type { Company, Model } from "@/lib/types";
import ShiftVisualEditor from "./shift-visual-editor";
import ScheduleSimulator from "./schedule-simulator";

const days = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

function initialWeek(model?: Model) {
  return days.map((_, day) =>
    model?.padrao
      ? shiftEditorText(model.padrao[String(day)] ?? [])
      : day > 0 && day < 6
        ? "08:00-12:00, 13:00-17:24"
        : "",
  );
}

export default function ModelFields({
  model,
  companies,
  companyId,
}: {
  model?: Model;
  companies: Company[];
  companyId?: string;
}) {
  const fieldId = useId();
  const [type, setType] = useState<Model["tipo"]>(model?.tipo ?? "5x2");
  const [week, setWeek] = useState(() => initialWeek(model));
  const [cycleStart, setCycleStart] = useState(model?.ciclo_inicio ?? "");
  const [cycleShift, setCycleShift] = useState(() =>
    shiftEditorText(model?.turno ?? []),
  );
  const isCycle = type === "12x36";
  const validation = week.map(validateShiftText);
  const weekValid = validation.every((day) => day.shifts !== null);
  const weeklyMinutes = validation.reduce(
    (total, day) => total + day.worked,
    0,
  );
  const cycleValidation = validateShiftText(cycleShift);
  const cycleSpans = (cycleValidation.shifts ?? [])
    .map(span)
    .sort((a, b) => a[0] - b[0]);
  const cycleDuration = cycleSpans.length
    ? cycleSpans.at(-1)![1] - cycleSpans[0][0]
    : 0;

  return (
    <>
      {(companyId || model?.id) && (
        <input
          type="hidden"
          name="empresa_id"
          value={companyId ?? model?.empresa_id ?? ""}
        />
      )}
      <label>
        Nome do modelo
        <input name="nome" required defaultValue={model?.nome ?? ""} />
      </label>
      <label>
        Tipo de jornada
        <select
          name="tipo"
          value={type}
          onChange={(event) => setType(event.target.value as Model["tipo"])}
        >
          {["5x2", "6x1", "12x36", "turnos", "personalizado"].map((value) => (
            <option key={value} value={value}>
              {value === "12x36" ? "12×36" : value}
            </option>
          ))}
        </select>
      </label>
      <label className="span2">
        Disponível para
        <select
          name="empresa_id"
          disabled={!!companyId || !!model?.id}
          defaultValue={companyId ?? model?.empresa_id ?? ""}
        >
          <option value="">Todas as minhas empresas</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.nome}
            </option>
          ))}
        </select>
      </label>
      {isCycle ? (
        <div className="section-divider span2 pt-4">
          <h3>Somente para ciclo 12×36</h3>
          <p className="subtitle !text-xs mb-4">
            O ciclo alterna dia de turno e dia de descanso a partir da data
            inicial, inclusive entre meses. Cadastre as pausas e o fundamento
            aplicável nos parâmetros legais do regime 12×36.
          </p>
          <p className="model-cycle-note muted mb-4">
            A carga semanal varia conforme o ciclo e a competência.
          </p>
          <p className="model-cycle-note muted mb-4">
            O plantão inclui as pausas; as horas trabalhadas descontam os
            intervalos. O descanso é contado do término até o próximo início.
          </p>
          <div className="form-grid">
            <label>
              Primeiro dia de turno
              <input
                name="ciclo_inicio"
                type="date"
                required
                value={cycleStart}
                onChange={(event) => setCycleStart(event.target.value)}
              />
            </label>
            <label>
              Turno e pausas
              <input
                name="turno"
                required
                placeholder="07:00-12:00, 13:00-19:00"
                value={cycleShift}
                aria-invalid={
                  cycleValidation.errors.intervals ? true : undefined
                }
                aria-describedby={
                  cycleValidation.errors.intervals
                    ? `${fieldId}-cycle-error`
                    : undefined
                }
                onChange={(event) => setCycleShift(event.target.value)}
              />
              {cycleValidation.errors.intervals && (
                <p className="field-error" id={`${fieldId}-cycle-error`}>
                  {cycleValidation.errors.intervals}
                </p>
              )}
            </label>
          </div>
          {cycleValidation.shifts && cycleSpans.length > 0 && (
            <p
              className="model-cycle-note muted mt-4"
              role="status"
              aria-live="polite"
            >
              Duração do plantão: {formatMinutes(cycleDuration)} · Horas
              trabalhadas: {formatMinutes(cycleValidation.worked)}
            </p>
          )}
          <ShiftVisualEditor
            value={cycleShift}
            label="plantão"
            onApply={setCycleShift}
          />
        </div>
      ) : (
        <>
          <p className="subtitle span2 !text-xs !mt-0">
            Use 08:00-12:00, 13:00-17:24. Deixe em branco para folga. Horários
            noturnos: 22:00-05:00 +1.
          </p>
          <div className="model-week-summary span2">
            <p role="status" aria-live="polite">
              <strong>
                Total semanal:{" "}
                {weekValid
                  ? formatMinutes(weeklyMinutes)
                  : "confira os horários"}
              </strong>
            </p>
            <p className="muted">
              Horas de relógio dos sete dias, sem contar as pausas.
            </p>
          </div>
          <div className="model-week-actions span2">
            <button
              className="button small"
              type="button"
              onClick={() =>
                setWeek((current) =>
                  current.map((value, day) =>
                    day > 1 && day < 6 ? current[1] : value,
                  ),
                )
              }
            >
              <Copy size={14} aria-hidden="true" />
              Copiar segunda para dias úteis
            </button>
          </div>
          <ScheduleSimulator
            currentPattern={Object.fromEntries(
              validation.map((day, index) => [String(index), day.shifts ?? []]),
            )}
            onApply={(pattern) =>
              setWeek(
                days.map((_, day) =>
                  shiftEditorText(pattern[String(day)] ?? []),
                ),
              )
            }
          />
          <div className="week-editor span2">
            {days.map((name, day) => {
              const error = validation[day].errors.intervals;
              const id = `${fieldId}-day-${day}`;
              return (
                <div className="week-row" key={day}>
                  <label htmlFor={id}>{name.slice(0, 3)}</label>
                  <div>
                    <input
                      id={id}
                      name={`dia${day}`}
                      aria-label={`Horários de ${name}`}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${id}-error` : undefined}
                      placeholder="Folga"
                      value={week[day]}
                      onChange={(event) =>
                        setWeek((current) =>
                          current.map((value, index) =>
                            index === day ? event.target.value : value,
                          ),
                        )
                      }
                    />
                    {error && (
                      <p className="field-error" id={`${id}-error`}>
                        {error}
                      </p>
                    )}
                    <ShiftVisualEditor
                      value={week[day]}
                      label={name}
                      onApply={(value) =>
                        setWeek((current) =>
                          current.map((item, index) =>
                            index === day ? value : item,
                          ),
                        )
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
