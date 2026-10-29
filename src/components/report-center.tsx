"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Data } from "@/lib/store";
import type { Schedule } from "@/lib/types";
import { downloadReport, pdfDocument, reportFilename } from "@/lib/exports";
import {
  consolidatedCSV,
  consolidatedExcel,
  pdfZip,
  resolvedReportEntries,
  reportColumnNames,
  scheduleICS,
} from "@/lib/report-bundle";

const keyFor = (schedule: Schedule) =>
  `${schedule.empresa_id}/${schedule.funcionario_id}/${schedule.mes.slice(0, 7)}`;

export default function ReportCenter({
  data,
  month,
  companyId,
  schedule,
  preview = false,
  onError,
}: {
  data: Data;
  month: string;
  companyId?: string | null;
  schedule?: Schedule | null;
  preview?: boolean;
  onError?: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState<"escala" | "folha">("escala");
  const [compact, setCompact] = useState(true);
  const [columns, setColumns] = useState<string[]>(reportColumnNames);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [pdfName, setPdfName] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfContext, setPdfContext] = useState("");
  const mounted = useRef(false);
  const requestSequence = useRef(0);
  const pendingRequest = useRef<number | null>(null);
  const schedules = useMemo(() => {
    const items = new Map(
      data.schedules
        .filter(
          (item) =>
            item.mes.startsWith(month.slice(0, 7)) &&
            (!companyId || item.empresa_id === companyId),
        )
        .map((item) => [keyFor(item), item]),
    );
    if (
      schedule &&
      schedule.mes.startsWith(month.slice(0, 7)) &&
      (!companyId || schedule.empresa_id === companyId)
    )
      items.set(keyFor(schedule), schedule);
    return [...items.values()].filter(
      (item) =>
        data.companies.some((company) => company.id === item.empresa_id) &&
        data.employees.some(
          (employee) =>
            employee.id === item.funcionario_id &&
            employee.empresa_id === item.empresa_id,
        ),
    );
  }, [data, companyId, month, schedule]);
  const matching = schedules.filter((item) => {
    const person = data.employees.find(
      (employee) => employee.id === item.funcionario_id,
    );
    const company = data.companies.find(
      (entry) => entry.id === item.empresa_id,
    );
    const search =
      `${person?.nome ?? ""} ${person?.matricula ?? ""} ${person?.setor ?? ""} ${company?.nome ?? ""}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    return search.includes(
      query
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    );
  });
  const picked = schedules.filter((item) => selected.includes(keyFor(item)));
  const contextKey = JSON.stringify([
    companyId,
    month,
    schedule ? keyFor(schedule) : null,
  ]);
  // A document is a view of these inputs, not a cache of a previous revision.
  const sourceKey = useMemo(() => {
    const companyIds = new Set(schedules.map((item) => item.empresa_id));
    const employeeIds = new Set(schedules.map((item) => item.funcionario_id));
    return JSON.stringify({
      schedules,
      companies: data.companies.filter((item) => companyIds.has(item.id)),
      employees: data.employees.filter((item) => employeeIds.has(item.id)),
      rules: data.rules.filter(
        (item) => !item.empresa_id || companyIds.has(item.empresa_id),
      ),
      versions: (data.scheduleVersions ?? []).filter((version) =>
        schedules.some(
          (item) =>
            item.id === version.escala_id &&
            item.empresa_id === version.empresa_id,
        ),
      ),
      preview,
    });
  }, [
    schedules,
    data.companies,
    data.employees,
    data.rules,
    data.scheduleVersions,
    preview,
  ]);
  const operationKey = JSON.stringify([
    contextKey,
    sourceKey,
    selected,
    query,
    kind,
    compact,
    columns,
  ]);
  const currentContext = useRef(operationKey);
  currentContext.current = operationKey;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
      pendingRequest.current = null;
    };
  }, []);
  useEffect(() => {
    if (!pdf) return;
    const url = URL.createObjectURL(pdf);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdf]);
  // Invalidate pending work before it can publish/download another context.
  useEffect(() => {
    requestSequence.current += 1;
    pendingRequest.current = null;
    setBusy(false);
    setPdf(null);
    setPdfUrl("");
    setPdfContext("");
    setMessage("");
    setError("");
  }, [operationKey]);
  useEffect(() => {
    setSelected([]);
  }, [contextKey]);
  const perform = async (
    action: (isCurrent: () => boolean) => Promise<void> | void,
  ) => {
    if (pendingRequest.current !== null) return;
    const request = ++requestSequence.current;
    const expected = operationKey;
    pendingRequest.current = request;
    const isCurrent = () =>
      mounted.current &&
      requestSequence.current === request &&
      currentContext.current === expected;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action(isCurrent);
    } catch (failure) {
      if (!isCurrent()) return;
      const reason =
        failure instanceof Error
          ? failure.message
          : "Não foi possível gerar o relatório.";
      setError(reason);
      onError?.(reason);
    } finally {
      if (pendingRequest.current === request) pendingRequest.current = null;
      if (isCurrent()) setBusy(false);
    }
  };
  const batchName = (type: string, extension: string) =>
    `cont-contabil-${type}-${
      companyId
        ? (
            data.companies.find((entry) => entry.id === companyId)?.nome ??
            "empresa"
          )
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 60)
        : "consolidado"
    }-${month.slice(0, 7)}.${extension}`;
  const showPreview = async (isCurrent: () => boolean) => {
    const target = picked[0] ?? schedule ?? matching[0];
    if (!target) throw new Error("Selecione uma escala para visualizar.");
    const [entry] = await resolvedReportEntries(data, [target]);
    if (!isCurrent()) return;
    const documentSchedule = entry.schedule;
    const isPreview =
      preview &&
      !!schedule &&
      keyFor(target) === keyFor(schedule) &&
      !["publicada", "fechada"].includes(documentSchedule.status ?? "");
    const document =
      kind === "folha"
        ? await (
            await import("@/lib/timesheet-pdf")
          ).timesheetDocument(documentSchedule, entry.company, entry.employee, {
            preview: isPreview,
          })
        : await pdfDocument(
            documentSchedule,
            entry.rules,
            entry.company,
            entry.employee,
            { compact, preview: isPreview },
          );
    if (!isCurrent()) return;
    setPdfName(
      reportFilename(
        kind === "folha"
          ? "folha-de-ponto"
          : compact
            ? "escala-compacta"
            : "escala",
        documentSchedule,
        "pdf",
        entry.company,
        entry.employee,
      ),
    );
    setPdf(document.output("blob"));
    setPdfContext(operationKey);
    setMessage(
      `Pré-visualização: ${entry.employee.nome} · ${target.mes.slice(0, 7)} · ${document.getNumberOfPages()} página(s).${isPreview ? " Base: prévia não salva." : ["publicada", "fechada"].includes(target.status ?? "") ? ` Base: versão publicada, revisão ${documentSchedule.revisao ?? "—"}.` : ""}`,
    );
  };
  return (
    <section className="panel mt-5" aria-label="Central de relatórios">
      <div className="panel-head">
        <h2>Central de relatórios</h2>
        <span className="pill">
          {month.slice(5, 7)}/{month.slice(0, 4)}
        </span>
      </div>
      <div className="panel-body">
        <p className="muted">
          Confira o PDF antes de baixar ou selecione pessoas para exportar em
          lote. Os documentos representam o planejamento; as marcações reais
          continuam em branco. Escalas publicadas ou fechadas são emitidas a
          partir da versão publicada, com os dados congelados naquela
          publicação.
        </p>
        <div className="filters mt-4">
          <label>
            Pesquisar pessoas ou empresas
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nome, matrícula, setor ou empresa"
            />
          </label>
          <label>
            Documento
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as "escala" | "folha");
                setPdf(null);
                setPdfUrl("");
              }}
            >
              <option value="escala">PDF da escala</option>
              <option value="folha">Folha de ponto individual</option>
            </select>
          </label>
          {kind === "escala" && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={compact}
                onChange={(event) => {
                  setCompact(event.target.checked);
                  setPdf(null);
                  setPdfUrl("");
                }}
              />
              Escala compacta para compartilhar
            </label>
          )}
        </div>
        <p className="muted mt-3">
          {kind === "folha"
            ? "Folha A4 com assinatura e campos para preenchimento manual."
            : compact
              ? "Horários, eventos e resumo. A conferência completa permanece disponível desmarcando esta opção."
              : "Documento completo com parâmetros, alertas e conferência."}
        </p>
        <details className="mt-3">
          <summary>Configurar colunas do CSV e Excel</summary>
          <p className="muted">
            Data, empresa, funcionário e horário identificam a programação e
            permanecem no arquivo.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
            {reportColumnNames.map((column) => {
              const required = [
                "Data",
                "Empresa",
                "Funcionário",
                "Horário",
              ].includes(column);
              return (
                <label className="check-label" key={column}>
                  <input
                    type="checkbox"
                    checked={required || columns.includes(column)}
                    disabled={required || busy}
                    onChange={(event) =>
                      setColumns((current) =>
                        event.target.checked
                          ? [...current, column]
                          : current.filter((name) => name !== column),
                      )
                    }
                  />
                  {column}
                </label>
              );
            })}
          </div>
          <button
            className="button small mt-3"
            onClick={() => setColumns(reportColumnNames)}
            disabled={busy}
          >
            Restaurar todas as colunas
          </button>
        </details>
        <div className="actions mt-3">
          <button
            className="button"
            disabled={busy || !matching.length}
            onClick={() =>
              setSelected(
                Array.from(
                  new Set([...selected, ...matching.slice(0, 200).map(keyFor)]),
                ).slice(0, 200),
              )
            }
          >
            Selecionar resultados
          </button>
          <button
            className="button"
            disabled={busy || !picked.length}
            onClick={() => setSelected([])}
          >
            Limpar seleção
          </button>
          <span role="status">
            {picked.length} selecionado(s) · {matching.length} resultado(s) ·
            até 200 por lote
          </span>
        </div>
        <fieldset
          className="mt-4 rounded-lg border border-slate-200 p-3"
          style={{ maxHeight: 240, overflowY: "auto" }}
        >
          <legend>Escalas disponíveis para o lote</legend>
          {matching.map((item) => {
            const key = keyFor(item),
              person = data.employees.find(
                (employee) => employee.id === item.funcionario_id,
              ),
              company = data.companies.find(
                (entry) => entry.id === item.empresa_id,
              );
            return (
              <label key={key} className="check-label py-2">
                <input
                  type="checkbox"
                  checked={selected.includes(key)}
                  disabled={
                    busy || (!selected.includes(key) && picked.length >= 200)
                  }
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, key]
                        : current.filter((value) => value !== key),
                    )
                  }
                />
                {person?.nome} · {company?.nome}
                {preview && schedule && key === keyFor(schedule)
                  ? " · prévia não salva"
                  : ""}
              </label>
            );
          })}
          {!matching.length && (
            <p>Nenhuma escala disponível para os filtros.</p>
          )}
        </fieldset>
        <div className="actions mt-4">
          <button
            className="button primary"
            disabled={busy || !schedules.length}
            onClick={() => perform(showPreview)}
          >
            {busy ? "Gerando…" : "Pré-visualizar PDF"}
          </button>
          <button
            className="button"
            disabled={
              busy ||
              !picked.length ||
              (preview &&
                !!schedule &&
                picked.some((item) => keyFor(item) === keyFor(schedule)))
            }
            onClick={() =>
              perform(async (isCurrent) => {
                const entries = await resolvedReportEntries(data, picked);
                const bytes = await pdfZip(entries, kind, compact);
                if (!isCurrent()) return;
                downloadReport(
                  new Blob([new Uint8Array(bytes)], {
                    type: "application/zip",
                  }),
                  batchName(kind === "folha" ? "folhas" : "escalas", "zip"),
                );
                setMessage(
                  `${entries.length} PDF(s) gerado(s) no ZIP. Nenhuma marcação de ponto foi preenchida.`,
                );
              })
            }
          >
            Baixar PDFs selecionados (ZIP)
          </button>
          <button
            className="button"
            disabled={busy || !picked.length}
            onClick={() =>
              perform(async (isCurrent) => {
                const entries = await resolvedReportEntries(data, picked);
                if (!isCurrent()) return;
                downloadReport(
                  new Blob([consolidatedCSV(entries, columns)], {
                    type: "text/csv;charset=utf-8",
                  }),
                  batchName("escalas-consolidadas", "csv"),
                );
                setMessage(`${entries.length} escala(s) no CSV consolidado.`);
              })
            }
          >
            CSV consolidado
          </button>
          <button
            className="button"
            disabled={busy || !picked.length}
            onClick={() =>
              perform(async (isCurrent) => {
                const entries = await resolvedReportEntries(data, picked);
                const bytes = await consolidatedExcel(entries, columns);
                if (!isCurrent()) return;
                downloadReport(
                  new Blob([new Uint8Array(bytes)], {
                    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  }),
                  batchName("escalas-consolidadas", "xlsx"),
                );
                setMessage(`${entries.length} escala(s) no Excel consolidado.`);
              })
            }
          >
            Excel consolidado
          </button>
          <button
            className="button"
            disabled={busy || !picked.length}
            onClick={() =>
              perform(async (isCurrent) => {
                const entries = await resolvedReportEntries(data, picked);
                if (!isCurrent()) return;
                downloadReport(
                  new Blob([scheduleICS(entries)], {
                    type: "text/calendar;charset=utf-8",
                  }),
                  batchName("calendario", "ics"),
                );
                setMessage(
                  "Calendário gerado em horários locais. Confira o fuso da agenda ao importar; não contém marcações reais.",
                );
              })
            }
          >
            Calendário (.ics)
          </button>
        </div>
        {preview && schedule && (
          <p className="muted mt-3">
            Salve a prévia antes de incluí-la no ZIP de documentos. CSV/Excel e
            pré-visualização podem refletir a edição atual.
          </p>
        )}
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
        {pdf && pdfUrl && pdfContext === operationKey && (
          <div className="mt-4">
            <div className="actions">
              <button
                className="button primary"
                onClick={() => {
                  if (pdfContext === currentContext.current)
                    downloadReport(pdf, pdfName);
                }}
              >
                Baixar PDF visualizado
              </button>
              <a
                className="button"
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir PDF em nova aba
              </a>
              <button
                className="button"
                onClick={() => {
                  setPdf(null);
                  setPdfUrl("");
                }}
              >
                Fechar pré-visualização
              </button>
            </div>
            <iframe
              title={`Pré-visualização de ${pdfName}`}
              src={pdfUrl}
              className="mt-3 w-full rounded-lg border border-slate-200"
              style={{ height: "70vh", minHeight: 300 }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
