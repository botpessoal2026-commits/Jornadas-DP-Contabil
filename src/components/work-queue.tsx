"use client";
import { useMemo, useState } from "react";
import { ArrowUpRight, ClipboardList } from "lucide-react";
import type { Data } from "@/lib/store";
import type { Company, Employee } from "@/lib/types";
import {
  buildWorkQueue,
  filterWorkQueue,
  workQueueLabels,
  type WorkQueueKind,
} from "@/lib/work-queue";

export default function WorkQueue({
  data,
  month,
  onOpenEmployee,
  onOpenSchedule,
  onOpenRules,
}: {
  data: Data;
  month: string;
  onOpenEmployee: (employee: Employee) => void;
  onOpenSchedule: (employee: Employee) => void;
  onOpenRules: (company: Company) => void;
}) {
  const [query, setQuery] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(0);
  const items = useMemo(() => buildWorkQueue(data, month), [data, month]);
  const filtered = useMemo(
    () => filterWorkQueue(items, { query, companyId, kind }),
    [items, query, companyId, kind],
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / 20) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(currentPage * 20, (currentPage + 1) * 20);
  const companies = data.companies.filter(
    (company) => (company.situacao ?? "ativa") === "ativa",
  );
  return (
    <section className="panel" aria-label="Fila de trabalho do escritório">
      <div className="panel-head">
        <h2 className="flex items-center gap-2">
          <ClipboardList size={18} aria-hidden="true" />
          Fila de trabalho
        </h2>
        <span className="pill">
          {month.slice(5, 7)}/{month.slice(0, 4)}
        </span>
      </div>
      <div className="panel-body">
        <p className="muted">
          Pendências de empresas e vínculos ativos nesta competência. Cada ação
          abre o cadastro, a escala ou os parâmetros correspondentes.
        </p>
        <div className="filters mt-4">
          <label>
            Pesquisar pendências
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="Funcionário, empresa, matrícula ou setor"
            />
          </label>
          <label>
            Empresa da pendência
            <select
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
                setPage(0);
              }}
            >
              <option value="">Todas as empresas deste contexto</option>
              {companies.map((company) => (
                <option value={company.id} key={company.id}>
                  {company.nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo da pendência
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value);
                setPage(0);
              }}
            >
              <option value="">Todos os tipos</option>
              {(Object.keys(workQueueLabels) as WorkQueueKind[]).map(
                (value) => (
                  <option key={value} value={value}>
                    {workQueueLabels[value]}
                  </option>
                ),
              )}
            </select>
          </label>
          <button
            className="button self-end"
            type="button"
            onClick={() => {
              setQuery("");
              setCompanyId("");
              setKind("");
              setPage(0);
            }}
          >
            Limpar filtros da fila
          </button>
        </div>
        <p className="muted mt-4" role="status">
          {filtered.length} pendência(s) ·{" "}
          {new Set(filtered.map((item) => item.employee.id)).size}{" "}
          funcionário(s). Quantidades representam assuntos a conferir, não
          aprovação jurídica.
        </p>
        {!filtered.length ? (
          <p className="empty">
            {items.length
              ? "Nenhuma pendência corresponde aos filtros."
              : "Nenhuma pendência encontrada nos dados carregados desta competência."}
          </p>
        ) : (
          <ul className="space-y-3 mt-4">
            {visible.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-slate-200 p-4"
                data-queue-kind={item.kind}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span
                      className={`pill ${item.kind === "impedimento" || item.kind === "conferencia" ? "warn" : ""}`}
                    >
                      {item.title}
                    </span>
                    <h3 className="font-semibold mt-2">{item.employee.nome}</h3>
                    <p className="muted">
                      {item.company.nome}
                      {item.employee.setor ? ` · ${item.employee.setor}` : ""}
                      {item.employee.matricula
                        ? ` · Matrícula ${item.employee.matricula}`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button small"
                    onClick={() =>
                      item.action === "employee"
                        ? onOpenEmployee(item.employee)
                        : item.action === "rules"
                          ? onOpenRules(item.company)
                          : onOpenSchedule(item.employee)
                    }
                    aria-label={`${item.action === "employee" ? "Revisar cadastro" : item.action === "rules" ? "Conferir parâmetros" : "Abrir escala"} de ${item.employee.nome} · ${item.company.nome}`}
                  >
                    {item.action === "employee"
                      ? "Revisar cadastro"
                      : item.action === "rules"
                        ? "Conferir parâmetros"
                        : "Abrir escala"}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                </div>
                <p className="mt-3 text-sm">{item.description}</p>
              </li>
            ))}
          </ul>
        )}
        {lastPage > 0 && (
          <div className="actions mt-4">
            <button
              className="button"
              type="button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Pendências anteriores
            </button>
            <span className="muted">
              Página {currentPage + 1} de {lastPage + 1}
            </span>
            <button
              className="button"
              type="button"
              disabled={currentPage === lastPage}
              onClick={() => setPage(currentPage + 1)}
            >
              Próximas pendências
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
