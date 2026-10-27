"use client";
import { useState } from "react";
import { CalendarDays, FileText, Plus, UserRound } from "lucide-react";
import { buildAlertSummary } from "@/lib/alerts";
import {
  computeDay,
  dateUTC,
  evaluate,
  formatMinutes,
  span,
} from "@/lib/engine";
import type { Company, Employee } from "@/lib/types";
import type { Data } from "@/lib/store";
import { formatCpf } from "@/lib/cpf";
import { modelsForCompany, rulesForCompany } from "@/lib/company-resources";

type CompanySettings = Company & {
  situacao?: "ativa" | "inativa" | "arquivada";
  modelo_padrao_id?: string | null;
};
type EmployeeSettings = Employee & {
  matricula?: string;
  setor?: string;
  admissao?: string | null;
  situacao?: "ativo" | "inativo";
  modelo_padrao_id?: string | null;
  carga_diaria_minutos?: number | null;
  regras_especiais?: string;
};
type CompanyLog = Data["logs"][number] & {
  empresa_id?: string | null;
  registro_id?: string;
  ator_id?: string | null;
  antes?: Record<string, unknown> | null;
  depois?: Record<string, unknown> | null;
};
const days = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
];
const dateLabel = (date: string) =>
  dateUTC(date).toLocaleDateString("pt-BR", { timeZone: "UTC" });
const active = (employee: EmployeeSettings) => employee.situacao !== "inativo";
const canOperate = (company?: CompanySettings) =>
  Boolean(company) && (!company?.situacao || company.situacao === "ativa");
const normal = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

