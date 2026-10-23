"use client";
import { useMemo, useState } from "react";
import { ArrowRight, Building2, Plus, Search } from "lucide-react";
import type { Data } from "@/lib/store";
import type { Company } from "@/lib/types";
import {
  companyDisplayName,
  companySituation,
  companySummary,
  formatCompanyCnpj,
  matchesCompanySearch,
} from "@/lib/company-context";

export default function CompanyDirectory({
  data,
  month,
  onCreate,
  onOpen,
  onEdit,
}: {
  data: Data;
  month: string;
  onCreate: () => void;
  onOpen: (company: Company) => void;
  onEdit?: (company: Company) => void;
}) {
  const [query, setQuery] = useState("");
  const [situation, setSituation] = useState("todas");
  const [order, setOrder] = useState("nome");
  const companies = useMemo(() => {
    return data.companies
      .filter((company) => {
        if (situation !== "todas" && companySituation(company) !== situation)
          return false;
        return matchesCompanySearch(company, query);
      })
      .sort((a, b) =>
        order === "situacao"
          ? companySituation(a).localeCompare(companySituation(b), "pt-BR") ||
            companyDisplayName(a).localeCompare(companyDisplayName(b), "pt-BR")
          : order === "cidade"
            ? a.cidade.localeCompare(b.cidade, "pt-BR") ||
              companyDisplayName(a).localeCompare(
                companyDisplayName(b),
                "pt-BR",
              )
            : companyDisplayName(a).localeCompare(
                companyDisplayName(b),
                "pt-BR",
              ),
      );
  }, [data.companies, query, situation, order]);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">GESTÃO MULTIEMPRESA</div>
          <h1>Empresas</h1>
          <p className="subtitle">
            Escolha uma empresa para administrar seus funcionários, jornadas,
            escalas e configurações.
          </p>
        </div>
        <button className="button primary" onClick={onCreate}>
          <Plus size={16} />
          Cadastrar nova empresa
        </button>
      </div>
      <section className="panel" aria-label="Pesquisar empresas">
        <div className="panel-body company-search">
          <label>
            <span>
              <Search size={15} aria-hidden="true" />
              Buscar empresa
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nome, CNPJ, código ou situação"
            />
          </label>
          <label>
            Situação cadastral
            <select
              value={situation}
              onChange={(event) => setSituation(event.target.value)}
            >
              <option value="todas">Todas as situações</option>
              <option value="ativa">Ativa</option>
              <option value="inativa">Inativa</option>
              <option value="arquivada">Arquivada</option>
            </select>
          </label>
          <label>
            Ordenar empresas
            <select
              value={order}
              onChange={(event) => setOrder(event.target.value)}
            >
              <option value="nome">Nome</option>
              <option value="cidade">Município</option>
              <option value="situacao">Situação</option>
            </select>
          </label>
        </div>
      </section>
      <p className="company-result-count" role="status">
        {companies.length}{" "}
        {companies.length === 1 ? "empresa encontrada" : "empresas encontradas"}{" "}
        · competência {month.slice(5, 7)}/{month.slice(0, 4)}
      </p>
      <div className="company-directory">
        {companies.map((company) => {
          const summary = companySummary(data, company, month);
          return (
            <article
              className="panel company-card"
              key={company.id}
              data-company-id={company.id}
            >
              <div className="panel-head">
                <div>
                  <h2>{companyDisplayName(company)}</h2>
                  {company.nome_fantasia && (
                    <p className="subtitle">{company.nome}</p>
                  )}
                </div>
                <span
                  className={`pill ${companySituation(company) === "ativa" ? "" : "warn"}`}
                >
                  {companySituation(company)}
                </span>
              </div>
              <div className="panel-body">
                <p className="company-identity">
                  <Building2 size={16} aria-hidden="true" />
                  {formatCompanyCnpj(company.cnpj)}
                </p>
                <p className="subtitle">
                  {[company.cidade, company.uf].filter(Boolean).join(" / ") ||
                    "Localização pendente de cadastro"}
                </p>
                <dl className="company-card-metrics">
                  <div>
                    <dt>Funcionários ativos</dt>
                    <dd>{summary.employees}</dd>
                  </div>
                  <div>
                    <dt>Escalas salvas no mês</dt>
                    <dd>{summary.savedSchedules}</dd>
                  </div>
                  <div>
                    <dt>Sem escala no mês</dt>
                    <dd>{summary.missingSchedules}</dd>
                  </div>
                  <div>
                    <dt>Violações identificadas</dt>
                    <dd>{summary.violations}</dd>
                  </div>
                </dl>
                <p className="company-pending-note">
                  {summary.attention} avisos · {summary.pendingSources}{" "}
                  pendências de fontes/regras
                </p>
                {summary.unreadableSchedules > 0 && (
                  <p className="warning-text">
                    {summary.unreadableSchedules} escala(s) com dados que
                    precisam de correção antes de calcular os indicadores.
                  </p>
                )}
                <div className="actions company-card-actions">
                  <button
                    className="button primary"
                    onClick={() => onOpen(company)}
                  >
                    Acessar empresa
                    <ArrowRight size={15} />
                  </button>
                  {onEdit && (
                    <button className="button" onClick={() => onEdit(company)}>
                      Editar cadastro
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!companies.length && (
        <section className="panel">
          <div className="empty">
            <Building2 size={30} />
            <p>
              {data.companies.length
                ? "Nenhuma empresa corresponde à pesquisa. Ajuste os filtros para encontrar o cadastro."
                : "Cadastre a primeira empresa. Você poderá completar os demais dados depois."}
            </p>
            {!data.companies.length && (
              <button className="button primary" onClick={onCreate}>
                Cadastrar nova empresa
              </button>
            )}
          </div>
        </section>
      )}
      <p className="company-method-note">
        Contagens calculadas a partir dos cadastros e escalas disponíveis.
        Aprovação e publicação ainda não possuem fluxo persistido; nenhuma
        escala é apresentada como aprovada automaticamente.
      </p>
    </>
  );
}
