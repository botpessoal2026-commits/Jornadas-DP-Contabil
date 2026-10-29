"use client";
import { useMemo, useState } from "react";
import type { AuditLog } from "@/lib/store";
import type { Company } from "@/lib/types";
import {
  auditChanges,
  auditLocalDate,
  auditTableLabels,
} from "@/lib/audit-presentation";

const normalized = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export default function AuditHistory({
  logs,
  companies,
  userId,
  demo = false,
  loading = false,
  hasMore = false,
  error,
  onLoadMore,
}: {
  logs: AuditLog[];
  companies: Company[];
  userId?: string;
  demo?: boolean;
  loading?: boolean;
  hasMore?: boolean;
  error?: string;
  onLoadMore?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [table, setTable] = useState("");
  const [actor, setActor] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const visible = useMemo(
    () =>
      logs.filter((log) => {
        const date = auditLocalDate(log.alterado_em);
        return (
          (!table || log.tabela === table) &&
          (!actor || log.ator_id === actor) &&
          (!start || date >= start) &&
          (!end || date <= end) &&
          (!query ||
            normalized(
              [log.tabela, ...auditChanges(log), log.registro_id ?? ""].join(
                " ",
              ),
            ).includes(normalized(query)))
        );
      }),
    [logs, table, actor, start, end, query],
  );
  return (
    <section className="panel" aria-label="Histórico de alterações">
      <div className="panel-head">
        <h2>Histórico de alterações</h2>
        <span className="pill">
          {visible.length} de {logs.length} registro(s) carregados
        </span>
      </div>
      <div className="panel-body company-history">
        <div className="filters">
          <label>
            Pesquisar alterações
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nome, campo ou dia alterado"
            />
          </label>
          <label>
            Tipo de registro
            <select
              value={table}
              onChange={(event) => setTable(event.target.value)}
            >
              <option value="">Todos os tipos</option>
              {Array.from(new Set(logs.map((log) => log.tabela)))
                .sort()
                .map((value) => (
                  <option key={value} value={value}>
                    {auditTableLabels[value] ?? value.replaceAll("_", " ")}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Responsável
            <select
              value={actor}
              onChange={(event) => setActor(event.target.value)}
            >
              <option value="">Todos os responsáveis</option>
              {Array.from(
                new Set(
                  logs
                    .map((log) => log.ator_id)
                    .filter((value): value is string => !!value),
                ),
              ).map((value) => (
                <option key={value} value={value}>
                  {value === userId
                    ? "Você"
                    : value === "demo-user" && demo
                      ? "Demonstração"
                      : value}
                </option>
              ))}
            </select>
          </label>
          <label>
            De
            <input
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label>
            Até
            <input
              type="date"
              value={end}
              min={start || undefined}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
        </div>
        <p className="muted">
          Os filtros abrangem os registros carregados.{" "}
          {hasMore
            ? "Carregue eventos anteriores para ampliar a pesquisa."
            : ""}
        </p>
        {(query || table || actor || start || end) && (
          <button
            className="button small"
            onClick={() => {
              setQuery("");
              setTable("");
              setActor("");
              setStart("");
              setEnd("");
            }}
          >
            Limpar filtros do histórico
          </button>
        )}
        {loading && <p role="status">Carregando histórico da empresa…</p>}
        {error && (
          <p role="alert">Não foi possível carregar o histórico: {error}</p>
        )}
        {!logs.length && !loading && !error ? (
          <p className="muted">
            Nenhuma alteração registrada neste contexto. Novas alterações de
            cadastros e jornadas aparecerão aqui. Eventos legados sem empresa
            identificada permanecem no histórico global.
          </p>
        ) : (
          visible.map((log) => (
            <article key={log.id}>
              <h3>
                {(
                  {
                    INSERT: "Inclusão",
                    UPDATE: "Alteração",
                    DELETE: "Exclusão",
                  } as Record<string, string>
                )[log.acao] ?? log.acao}{" "}
                ·{" "}
                {auditTableLabels[log.tabela] ??
                  log.tabela.replaceAll("_", " ")}
              </h3>
              <p className="history-metadata">
                {new Date(log.alterado_em).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })}{" "}
                ·{" "}
                {companies.find((company) => company.id === log.empresa_id)
                  ?.nome ?? "Registro global ou contexto legado"}
              </p>
              <p className="history-metadata">
                Responsável:{" "}
                {demo && log.ator_id === "demo-user"
                  ? "Ação local na demonstração"
                  : log.ator_id === userId && userId
                    ? "Você"
                    : (log.ator_id ?? "Não registrado no evento legado")}
              </p>
              <ul className="list-disc pl-5 my-3">
                {auditChanges(log)
                  .slice(0, 5)
                  .map((change, index) => (
                    <li key={index}>{change}</li>
                  ))}
              </ul>
              {auditChanges(log).length > 5 && (
                <details>
                  <summary>
                    Ver as {auditChanges(log).length} alterações
                  </summary>
                  <ul className="list-disc pl-5">
                    {auditChanges(log).map((change, index) => (
                      <li key={index}>{change}</li>
                    ))}
                  </ul>
                </details>
              )}
              <details>
                <summary>Ver campos e alterações</summary>
                <p className="muted">Detalhes técnicos do registro auditado.</p>
                <p>
                  Campos:{" "}
                  {log.campos?.join(", ") ||
                    "Não disponíveis neste registro legado"}
                </p>
                <div className="history-comparison">
                  <div>
                    <strong>Antes</strong>
                    <pre>
                      {log.antes
                        ? JSON.stringify(log.antes, null, 2)
                        : "Sem dados anteriores disponíveis"}
                    </pre>
                  </div>
                  <div>
                    <strong>Depois</strong>
                    <pre>
                      {log.depois
                        ? JSON.stringify(log.depois, null, 2)
                        : "Sem dados posteriores disponíveis"}
                    </pre>
                  </div>
                </div>
              </details>
            </article>
          ))
        )}
        {!!logs.length && !visible.length && !loading && (
          <p role="status">
            Nenhuma alteração corresponde aos filtros carregados.
          </p>
        )}
        {hasMore && onLoadMore && (
          <button className="button" disabled={loading} onClick={onLoadMore}>
            Carregar eventos anteriores
          </button>
        )}
      </div>
    </section>
  );
}
