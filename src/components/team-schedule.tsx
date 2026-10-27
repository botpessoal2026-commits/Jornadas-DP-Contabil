"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { addDays, dateUTC, monday, monthDates } from "@/lib/engine";
import type { Data } from "@/lib/store";
import type { Employee } from "@/lib/types";
import { teamScheduleRows } from "@/lib/team-schedule";

export default function TeamSchedule({
  data,
  month,
  companyId,
  onOpen,
  hasUnsavedPreview,
  onReturnToPreview,
}: {
  data: Data;
  month: string;
  companyId: string | null;
  onOpen: (employee: Employee) => void;
  hasUnsavedPreview: boolean;
  onReturnToPreview: () => void;
}) {
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [reference, setReference] = useState(`${month}-01`);
  const rows = useMemo(
    () => teamScheduleRows(data, month, companyId),
    [data, month, companyId],
  );
  const monthDays = monthDates(month);
  const dates = monthDays.filter((date) =>
    view === "day"
      ? date === reference
      : view === "week"
        ? date >= monday(reference) && date <= addDays(monday(reference), 6)
        : true,
  );
  const monthLabel = dateUTC(`${month}-01`).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <section className="panel team-schedule" aria-label="Grade da equipe">
      <div className="panel-head">
        <div>
          <h2>Grade da equipe</h2>
          <p className="subtitle !mt-1">
            {companyId
              ? data.companies.find((company) => company.id === companyId)?.nome
              : "Visão consolidada"}{" "}
            · {monthLabel}
          </p>
        </div>
        <div className="actions" role="group" aria-label="Período da grade">
          {(
            [
              ["day", "Dia"],
              ["week", "Semana"],
              ["month", "Mês"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`button small ${view === id ? "primary" : ""}`}
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-body team-toolbar">
        <p className="muted">
          Somente escalas salvas. Dias sem registro aparecem como “Sem escala”;
          nenhuma folga ou aprovação é presumida. Abra o funcionário para
          editar. Totais em horas computadas por data civil, com redução noturna
          parametrizada.
          {view === "week" && dates.length < 7 && (
            <span className="team-partial-note">
              Semana parcial: somente os dias desta competência.
            </span>
          )}
        </p>
        {view !== "month" && (
          <label>
            Data de referência
            <input
              type="date"
              value={reference}
              min={monthDays[0]}
              max={monthDays.at(-1)}
              onChange={(event) => {
                if (monthDays.includes(event.target.value))
                  setReference(event.target.value);
              }}
            />
          </label>
        )}
        {hasUnsavedPreview && (
          <p className="team-preview-note">
            Há alterações não salvas na prévia individual.{" "}
            <button type="button" onClick={onReturnToPreview}>
              Voltar à prévia
            </button>
          </p>
        )}
      </div>
      {rows.length ? (
        <div
          className="table-wrap team-table-wrap"
          role="region"
          aria-label="Escalas salvas da equipe — role para consultar os dias"
          tabIndex={0}
        >
          <table className="team-table">
            <caption className="sr-only">
              Escalas salvas da equipe em {monthLabel}. Borda vermelha indica
              impedimento; âmbar indica atenção.
            </caption>
            <thead>
              <tr>
                <th scope="col">Funcionário / Empresa</th>
                {dates.map((date) => (
                  <th scope="col" key={date}>
                    {date.slice(-2)}/{date.slice(5, 7)}
                    <span className="team-weekday">
                      {dateUTC(date).toLocaleDateString("pt-BR", {
                        weekday: "short",
                        timeZone: "UTC",
                      })}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.employee.id} data-team-employee={row.employee.id}>
                  <th scope="row">
                    <button
                      type="button"
                      className="team-employee-link"
                      aria-label={`Abrir escala de ${row.employee.nome} · ${row.company.nome}`}
                      onClick={() => onOpen(row.employee)}
                    >
                      {row.employee.nome}
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                    <span className="team-company">{row.company.nome}</span>
                    {row.reviewIncomplete && (
                      <span className="warning-text">
                        Conferência incompleta
                      </span>
                    )}
                    {(row.employee.situacao === "inativo" ||
                      (row.company.situacao ?? "ativa") !== "ativa") && (
                      <span className="team-company">Vínculo em consulta</span>
                    )}
                  </th>
                  {row.days
                    .filter((day) => dates.includes(day.date))
                    .map((day) => (
                      <td
                        key={day.date}
                        data-team-date={day.date}
                        data-day-kind={day.dayKind}
                        data-problem={day.problem ?? undefined}
                        className={`team-day ${day.state} ${day.problem ? `has-${day.problem}` : ""}`}
                      >
                        {day.problem && (
                          <span className={`team-problem ${day.problem}`}>
                            <AlertTriangle size={13} aria-hidden="true" />
                            {day.problem === "violation"
                              ? "Impedimento"
                              : "Atenção"}
                          </span>
                        )}
                        {day.state === "missing" ? (
                          <span className="muted">Sem escala</span>
                        ) : day.state === "invalid" ? (
                          <span>Revisar horários</span>
                        ) : day.state === "rest" ? (
                          <span className="muted">Folga</span>
                        ) : (
                          <>
                            {day.shifts.length ? (
                              day.shifts.map((shift, i) => (
                                <span className="team-shift" key={i}>
                                  {shift}
                                </span>
                              ))
                            ) : (
                              <span className="team-shift">
                                Continuação do turno
                              </span>
                            )}
                            <strong className="team-hours">{day.hours}</strong>
                          </>
                        )}
                        {(day.eventLabel || day.holiday) && (
                          <span className="team-holiday">
                            {day.eventLabel || day.holiday}
                          </span>
                        )}
                      </td>
                    ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">Nenhum funcionário neste contexto.</p>
      )}
      <div className="legend">
        <span>
          <span className="legend-border violation" aria-hidden="true" />
          Impedimento
        </span>
        <span>
          <span className="legend-border attention" aria-hidden="true" />
          Atenção
        </span>
        <span>Sem escala: registro ausente · Folga: descanso salvo</span>
      </div>
    </section>
  );
}