export type EmployeeDirectoryProps = {
  data: Data;
  companyId?: string;
  month: string;
  onEdit: (employee?: Employee) => void;
  onOpen: (employee: Employee) => void;
  onSchedules: (employee: Employee) => void;
  onTimesheet?: (employee: Employee) => void;
  onToggleStatus: (employee: Employee) => void;
};
export function EmployeeDirectory({
  data,
  companyId,
  month,
  onEdit,
  onOpen,
  onSchedules,
  onTimesheet,
  onToggleStatus,
}: EmployeeDirectoryProps) {
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [status, setStatus] = useState("todos");
  const scoped = (data.employees as EmployeeSettings[]).filter(
    (employee) => !companyId || employee.empresa_id === companyId,
  );
  const selectedCompany = companyId ?? companyFilter;
  const visible = scoped
    .filter((employee) => {
      const name = normal(
        `${employee.nome} ${employee.matricula ?? ""} ${employee.setor ?? ""}`,
      );
      return (
        (!selectedCompany || employee.empresa_id === selectedCompany) &&
        (!search || name.includes(normal(search))) &&
        (status === "todos" || active(employee) === (status === "ativo"))
      );
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const currentCompany = data.companies.find(
    (company) => company.id === companyId,
  ) as CompanySettings | undefined;
  return (
    <section
      className="employee-directory"
      aria-label="Gerenciamento de funcionários"
    >
      <div className="page-head">
        <div>
          <div className="eyebrow">PESSOAS E CONTRATOS</div>
          <h1>Funcionários</h1>
          <p className="subtitle">
            {companyId
              ? `Vínculos de ${currentCompany?.nome ?? "empresa selecionada"}.`
              : "Consulte os vínculos das empresas autorizadas."}{" "}
            Cada jornada individual pertence ao seu vínculo.
          </p>
        </div>
        <button
          className="button primary"
          disabled={
            !data.companies.some(canOperate) ||
            (Boolean(companyId) && !canOperate(currentCompany))
          }
          onClick={() => onEdit()}
        >
          <Plus size={16} />
          Adicionar funcionário
        </button>
      </div>
      <div className="panel panel-body employee-toolbar">
        <label>
          Buscar funcionário
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome, matrícula ou setor"
          />
        </label>
        {!companyId && (
          <label>
            Filtrar por empresa
            <select
              value={companyFilter}
              onChange={(event) => setCompanyFilter(event.target.value)}
            >
              <option value="">Todas as empresas</option>
              {data.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Situação do vínculo
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="todos">Todos</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
          </select>
        </label>
        <p className="muted" role="status">
          {visible.length} vínculo(s) encontrado(s) ·{" "}
          {scoped.filter(active).length} ativo(s) no contexto
        </p>
      </div>
      {visible.length ? (
        <div className="employee-cards">
          {visible.map((employee) => {
            const company = data.companies.find(
              (item) => item.id === employee.empresa_id,
            ) as CompanySettings | undefined;
            const availableModels = modelsForCompany(
              data.models,
              employee.empresa_id,
              [employee.modelo_padrao_id, company?.modelo_padrao_id],
            );
            const ownModel = availableModels.find(
              (model) => model.id === employee.modelo_padrao_id,
            );
            const companyModel = availableModels.find(
              (model) => model.id === company?.modelo_padrao_id,
            );
            const hasSchedule = data.schedules.some(
              (schedule) =>
                schedule.empresa_id === employee.empresa_id &&
                schedule.funcionario_id === employee.id &&
                schedule.mes.startsWith(month),
            );
            return (
              <article className="panel employee-card" key={employee.id}>
                <div className="panel-head">
                  <div>
                    <h2>
                      <button
                        className="employee-name-button"
                        onClick={() => onOpen(employee)}
                      >
                        {employee.nome}
                      </button>
                    </h2>
                    <p className="subtitle">
                      {employee.cargo || "Cargo não informado"}
                      {employee.setor ? ` · ${employee.setor}` : ""}
                    </p>
                  </div>
                  <span className={`pill ${active(employee) ? "" : "warn"}`}>
                    {active(employee) ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <div className="panel-body">
                  <p>
                    <strong>Empresa:</strong>{" "}
                    {company?.nome ?? "Vínculo indisponível"}
                  </p>
                  {employee.matricula && (
                    <p>
                      <strong>Matrícula:</strong> {employee.matricula}
                    </p>
                  )}
                  <p>
                    <strong>Carga contratual:</strong>{" "}
                    {employee.carga_semanal_minutos
                      ? `${formatMinutes(employee.carga_semanal_minutos)} / semana`
                      : "Pendente de revisão"}
                  </p>
                  {employee.horario_contratual && (
                    <p className="muted">{employee.horario_contratual}</p>
                  )}
                  <p>
                    <strong>Modelo:</strong>{" "}
                    {ownModel
                      ? `${ownModel.nome} · individual`
                      : companyModel
                        ? `${companyModel.nome} · padrão da empresa`
                        : "Sem modelo padrão definido"}
                  </p>
                  <p>
                    <strong>Descansos:</strong>{" "}
                    {employee.dias_descanso
                      .map((day) => days[day])
                      .join(", ") || "Revisar contrato"}
                  </p>
                  <p className="muted">
                    {hasSchedule
                      ? `Escala salva em ${month.slice(5, 7)}/${month.slice(0, 4)}`
                      : "Sem escala salva nesta competência"}
                  </p>
                  <div className="actions employee-actions">
                    <button
                      className="button small"
                      onClick={() => onOpen(employee)}
                    >
                      <UserRound size={15} />
                      Visualizar funcionário
                    </button>
                    <button
                      className="button small"
                      disabled={!canOperate(company)}
                      onClick={() => onEdit(employee)}
                    >
                      Editar funcionário
                    </button>
                    <button
                      className="button small"
                      onClick={() => onSchedules(employee)}
                    >
                      <CalendarDays size={15} />
                      Gerenciar escalas
                    </button>
                    {onTimesheet && (
                      <button
                        className="button small"
                        disabled={!hasSchedule}
                        onClick={() => onTimesheet(employee)}
                      >
                        <FileText size={15} />
                        Emitir folha de ponto
                      </button>
                    )}
                    <button
                      className="button small"
                      disabled={!canOperate(company)}
                      onClick={() => onToggleStatus(employee)}
                    >
                      {active(employee)
                        ? "Inativar vínculo"
                        : "Reativar vínculo"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="panel">
          <div className="empty">
            {scoped.length
              ? "Nenhum funcionário corresponde aos filtros."
              : "Esta empresa ainda não possui funcionários. Adicione o primeiro vínculo para configurar a jornada."}
          </div>
        </div>
      )}
    </section>
  );
}

export type EmployeeDetailsProps = {
  employee: Employee;
  company: Company;
  data: Data;
  month: string;
  onEdit: (employee: Employee) => void;
  onSchedules: (employee: Employee) => void;
  onTimesheet?: (employee: Employee) => void;
  onClose: () => void;
};
export function EmployeeDetails({
  employee: employeeBase,
  company: companyBase,
  data,
  month,
  onEdit,
  onSchedules,
  onTimesheet,
  onClose,
}: EmployeeDetailsProps) {
  const employee = employeeBase as EmployeeSettings;
  const company = companyBase as CompanySettings;
  if (employee.empresa_id !== company.id)
    return (
      <div className="banner" role="alert">
        O funcionário não pertence à empresa selecionada.
      </div>
    );
  const schedules = data.schedules.filter(
    (schedule) =>
      schedule.empresa_id === company.id &&
      schedule.funcionario_id === employee.id,
  );
  const schedule = schedules.find((item) => item.mes.startsWith(month));
  const rules = rulesForCompany(data.rules, company.id);
  const result = schedule
    ? evaluate(
        schedule.dias,
        rules,
        company,
        schedule.mes,
        schedule.modelo_tipo,
        employee,
      )
    : null;
  const summary = buildAlertSummary(result?.alerts ?? [], {
    companyId: company.id,
    companyName: company.nome,
    employeeId: employee.id,
    employeeName: employee.nome,
    month,
  });
  const availableModels = modelsForCompany(data.models, company.id, [
    employee.modelo_padrao_id,
    company.modelo_padrao_id,
  ]);
  const ownModel = availableModels.find(
    (model) => model.id === employee.modelo_padrao_id,
  );
  const model =
    ownModel ??
    availableModels.find((item) => item.id === company.modelo_padrao_id);
  const today = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const selectedDays =
    schedule?.dias
      .filter((day) => day.data.startsWith(month))
      .sort((a, b) => a.data.localeCompare(b.data)) ?? [];
  const rests = selectedDays
    .filter(
      (day) =>
        day.data >= today &&
        computeDay(day, rules, schedule!.dias).worked === 0,
    )
    .slice(0, 8);
  const plannedHolidays = selectedDays.filter(
    (day) => day.feriado && computeDay(day, rules, schedule!.dias).worked > 0,
  );
  const scheduleIds = new Set(schedules.map((item) => item.id));
  const history = (data.logs as CompanyLog[])
    .filter(
      (log) =>
        log.empresa_id === company.id &&
        ((log.tabela === "funcionarios" && log.registro_id === employee.id) ||
          (log.tabela === "escalas" && scheduleIds.has(log.registro_id ?? ""))),
    )
    .sort((a, b) => b.alterado_em.localeCompare(a.alterado_em));
  const establishment = (data.establishments ?? []).find(
    (unit) =>
      unit.id === employee.estabelecimento_id && unit.empresa_id === company.id,
  );
  return (
    <section className="employee-detail" aria-label="Página do funcionário">
      <div className="page-head">
        <div>
          <button className="button small" onClick={onClose}>
            Voltar aos funcionários
          </button>
          <div className="eyebrow">{company.nome}</div>
          <h1>{employee.nome}</h1>
          <p className="subtitle">
            {employee.cargo || "Cargo não informado"}
            {employee.setor ? ` · ${employee.setor}` : ""} ·{" "}
            {active(employee) ? "Vínculo ativo" : "Vínculo inativo"}
          </p>
        </div>
        <div className="actions">
          <button
            className="button"
            disabled={!canOperate(company)}
            onClick={() => onEdit(employee)}
          >
            Editar jornada e cadastro
          </button>
          <button
            className="button primary"
            onClick={() => onSchedules(employee)}
          >
            Gerenciar escalas
          </button>
          {onTimesheet && (
            <button
              className="button"
              disabled={!schedule}
              onClick={() => onTimesheet(employee)}
            >
              <FileText size={15} />
              Emitir folha de ponto
            </button>
          )}
        </div>
      </div>
      <div className="employee-summary-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Contrato e jornada individual</h2>
          </div>
          <div className="panel-body">
            <dl className="employee-data">
              <div>
                <dt>Empresa</dt>
                <dd>{company.nome}</dd>
              </div>
              <div>
                <dt>Estabelecimento / localidade</dt>
                <dd>
                  {establishment
                    ? `${establishment.nome} · ${establishment.cidade}/${establishment.uf}`
                    : `${company.cidade}/${company.uf} · Localidade principal`}
                </dd>
              </div>
              <div>
                <dt>CPF</dt>
                <dd>{formatCpf(employee.cpf)}</dd>
              </div>
              <div>
                <dt>Matrícula</dt>
                <dd>{employee.matricula || "Não informada"}</dd>
              </div>
              <div>
                <dt>Admissão</dt>
                <dd>
                  {employee.admissao
                    ? dateLabel(employee.admissao)
                    : "Não informada"}
                </dd>
              </div>
              <div>
                <dt>Carga diária</dt>
                <dd>
                  {employee.carga_diaria_minutos
                    ? formatMinutes(employee.carga_diaria_minutos)
                    : "Pendente de revisão"}
                </dd>
              </div>
              <div>
                <dt>Carga semanal</dt>
                <dd>
                  {employee.carga_semanal_minutos
                    ? formatMinutes(employee.carga_semanal_minutos)
                    : "Pendente de revisão"}
                </dd>
              </div>
              <div>
                <dt>Modelo</dt>
                <dd>
                  {model?.nome ?? "Não definido"}
                  {model
                    ? ownModel
                      ? " · individual"
                      : " · herdado da empresa"
                    : ""}
                </dd>
              </div>
              <div>
                <dt>Descansos contratuais</dt>
                <dd>
                  {employee.dias_descanso.map((day) => days[day]).join(", ") ||
                    "Não informados"}
                </dd>
              </div>
            </dl>
            {employee.horario_contratual && (
              <p className="subtitle">{employee.horario_contratual}</p>
            )}
            {employee.regras_especiais && (
              <p className="subtitle">{employee.regras_especiais}</p>
            )}
            <p className="warning-text">
              Alterar o cadastro não substitui escalas salvas. Abra a
              competência e confira os efeitos antes de gerar uma nova prévia.
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>
              Planejamento de {month.slice(5, 7)}/{month.slice(0, 4)}
            </h2>
          </div>
          <div className="panel-body">
            {result ? (
              <>
                <p>
                  <strong>Horas planejadas:</strong>{" "}
                  {formatMinutes(result.total)}
                </p>
                <p>
                  <strong>Violações:</strong> {summary.counts.violations} grupos
                  · {summary.occurrenceCounts.violations} ocorrências
                </p>
                <p>
                  <strong>Atenção:</strong> {summary.counts.attention} grupos
                </p>
                <p>
                  <strong>Fontes pendentes:</strong>{" "}
                  {summary.counts.pendingSources} grupos
                </p>
                <p className="subtitle">
                  Modelo da escala salva:{" "}
                  {schedule?.modelo_nome || "Não informado"}. A conferência usa
                  os parâmetros atuais e não representa aprovação jurídica.
                </p>
                <button
                  className="button small"
                  onClick={() => onSchedules(employee)}
                >
                  Visualizar jornada no calendário
                </button>
              </>
            ) : (
              <p className="muted">
                Nenhuma escala salva para esta competência. Gere uma prévia
                usando o modelo individual ou o padrão da empresa.
              </p>
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Próximas folgas planejadas</h2>
          </div>
          <div className="panel-body">
            {rests.length ? (
              <ul>
                {rests.map((day) => (
                  <li key={day.data}>
                    {dateLabel(day.data)}
                    {day.feriado ? ` · ${day.feriado}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                Nenhuma folga futura encontrada nas datas salvas desta
                competência.
              </p>
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Expediente planejado em feriados</h2>
          </div>
          <div className="panel-body">
            {plannedHolidays.length ? (
              <ul>
                {plannedHolidays.map((day) => (
                  <li key={day.data}>
                    <strong>
                      {dateLabel(day.data)} · {day.feriado}
                    </strong>
                    <p>
                      {day.intervalos.length
                        ? day.intervalos
                            .map(
                              (shift) =>
                                `${shift.start}–${shift.end}${span(shift)[1] >= 1440 ? " (+1 dia)" : ""}`,
                            )
                            .join(" / ")
                        : "Continuação do turno anterior"}{" "}
                      ·{" "}
                      {formatMinutes(
                        computeDay(day, rules, schedule!.dias).worked,
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                Nenhum expediente em feriado nas datas salvas desta competência.
              </p>
            )}
            <p className="subtitle">
              A escala registra previsão de trabalho, não comprovação de
              expediente realizado.
            </p>
          </div>
        </section>
      </div>
      {summary.groups.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Pendências da jornada</h2>
          </div>
          <div className="panel-body">
            <ul>
              {summary.groups.map((group) => (
                <li key={group.id}>
                  <strong>{group.title}</strong> · {group.count} ocorrência(s)
                  <p className="muted">{group.message}</p>
                </li>
              ))}
            </ul>
            <button
              className="button small"
              onClick={() => onSchedules(employee)}
            >
              Resolver no calendário
            </button>
          </div>
        </section>
      )}
      <section className="panel employee-history">
        <div className="panel-head">
          <h2>Histórico do funcionário</h2>
        </div>
        {history.length ? (
          <div className="panel-body">
            <ul>
              {history.map((log) => (
                <li key={log.id}>
                  <p>
                    <strong>
                      {new Date(log.alterado_em).toLocaleString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                      })}
                    </strong>{" "}
                    ·{" "}
                    {log.acao === "INSERT"
                      ? "Inclusão"
                      : log.acao === "UPDATE"
                        ? "Alteração"
                        : log.acao}{" "}
                    em{" "}
                    {log.tabela === "funcionarios"
                      ? "cadastro/jornada"
                      : "escala"}
                  </p>
                  <p className="muted">
                    {log.ator_id
                      ? `Usuário ${log.ator_id}`
                      : "Responsável não identificado no registro legado"}
                  </p>
                  {log.antes || log.depois ? (
                    <details>
                      <summary>Ver dados registrados antes e depois</summary>
                      <pre>
                        {JSON.stringify(
                          {
                            antes: log.antes ?? null,
                            depois: log.depois ?? null,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="empty">
            Nenhum evento com vínculo identificável a este funcionário. O
            histórico legado sem contexto não é associado por suposição.
          </div>
        )}
      </section>
    </section>
  );
}
