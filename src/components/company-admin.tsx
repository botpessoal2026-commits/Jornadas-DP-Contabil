"use client";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Clock3,
  Flag,
  History,
  Settings,
  Users,
} from "lucide-react";
import type { Data } from "@/lib/store";
import type { Company } from "@/lib/types";
import {
  companyDisplayName,
  companySituation,
  companySummary,
  formatCompanyCnpj,
  type CompanySituation,
  type CompanyView,
} from "@/lib/company-context";
import { formatMinutes } from "@/lib/engine";

export type { CompanyView } from "@/lib/company-context";

const views: { id: CompanyView; label: string; icon: typeof Users }[] = [
  { id: "visao_geral", label: "Visão geral", icon: Building2 },
  { id: "funcionarios", label: "Funcionários", icon: Users },
  { id: "modelos", label: "Jornadas e modelos", icon: Clock3 },
  { id: "escalas", label: "Escalas", icon: CalendarDays },
  { id: "feriados", label: "Feriados", icon: Flag },
  { id: "configuracoes", label: "Configurações", icon: Settings },
  { id: "historico", label: "Histórico", icon: History },
];
function dateLabel(value?: string | null) {
  return value && Number.isFinite(+new Date(value))
    ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "Não disponível no cadastro legado";
}
export default function CompanyAdmin({
  company,
  data,
  month,
  view,
  onNavigate,
  onBack,
  onEditCompany,
  onStatusChange,
  onSwitchCompany,
  busy = false,
}: {
  company: Company;
  data: Data;
  month: string;
  view: CompanyView;
  onNavigate: (view: CompanyView) => void;
  onBack: () => void;
  onEditCompany: () => void;
  onStatusChange?: (situation: CompanySituation) => void;
  onSwitchCompany?: (company: Company) => void;
  busy?: boolean;
}) {
  const summary = companySummary(data, company, month);
  const situation = companySituation(company);
  return (
    <>
      <nav className="company-breadcrumb" aria-label="Caminho da empresa">
        <button type="button" onClick={onBack}>
          Empresas
        </button>
        <span aria-hidden="true">/</span>
        <span>{companyDisplayName(company)}</span>
        <span aria-hidden="true">/</span>
        <strong>
          {view === "regras"
            ? "Parâmetros legais"
            : views.find((item) => item.id === view)?.label}
        </strong>
      </nav>
      <section
        className="panel company-context"
        aria-label="Empresa em administração"
      >
        <div className="panel-body company-context-head">
          <div>
            <div className="eyebrow">ADMINISTRAÇÃO INDIVIDUAL</div>
            <h1>{companyDisplayName(company)}</h1>
            <p className="subtitle">
              {formatCompanyCnpj(company.cnpj)} ·{" "}
              {[company.cidade, company.uf].filter(Boolean).join(" / ") ||
                "Localização pendente"}
            </p>
          </div>
          <div className="actions">
            <span className={`pill ${situation === "ativa" ? "" : "warn"}`}>
              {situation}
            </span>
            <button className="button" onClick={onBack}>
              <ArrowLeft size={15} />
              Todas as empresas
            </button>
          </div>
        </div>
        {onSwitchCompany && (
          <div className="company-switch">
            <label>
              Trocar empresa em administração
              <select
                value={company.id}
                onChange={(event) => {
                  const next = data.companies.find(
                    (entry) => entry.id === event.target.value,
                  );
                  if (next) onSwitchCompany(next);
                }}
              >
                {data.companies.map((entry) => (
                  <option value={entry.id} key={entry.id}>
                    {companyDisplayName(entry)} · {companySituation(entry)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <nav
          className="tabs company-tabs"
          aria-label="Administração da empresa"
        >
          {views.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              className={`tab ${view === id || (id === "configuracoes" && view === "regras") ? "active" : ""}`}
              aria-current={
                view === id || (id === "configuracoes" && view === "regras")
                  ? "page"
                  : undefined
              }
              onClick={() => onNavigate(id)}
            >
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
      </section>
      {situation !== "ativa" && (
        <div className="banner" role="status">
          <Building2 size={18} />
          <div>
            <strong>
              Empresa {situation}: consulta e histórico preservados.
            </strong>
            <p>
              Novas operações em funcionários, modelos e escalas ficam
              bloqueadas enquanto a empresa não estiver ativa.
            </p>
            {onStatusChange && (
              <button
                className="button small"
                disabled={busy}
                onClick={() => onStatusChange("ativa")}
              >
                Reativar empresa
              </button>
            )}
          </div>
        </div>
      )}
      {view === "visao_geral" && (
        <>
          <div className="page-head">
            <div>
              <h2>Painel da empresa</h2>
              <p className="subtitle">
                Competência {month.slice(5, 7)}/{month.slice(0, 4)}. Os
                indicadores abrem os registros desta empresa.
              </p>
            </div>
            <button className="button" onClick={onEditCompany}>
              Editar cadastro da empresa
            </button>
          </div>
          <div className="company-overview-metrics">
            {[
              {
                label: "Funcionários ativos",
                value: summary.employees,
                target: "funcionarios",
              },
              {
                label: "Escalas salvas",
                value: summary.savedSchedules,
                target: "escalas",
              },
              {
                label: "Funcionários sem escala",
                value: summary.missingSchedules,
                target: "funcionarios",
              },
              {
                label: "Violações identificadas",
                value: summary.violations,
                target: "escalas",
              },
              {
                label: "Alertas de atenção",
                value: summary.attention,
                target: "escalas",
              },
              {
                label: "Feriados aplicáveis no mês",
                value: summary.applicableHolidays,
                target: "feriados",
              },
            ].map((item) => (
              <button
                className="stat company-stat"
                key={item.label}
                onClick={() => onNavigate(item.target as CompanyView)}
              >
                <span className="stat-top">{item.label}</span>
                <span className="stat-value">{item.value}</span>
                <span className="stat-foot">
                  Consultar registros da empresa →
                </span>
              </button>
            ))}
          </div>
          <section className="panel">
            <div className="panel-head">
              <h2>Próximos passos do cadastro</h2>
            </div>
            <div className="panel-body company-next-steps">
              {!company.cidade || !company.uf ? (
                <p>
                  Complete município e UF para conferir a aplicação dos feriados
                  locais.
                </p>
              ) : (
                <p>
                  Localização informada: {company.cidade} / {company.uf}.
                </p>
              )}
              {!summary.employees ? (
                <button
                  className="button"
                  onClick={() => onNavigate("funcionarios")}
                >
                  Adicionar funcionários nesta empresa
                </button>
              ) : null}
              {!company.modelo_padrao_id ? (
                <p>
                  Modelo padrão da empresa ainda não definido. Jornadas
                  individuais permanecem preservadas.
                </p>
              ) : (
                <p>
                  Modelo padrão:{" "}
                  <strong>
                    {data.models.find(
                      (model) => model.id === company.modelo_padrao_id,
                    )?.nome ?? "Modelo indisponível; revise o cadastro"}
                  </strong>
                  .
                </p>
              )}
              <p>
                {summary.pendingSources} pendências de fontes/regras na
                conferência das escalas. Esses registros não representam, por si
                só, violações trabalhistas.
              </p>
              {summary.unreadableSchedules > 0 && (
                <p className="warning-text">
                  {summary.unreadableSchedules} escala(s) não puderam ser
                  conferidas por dados inválidos. Os contadores não representam
                  uma conferência completa; abra as escalas para corrigir.
                </p>
              )}
              <p className="muted">
                Aprovação e publicação ainda não possuem fluxo persistido. As
                escalas salvas dependem de revisão humana e não recebem
                certificação jurídica automática.
              </p>
              <div className="actions">
                <button
                  className="button"
                  onClick={() => onNavigate("configuracoes")}
                >
                  Completar configurações
                </button>
                <button
                  className="button primary"
                  onClick={() => onNavigate("escalas")}
                >
                  Gerenciar escalas da empresa
                </button>
              </div>
            </div>
          </section>
        </>
      )}
      {view === "configuracoes" && (
        <section className="panel">
          <div className="panel-head">
            <h2>Configurações da empresa</h2>
            <button className="button primary" onClick={onEditCompany}>
              Editar configurações
            </button>
          </div>
          <div className="panel-body">
            <dl className="company-details">
              <div>
                <dt>Razão social</dt>
                <dd>{company.nome}</dd>
              </div>
              <div>
                <dt>Nome fantasia</dt>
                <dd>{company.nome_fantasia || "Não informado"}</dd>
              </div>
              <div>
                <dt>Código interno</dt>
                <dd>{company.codigo_interno || "Não informado"}</dd>
              </div>
              <div>
                <dt>Endereço / CEP</dt>
                <dd>
                  {[company.endereco, company.cep]
                    .filter(Boolean)
                    .join(" · ") || "Não informado"}
                </dd>
              </div>
              <div>
                <dt>Responsável</dt>
                <dd>{company.responsavel || "Não informado"}</dd>
              </div>
              <div>
                <dt>Contato</dt>
                <dd>{company.contato || "Não informado"}</dd>
              </div>
              <div>
                <dt>Carga semanal inicial</dt>
                <dd>
                  {company.carga_semanal_padrao_minutos
                    ? formatMinutes(company.carga_semanal_padrao_minutos)
                    : "Não definida"}
                </dd>
              </div>
              <div>
                <dt>Modelo padrão</dt>
                <dd>
                  {data.models.find(
                    (model) => model.id === company.modelo_padrao_id,
                  )?.nome ?? "Não definido"}
                </dd>
              </div>
              <div>
                <dt>Política de domingos e feriados</dt>
                <dd>
                  {company.politica_domingo_feriado || "Pendente de definição"}
                </dd>
              </div>
              <div>
                <dt>CCT e fundamento</dt>
                <dd>{company.cct || "Não informado / não validado"}</dd>
              </div>
              <div>
                <dt>Observações internas</dt>
                <dd>{company.observacoes || "Nenhuma"}</dd>
              </div>
              <div>
                <dt>Incluída em</dt>
                <dd>{dateLabel(company.created_at)}</dd>
              </div>
              <div>
                <dt>Atualizada em</dt>
                <dd>{dateLabel(company.updated_at)}</dd>
              </div>
            </dl>
            <p className="company-method-note">
              O modelo e a carga padrão são sugestões iniciais. Alterá-los não
              modifica a jornada individual, contratos ou escalas já
              cadastrados.
            </p>
            <div className="actions">
              <button className="button" onClick={() => onNavigate("regras")}>
                Parâmetros legais desta empresa
              </button>
            </div>
            {onStatusChange && (
              <div className="actions company-status-actions">
                {situation !== "ativa" && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => onStatusChange("ativa")}
                  >
                    Reativar empresa
                  </button>
                )}
                {situation === "ativa" && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => onStatusChange("inativa")}
                  >
                    Inativar empresa
                  </button>
                )}
                {situation !== "arquivada" && (
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() => onStatusChange("arquivada")}
                  >
                    Arquivar empresa
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
