"use client";

import { Copy, Plus, Trash2 } from "lucide-react";
import { dateUTC, dominioText, holidayAt } from "@/lib/engine";
import { rulesForCompany } from "@/lib/company-resources";
import type { Data } from "@/lib/store";
import type { Company, Holiday, LegalRule, Model } from "@/lib/types";

type ResourceKind = "modelo" | "feriado" | "regra";
type CompanyResourcesProps = {
  company: Company;
  data: Data;
  tab: "modelos" | "feriados" | "regras";
  busy?: boolean;
  onEdit: (kind: ResourceKind, row?: object) => void;
  onDeleteModel: (model: Model) => void;
  onCopyModelText: (model: Model) => void;
};
const dateLabel = (value: string) => {
  const date = dateUTC(value);
  return Number.isFinite(+date)
    ? date.toLocaleDateString("pt-BR", { timeZone: "UTC" })
    : value;
};

function HolidayTable({
  holidays,
  general,
  locked,
  onEdit,
}: {
  holidays: Holiday[];
  general: boolean;
  locked: boolean;
  onEdit: CompanyResourcesProps["onEdit"];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Feriado</th>
            <th>Abrangência</th>
            <th>Localidade</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {[...holidays]
            .sort((a, b) => a.data.localeCompare(b.data))
            .map((holiday) => (
              <tr key={holiday.id}>
                <td>{dateLabel(holiday.data)}</td>
                <td>
                  <strong>{holiday.nome}</strong>
                  <p className="muted">
                    {general ? "Referência geral" : "Próprio desta empresa"}
                  </p>
                </td>
                <td>
                  <span className="pill">{holiday.abrangencia}</span>
                </td>
                <td>
                  {[holiday.cidade, holiday.uf].filter(Boolean).join(" / ") ||
                    "Brasil"}
                </td>
                <td>
                  <button
                    className="button small"
                    disabled={locked}
                    onClick={() => onEdit("feriado", holiday)}
                  >
                    {general ? "Personalizar nesta empresa" : "Editar feriado"}
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function RuleCard({
  rule,
  general,
  locked,
  onEdit,
}: {
  rule: LegalRule;
  general: boolean;
  locked: boolean;
  onEdit: CompanyResourcesProps["onEdit"];
}) {
  return (
    <article className="legal-card">
      <div className="actions justify-between">
        <div>
          <h3>{rule.nome}</h3>
          <p className="subtitle !mt-1 !text-[11px]">
            Vigência a partir de {dateLabel(rule.inicio_vigencia)} ·{" "}
            {rule.chave}
            {rule.chave === "regime" &&
              (rule.valor.tipo_regime === "12x36"
                ? " · 12×36"
                : " · Jornada comum")}
          </p>
          <p className="muted">
            {general ? "Parâmetro geral" : "Próprio desta empresa"}
          </p>
        </div>
        <div className="actions">
          <span className={`pill ${rule.confirmado ? "" : "warn"}`}>
            {rule.confirmado ? "Conferida" : "Pendente de conferência"}
          </span>
          <button
            className="button small"
            disabled={locked}
            onClick={() => onEdit("regra", rule)}
          >
            {general ? "Personalizar nesta empresa" : "Editar regra"}
          </button>
        </div>
      </div>
      <div className="legal-values">
        {Object.entries(rule.valor).map(([key, value]) => (
          <span key={key}>
            {key.replaceAll("_", " ")}:{" "}
            <b>
              {typeof value === "boolean" ? (value ? "sim" : "não") : value}
            </b>
          </span>
        ))}
      </div>
      <p className="alert-source">Fonte: {rule.fonte}</p>
      {rule.observacao && (
        <p className="warning-text mt-2">{rule.observacao}</p>
      )}
    </article>
  );
}

export function CompanyResources({
  company,
  data,
  tab,
  busy = false,
  onEdit,
  onDeleteModel,
  onCopyModelText,
}: CompanyResourcesProps) {
  const locked = busy || (company.situacao ?? "ativa") !== "ativa";
  if (tab === "modelos") {
    const own = data.models.filter((model) => model.empresa_id === company.id);
    const library = data.models.filter((model) => model.empresa_id == null);
    const linkedModelIds = new Set([
      company.modelo_padrao_id,
      ...data.employees
        .filter((employee) => employee.empresa_id === company.id)
        .map((employee) => employee.modelo_padrao_id),
      ...data.schedules
        .filter((schedule) => schedule.empresa_id === company.id)
        .map((schedule) => schedule.modelo_id),
    ]);
    return (
      <>
        <div className="page-head">
          <div>
            <div className="eyebrow">JORNADAS DA EMPRESA</div>
            <h1>Jornadas e modelos</h1>
            <p className="subtitle">
              Modelos próprios de {company.nome}. A biblioteca oferece bases
              para cópia, sem vinculação automática.
            </p>
          </div>
          <button
            className="button primary"
            disabled={locked}
            onClick={() => onEdit("modelo")}
          >
            <Plus size={16} /> Novo modelo
          </button>
        </div>
        <section aria-label="Modelos da empresa">
          <h2>Modelos da empresa</h2>
          {own.length ? (
            <div className="grid2">
              {own.map((model) => (
                <article className="panel" key={model.id}>
                  <div className="panel-head">
                    <h3>{model.nome}</h3>
                    <span className="pill">{model.tipo}</span>
                  </div>
                  <div className="panel-body">
                    <p className="subtitle !mt-0 !text-xs">
                      {dominioText(model)}
                    </p>
                    <p className="muted">Próprio desta empresa</p>
                    <div className="actions mt-5">
                      <button
                        className="button small"
                        disabled={locked}
                        onClick={() => onEdit("modelo", model)}
                      >
                        Editar modelo
                      </button>
                      <button
                        className="button small"
                        disabled={busy}
                        onClick={() => onCopyModelText(model)}
                      >
                        <Copy size={13} /> Copiar para o Domínio
                      </button>
                      <button
                        className="button small danger"
                        disabled={locked || linkedModelIds.has(model.id)}
                        title={
                          linkedModelIds.has(model.id)
                            ? "Modelo vinculado a cadastro ou escala; preserve os vínculos antes de excluir."
                            : undefined
                        }
                        onClick={() => onDeleteModel(model)}
                      >
                        <Trash2 size={13} /> Excluir modelo
                      </button>
                    </div>
                    {linkedModelIds.has(model.id) && (
                      <p className="muted">
                        Modelo em uso: a exclusão permanece bloqueada para
                        preservar os vínculos.
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="panel empty">
              Esta empresa ainda não possui modelos próprios. Crie um modelo ou
              personalize uma base da biblioteca.
            </div>
          )}
        </section>
        <section aria-label="Biblioteca de modelos-base" className="mt-6">
          <div className="page-head">
            <div>
              <h2>Biblioteca de modelos-base</h2>
              <p className="subtitle">
                Personalizar cria uma cópia exclusiva para {company.nome}; o
                modelo original e as outras empresas permanecem preservados.
              </p>
            </div>
          </div>
          {library.length ? (
            <div className="grid2">
              {library.map((model) => (
                <article className="panel" key={model.id}>
                  <div className="panel-head">
                    <h3>{model.nome}</h3>
                    <span className="pill">{model.tipo}</span>
                  </div>
                  <div className="panel-body">
                    <p className="subtitle !mt-0 !text-xs">
                      {dominioText(model)}
                    </p>
                    <p className="muted">Modelo-base da biblioteca</p>
                    <div className="actions mt-5">
                      <button
                        className="button small"
                        disabled={locked}
                        onClick={() => onEdit("modelo", model)}
                      >
                        Personalizar nesta empresa
                      </button>
                      <button
                        className="button small"
                        disabled={busy}
                        onClick={() => onCopyModelText(model)}
                      >
                        <Copy size={13} /> Copiar para o Domínio
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="panel empty">
              Nenhum modelo-base disponível na biblioteca.
            </div>
          )}
        </section>
      </>
    );
  }
  if (tab === "feriados") {
    const own = data.holidays.filter(
      (holiday) => holiday.empresa_id === company.id,
    );
    const general = data.holidays.filter(
      (holiday) =>
        holiday.empresa_id == null &&
        Boolean(holidayAt(holiday.data, [holiday], company)),
    );
    return (
      <>
        <div className="page-head">
          <div>
            <div className="eyebrow">CALENDÁRIO DA EMPRESA</div>
            <h1>Feriados da empresa</h1>
            <p className="subtitle">
              Datas próprias de {company.nome} e referências gerais aplicáveis à
              sua localidade.
            </p>
          </div>
          <button
            className="button primary"
            disabled={locked}
            onClick={() => onEdit("feriado")}
          >
            <Plus size={16} /> Novo feriado
          </button>
        </div>
        <section className="panel" aria-label="Feriados da empresa">
          <div className="panel-head">
            <h2>Datas próprias</h2>
          </div>
          {own.length ? (
            <HolidayTable
              holidays={own}
              general={false}
              locked={locked}
              onEdit={onEdit}
            />
          ) : (
            <div className="empty">
              Esta empresa ainda não possui feriados próprios. As referências
              gerais aplicáveis aparecem abaixo.
            </div>
          )}
        </section>
        <section
          className="panel mt-6"
          aria-label="Referências gerais de feriados"
        >
          <div className="panel-head">
            <h2>Referências gerais de feriados</h2>
          </div>
          <div className="panel-body">
            <p className="subtitle">
              Personalizar cria uma data própria nesta empresa e preserva o
              calendário geral. A aplicação continua respeitando abrangência e
              localidade.
            </p>
          </div>
          {general.length ? (
            <HolidayTable
              holidays={general}
              general
              locked={locked}
              onEdit={onEdit}
            />
          ) : (
            <div className="empty">
              Nenhuma referência geral aplicável à localidade cadastrada.
            </div>
          )}
        </section>
      </>
    );
  }
  const own = data.rules.filter((rule) => rule.empresa_id === company.id);
  const general = rulesForCompany(data.rules, company.id).filter(
    (rule) => rule.empresa_id == null,
  );
  const order = (a: LegalRule, b: LegalRule) =>
    a.chave.localeCompare(b.chave) ||
    a.inicio_vigencia.localeCompare(b.inicio_vigencia);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">REGRAS DA EMPRESA</div>
          <h1>Parâmetros legais da empresa</h1>
          <p className="subtitle">
            Parâmetros próprios de {company.nome}, com valores, fontes e
            vigências preservados.
          </p>
        </div>
        <button
          className="button primary"
          disabled={locked}
          onClick={() => onEdit("regra")}
        >
          <Plus size={16} /> Nova regra
        </button>
      </div>
      <section className="panel" aria-label="Parâmetros legais da empresa">
        <div className="panel-head">
          <h2>Regras próprias</h2>
        </div>
        {own.length ? (
          [...own]
            .sort(order)
            .map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                general={false}
                locked={locked}
                onEdit={onEdit}
              />
            ))
        ) : (
          <div className="empty">
            Esta empresa ainda não possui parâmetros próprios. As referências
            gerais aplicáveis aparecem abaixo.
          </div>
        )}
      </section>
      <section className="panel mt-6" aria-label="Parâmetros gerais aplicáveis">
        <div className="panel-head">
          <h2>Parâmetros gerais aplicáveis</h2>
        </div>
        <div className="panel-body">
          <p className="subtitle">
            Para cada grupo e tipo de regime, a regra própria passa a valer
            desde sua primeira vigência; antes dela permanecem as referências
            gerais aplicáveis. Personalizar cria uma cópia nesta empresa para
            conferência, preservando os valores e as fontes originais.
          </p>
        </div>
        {general.length ? (
          [...general]
            .sort(order)
            .map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                general
                locked={locked}
                onEdit={onEdit}
              />
            ))
        ) : (
          <div className="empty">
            Nenhum parâmetro geral aplicável para os grupos cadastrados.
          </div>
        )}
      </section>
    </>
  );
}
