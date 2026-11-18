"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Data } from "@/lib/store";
import { downloadReport } from "@/lib/exports";
import {
  buildWorkRestReport,
  workRestCandidates,
  workRestCSV,
  workRestDate,
  workRestExcel,
  workRestPDF,
  workRestReportNote,
  workRestTotals,
  type WorkRestRow,
} from "@/lib/work-rest-report";

export default function WorkRestReport({
  data,
  month,
  companyId = null,
  employeeIds,
}: {
  data: Data;
  month: string;
  companyId?: string | null;
  employeeIds?: string[];
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [result, setResult] = useState<{
    key: string;
    rows: WorkRestRow[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const candidates = workRestCandidates(data, companyId, employeeIds);
  const selectedId = candidates.some(
    ({ employee }) => employee.id === employeeId,
  )
    ? employeeId
    : "";
  const selected = selectedId
    ? [selectedId]
    : candidates.map(({ employee }) => employee.id);
  const source = useMemo(
    () =>
      JSON.stringify({
        schedules: data.schedules,
        companies: data.companies,
        employees: data.employees,
        rules: data.rules,
        holidays: data.holidays,
        specialDates: data.specialDates,
        establishments: data.establishments,
        versions: data.scheduleVersions,
      }),
    [data],
  );
  const key = JSON.stringify([source, month, companyId, selected]);
  const current = useRef(key);
  current.current = key;
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  useEffect(() => {
    request.current += 1;
    setBusy(false);
    setError("");
    setMessage("");
  }, [key]);
  const rows = result?.key === key ? result.rows : [];

  async function perform(format: "generate" | "pdf" | "xlsx" | "csv") {
    if (busy) return;
    const expected = key,
      sequence = ++request.current;
    const valid = () =>
      request.current === sequence && current.current === expected;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const report =
        format === "generate"
          ? await buildWorkRestReport(data, month, companyId, selected)
          : rows;
      if (!report.length)
        throw new Error("Gere o relatório antes de exportar.");
      let blob: Blob | null = null;
      if (format === "pdf") blob = await workRestPDF(report);
      if (format === "xlsx")
        blob = new Blob([new Uint8Array(await workRestExcel(report))], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
      if (format === "csv")
        blob = new Blob([workRestCSV(report)], {
          type: "text/csv;charset=utf-8",
        });
      if (!valid()) return;
      if (blob) downloadReport(blob, `dias-e-folgas-${month}.${format}`);
      else setResult({ key: expected, rows: report });
      setMessage(
        blob
          ? "Relatório exportado com os mesmos dados exibidos abaixo."
          : `${report.length} funcionário(s) no relatório da competência ${month}.`,
      );
    } catch (cause) {
      if (valid())
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível gerar o relatório.",
        );
    } finally {
      if (valid()) setBusy(false);
    }
  }
  return (
    <section
      className="work-rest-report"
      aria-label="Relatório de dias trabalhados e folgas"
    >
      <p className="muted">{workRestReportNote}</p>
      <div className="filters mt-3">
        <label>
          Funcionário do relatório de dias e folgas
          <select
            value={selectedId}
            disabled={busy}
            onChange={(event) => setEmployeeId(event.target.value)}
          >
            <option value="">Todos os funcionários deste filtro</option>
            {candidates.map(({ employee, company }) => (
              <option key={employee.id} value={employee.id}>
                {employee.nome} · {company.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="actions mt-3">
        <button
          className="button primary"
          disabled={busy || !selected.length || selected.length > 200}
          onClick={() => void perform("generate")}
        >
          {busy ? "Processando relatório…" : "Gerar relatório de dias e folgas"}
        </button>
        {(
          [
            ["pdf", "PDF de dias e folgas"],
            ["xlsx", "Excel de dias e folgas"],
            ["csv", "CSV de dias e folgas"],
          ] as const
        ).map(([format, label]) => (
          <button
            key={format}
            className="button"
            disabled={busy || !rows.length}
            onClick={() => void perform(format)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted mt-3">
        Competência: {month} · {selected.length} funcionário(s) · até 200 por
        relatório. Os filtros da equipe são respeitados; o relatório sempre
        abrange o mês inteiro.
      </p>
      {error && (
        <p className="warning-text mt-3" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="muted mt-3" role="status">
          {message}
        </p>
      )}
      <div className="work-rest-cards mt-4">
        {rows.map((row) => {
          const totals = workRestTotals(row);
          const list = (dates: string[]) =>
            dates.length ? dates.map(workRestDate).join(", ") : "Nenhuma";
          return (
            <article
              className="work-rest-card"
              key={`${row.companyId}:${row.employeeId}`}
            >
              <h3>{row.employee}</h3>
              <p className="muted">
                {row.company} · {row.month} · {row.status} · Revisão:{" "}
                {row.revision}
              </p>
              <p className="mt-2">
                <strong>
                  {totals.work.length} dias com trabalho · {totals.rest.length}{" "}
                  folgas · {totals.starts} inícios de plantão
                </strong>
              </p>
              <p className="muted">
                {totals.other.length} outros sem expediente ·{" "}
                {totals.missing.length} sem escala · {totals.invalid.length} a
                conferir · Horas de relógio: {totals.hours}
              </p>
              <dl className="work-rest-dates mt-3">
                <dt>Dias com trabalho</dt>
                <dd>{list(totals.work)}</dd>
                <dt>Folgas programadas</dt>
                <dd>{list(totals.rest)}</dd>
                {!!totals.other.length && (
                  <>
                    <dt>Outros dias sem expediente</dt>
                    <dd>{list(totals.other)}</dd>
                  </>
                )}
                {!!totals.missing.length && (
                  <>
                    <dt>Dias sem escala</dt>
                    <dd>{list(totals.missing)}</dd>
                  </>
                )}
                {!!totals.invalid.length && (
                  <>
                    <dt>Dias a conferir</dt>
                    <dd>{list(totals.invalid)}</dd>
                  </>
                )}
              </dl>
              <details className="mt-3">
                <summary>Ver dias e horários de {row.employee}</summary>
                <div className="table-wrap mt-3">
                  <table>
                    <caption className="sr-only">
                      Dias e horários de {row.employee} em {row.month}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Data</th>
                        <th scope="col">Tipo do dia</th>
                        <th scope="col">Horário</th>
                        <th scope="col">Evento / observação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.days.map((day) => (
                        <tr key={day.date}>
                          <th scope="row">{workRestDate(day.date)}</th>
                          <td>{day.label}</td>
                          <td>{day.shift || "—"}</td>
                          <td>{day.description || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}
