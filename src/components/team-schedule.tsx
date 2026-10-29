"use client";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { addDays, dateUTC, monday, monthDates } from "@/lib/engine";
import type { Data } from "@/lib/store";
import type { Employee } from "@/lib/types";
import {
  filterTeamRows,
  teamScheduleRows,
  type TeamDay,
  type TeamFilters,
} from "@/lib/team-schedule";

function DayContent({ day }: { day: TeamDay }) {
  return (
    <>
      {day.problem && (
        <span className={`team-problem ${day.problem}`}>
          <AlertTriangle size={13} aria-hidden="true" />
          {day.problem === "violation" ? "Impedimento" : "Atenção"}
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
            day.shifts.map((shift, index) => (
              <span className="team-shift" key={index}>
                {shift}
              </span>
            ))
          ) : (
            <span className="team-shift">Continuação do turno</span>
          )}
          <strong className="team-hours">{day.hours}</strong>
        </>
      )}
      {(day.eventLabel || day.holiday) && (
        <span className="team-holiday">{day.eventLabel || day.holiday}</span>
      )}
    </>
  );
}

function todayInBrazil() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export default function TeamSchedule({
  data,
  month,
  companyId,
  onOpen,
  hasUnsavedPreview,
  onReturnToPreview,
  onOpenDay,
  onMonthChange,
}: {
  data: Data;
  month: string;
  companyId: string | null;
  onOpen: (employee: Employee) => void;
  hasUnsavedPreview: boolean;
  onReturnToPreview: () => void;
  onOpenDay?: (employee: Employee, date: string) => void;
  onMonthChange?: (month: string) => void;
}) {
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [reference, setReference] = useState(`${month}-01`);
  const [filters, setFilters] = useState<TeamFilters>({});
  const allRows = useMemo(
    () => teamScheduleRows(data, month, companyId),
    [data, month, companyId],
  );
  const rows = useMemo(
    () => filterTeamRows(allRows, filters, data.models),
    [allRows, filters, data.models],
  );
  const sectors = [
    ...new Set(allRows.map((row) => row.employee.setor).filter(Boolean)),
  ].sort((a, b) => a!.localeCompare(b!, "pt-BR"));
  const monthDays = monthDates(month);
  const currentReference = monthDays.includes(reference)
    ? reference
    : monthDays[0];
  const dates = monthDays.filter((date) =>
    view === "day"
      ? date === currentReference
      : view === "week"
        ? date >= monday(currentReference) &&
          date <= addDays(monday(currentReference), 6)
        : true,
  );
  const navigatePeriod = (direction: number) => {
    let next: string;
    if (view === "month") {
      const date = dateUTC(`${month}-01`);
      date.setUTCMonth(date.getUTCMonth() + direction);
      next = date.toISOString().slice(0, 10);
    } else
      next = addDays(currentReference, direction * (view === "week" ? 7 : 1));
    if (next.slice(0, 7) !== month) {
      if (!onMonthChange) return;
      onMonthChange(next.slice(0, 7));
    }
    setReference(next);
  };
  const updateFilter = <K extends keyof TeamFilters>(
    key: K,
    value: TeamFilters[K],
  ) => setFilters((current) => ({ ...current, [key]: value }));
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
          nenhuma folga ou aprovação é presumida.{" "}
          {onOpenDay
            ? "Clique em um dia salvo para editar."
            : "Abra o funcionário para editar."}{" "}
          Totais em horas computadas por data civil, com redução noturna
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
              value={currentReference}
              min={monthDays[0]}
              max={monthDays.at(-1)}
              onChange={(event) => {
                if (monthDays.includes(event.target.value))
                  setReference(event.target.value);
              }}
            />
          </label>
        )}
        <div
          className="actions"
          role="group"
          aria-label="Navegar no período da equipe"
        >
          <button
            type="button"
            className="button small"
            aria-label="Período anterior"
            onClick={() => navigatePeriod(-1)}
            disabled={
              !onMonthChange &&
              (view === "month" || currentReference === monthDays[0])
            }
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="button small"
            onClick={() => {
              const today = todayInBrazil();
              if (today.slice(0, 7) !== month) {
                if (!onMonthChange) {
                  setReference(monthDays[0]);
                  return;
                }
                onMonthChange(today.slice(0, 7));
              }
              setReference(today);
            }}
          >
            Hoje
          </button>
          <button
            type="button"
            className="button small"
            aria-label="Próximo período"
            onClick={() => navigatePeriod(1)}
            disabled={
              !onMonthChange &&
              (view === "month" || currentReference === monthDays.at(-1))
            }
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        {hasUnsavedPreview && (
          <p className="team-preview-note">
            Há alterações não salvas na prévia individual.{" "}
            <button type="button" onClick={onReturnToPreview}>
              Voltar à prévia
            </button>
          </p>
        )}
      </div>
      <div className="panel-body border-t border-[#dbe5f1]">
        <div className="filters">
          <label>
            Pesquisar equipe
            <input
              type="search"
              placeholder="Nome, matrícula ou setor"
              value={filters.query ?? ""}
              onChange={(event) => updateFilter("query", event.target.value)}
            />
          </label>
          <label>
            Setor da equipe
            <select
              value={filters.sector ?? ""}
              onChange={(event) => updateFilter("sector", event.target.value)}
            >
              <option value="">Todos os setores</option>
              {sectors.map((sector) => (
                <option key={sector} value={sector}>
                  {sector}
                </option>
              ))}
            </select>
          </label>
          <label>
            Estabelecimento da equipe
            <select
              value={filters.establishmentId ?? ""}
              onChange={(event) =>
                updateFilter("establishmentId", event.target.value)
              }
            >
              <option value="">Todos os estabelecimentos</option>
              <option value="__main">Localidade principal</option>
              {(data.establishments ?? [])
                .filter((entry) => !companyId || entry.empresa_id === companyId)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.nome}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Regime da equipe
            <select
              value={filters.regime ?? ""}
              onChange={(event) => updateFilter("regime", event.target.value)}
            >
              <option value="">Todos os regimes</option>
              {["5x2", "6x1", "12x36", "turnos", "personalizado"].map(
                (value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Situação do vínculo
            <select
              value={filters.status ?? "all"}
              onChange={(event) =>
                updateFilter(
                  "status",
                  event.target.value as TeamFilters["status"],
                )
              }
            >
              <option value="all">Todos os vínculos</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos / em consulta</option>
            </select>
          </label>
          <label>
            Pendência da escala
            <select
              value={filters.schedule ?? "all"}
              onChange={(event) =>
                updateFilter(
                  "schedule",
                  event.target.value as TeamFilters["schedule"],
                )
              }
            >
              <option value="all">Todas as escalas</option>
              <option value="missing">Sem escala / dias ausentes</option>
              <option value="violation">Com impedimentos</option>
              <option value="attention">Com avisos</option>
            </select>
          </label>
        </div>
        <div className="actions justify-between mt-3">
          <p className="muted" role="status">
            {rows.length} de {allRows.length} funcionário(s) neste contexto.
          </p>
          <button
            type="button"
            className="button small"
            onClick={() => setFilters({})}
          >
            Limpar filtros da equipe
          </button>
        </div>
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
                        {onOpenDay && day.state !== "missing" ? (
                          <button
                            type="button"
                            className="team-day-open w-full min-h-11 text-left"
                            onClick={() => onOpenDay(row.employee, day.date)}
                            aria-label={`Abrir dia ${day.date.split("-").reverse().join("/")} de ${row.employee.nome}: ${day.state === "rest" ? "Folga" : day.state === "invalid" ? "Revisar horários" : day.hours}${day.problem ? `, ${day.problem === "violation" ? "impedimento" : "atenção"}` : ""}`}
                          >
                            <DayContent day={day} />
                          </button>
                        ) : (
                          <DayContent day={day} />
                        )}
                      </td>
                    ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">
          {allRows.length
            ? "Nenhum funcionário corresponde aos filtros da equipe."
            : "Nenhum funcionário neste contexto."}
        </p>
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
