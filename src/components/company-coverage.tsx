"use client";
import { useEffect, useRef, useState } from "react";
import type { Data } from "@/lib/store";
import type { Schedule } from "@/lib/types";
import {
  coverageClock,
  resolveCompanyCoverage,
  type CompanyCoverageReport,
} from "@/lib/company-coverage";
import { businessHoursLabel } from "@/lib/business-hours";
import { workRestDate } from "@/lib/work-rest-report";

export default function CompanyCoverage({
  data,
  companyId,
  month,
  schedules,
  defaultOpen = false,
}: {
  data: Data;
  companyId: string | null;
  month: string;
  schedules?: Schedule[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen),
    [report, setReport] = useState<{
      key: string;
      value: CompanyCoverageReport;
    } | null>(null),
    [error, setError] = useState<{ key: string; text: string } | null>(null);
  const company = data.companies.find((item) => item.id === companyId);
  const key = JSON.stringify([
    companyId,
    month,
    company,
    data.schedules,
    data.employees,
    data.specialDates,
    data.holidays,
    data.establishments,
    data.scheduleVersions,
    schedules,
  ]);
  const sequence = useRef(0);
  const current = useRef(key);
  current.current = key;
  useEffect(() => {
    const request = ++sequence.current;
    if (!open || !companyId || !company?.horario_funcionamento) return;
    resolveCompanyCoverage(data, companyId, month, schedules)
      .then((value) => {
        if (sequence.current === request && current.current === key)
          setReport({ key, value });
      })
      .catch((cause: unknown) => {
        if (sequence.current === request && current.current === key)
          setError({
            key,
            text:
              cause instanceof Error
                ? cause.message
                : "Não foi possível conferir a cobertura.",
          });
      });
    return () => {
      sequence.current += 1;
    };
  }, [
    key,
    open,
    companyId,
    company?.horario_funcionamento,
    data,
    month,
    schedules,
  ]);
  const result = report?.key === key ? report.value : null;
  const range = (start: number, end: number) =>
    `${coverageClock(start)}–${coverageClock(end)}`;
  const labels = {
    fechado: "Fechado",
    coberto: "Cobertura mínima atendida",
    descoberto: "Cobertura abaixo da meta",
    incompleto: "Conferência incompleta",
  };
  return (
    <details
      className="company-coverage mt-4"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      aria-label="Cobertura do horário de funcionamento"
    >
      <summary className="font-semibold">
        Cobertura do horário de funcionamento
      </summary>
      {open && (
        <div className="mt-3">
          {!company ? (
            <p className="muted">
              Selecione uma empresa ativa para conferir o funcionamento.
            </p>
          ) : !company.horario_funcionamento ? (
            <p className="muted">
              Cadastre o horário de funcionamento nas configurações da empresa
              para conferir períodos sem cobertura e o revezamento.
            </p>
          ) : (
            <>
              <p className="muted">
                {businessHoursLabel(company.horario_funcionamento)}
              </p>
              <p className="muted mt-2">
                Meta: {company.horario_funcionamento.minimo_funcionarios}{" "}
                funcionário(s) durante o funcionamento. A análise considera
                pausas, folgas, feriados e continuação noturna; inclui as
                escalas salvas dos demais funcionários da empresa. Registros
                ausentes ou inválidos deixam a conferência incompleta. Esta é
                uma análise operacional da programação, separada da conferência
                trabalhista e de CCT.
              </p>
              {error?.key === key && (
                <p role="alert" className="warning-text mt-3">
                  {error.text}
                </p>
              )}
              {!result && error?.key !== key && (
                <p role="status" className="muted mt-3">
                  Conferindo cobertura…
                </p>
              )}
              {result && (
                <>
                  <p role="status" className="mt-3">
                    <strong>
                      {result.days.filter((day) => day.gaps.length).length}{" "}
                      dia(s) com cobertura abaixo da meta ·{" "}
                      {result.days.filter((day) => day.outside.length).length}{" "}
                      com trabalho fora do funcionamento ·{" "}
                      {
                        result.days.filter((day) => day.status === "incompleto")
                          .length
                      }{" "}
                      com conferência incompleta
                    </strong>
                  </p>
                  <div className="coverage-days mt-3">
                    {result.days.map((day) => (
                      <details className="work-rest-card" key={day.date}>
                        <summary>
                          {workRestDate(day.date)} · {labels[day.status]}
                          {day.outside.length
                            ? " · trabalho fora do funcionamento"
                            : ""}
                        </summary>
                        <p className="muted mt-2">
                          Funcionamento:{" "}
                          {day.opening
                            .map(([a, b]) => range(a, b))
                            .join(" / ") || "Fechado"}
                        </p>
                        {day.issues.map((issue) => (
                          <p className="warning-text" key={issue}>
                            {issue}
                          </p>
                        ))}
                        {!!day.missing.length && (
                          <p className="warning-text">
                            Sem registro do dia: {day.missing.join(", ")}
                          </p>
                        )}
                        <ul className="mt-2">
                          {day.periods.map((period, index) => (
                            <li
                              key={index}
                              className={
                                period.actual < period.required
                                  ? "warning-text"
                                  : "muted"
                              }
                            >
                              {range(period.start, period.end)} ·{" "}
                              {period.actual}/{period.required} funcionário(s) ·{" "}
                              {period.employees.join(", ") ||
                                "Nenhum funcionário programado"}
                            </li>
                          ))}
                        </ul>
                        {!!day.outside.length && (
                          <>
                            <h4 className="mt-3">
                              Trabalho fora do horário de funcionamento
                            </h4>
                            <ul>
                              {day.outside.map((item, index) => (
                                <li className="warning-text" key={index}>
                                  {item.employee}: {range(item.start, item.end)}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </details>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </details>
  );
}
