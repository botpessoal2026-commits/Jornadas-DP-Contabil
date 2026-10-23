import type { AuditLog } from "@/lib/store";
import type { Company } from "@/lib/types";

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
  return (
    <section className="panel" aria-label="Histórico de alterações">
      <div className="panel-head">
        <h2>Histórico de alterações</h2>
        <span className="pill">{logs.length} registro(s)</span>
      </div>
      <div className="panel-body company-history">
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
          logs.map((log) => (
            <article key={log.id}>
              <h3>
                {(
                  {
                    INSERT: "Inclusão",
                    UPDATE: "Alteração",
                    DELETE: "Exclusão",
                  } as Record<string, string>
                )[log.acao] ?? log.acao}{" "}
                · {log.tabela.replaceAll("_", " ")}
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
              <details>
                <summary>Ver campos e alterações</summary>
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
        {hasMore && onLoadMore && (
          <button className="button" disabled={loading} onClick={onLoadMore}>
            Carregar eventos anteriores
          </button>
        )}
      </div>
    </section>
  );
}
