"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import type { Data } from "@/lib/store";
import type { Schedule } from "@/lib/types";
import { formatMinutes, monthDates } from "@/lib/engine";
import { validateShiftText } from "@/lib/shift-editor";
import {
  absenceConflicts,
  assessSwap,
  comparePlannedActual,
  coverageGaps,
  operationLabels,
  operationsForCompany,
  parseActualImport,
  safeDocumentUrl,
  suggestSwapCandidates,
  validateCompanyOperation,
  type CompanyOperation,
} from "@/lib/company-operations";

type Props = {
  data: Data;
  companyId: string;
  month: string;
  onSave: (operation: CompanyOperation) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onApplySwap?: (
    schedules: Schedule[],
    operation: CompanyOperation,
  ) => Promise<void>;
  onOpenEmployee?: (employeeId: string, date: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  busy?: boolean;
};
const dateLabel = (date: string) => date.split("-").reverse().join("/");
const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const statuses = {
  pendente: "Pendente de conferência",
  aprovado: "Conferido",
  cancelado: "Cancelado",
};

/** Registers operational decisions without silently rewriting the calendar. */
export default function CompanyOperations({
  data,
  companyId,
  month,
  onSave,
  onRemove,
  onApplySwap,
  onOpenEmployee,
  onDirtyChange,
  busy = false,
}: Props) {
  const formId = useId();
  const [tab, setTab] = useState<CompanyOperation["tipo"]>("ausencia");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("todos");
  const [editing, setEditing] = useState<CompanyOperation | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [actualEmployee, setActualEmployee] = useState("");
  const [importRows, setImportRows] = useState<CompanyOperation[]>([]);
  const [suggestions, setSuggestions] = useState<
    ReturnType<typeof suggestSwapCandidates>
  >([]);
  const [reviewSwap, setReviewSwap] = useState<CompanyOperation | null>(null);
  useEffect(() => {
    onDirtyChange?.(formDirty || importRows.length > 0);
  }, [formDirty, importRows.length, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const company = data.companies.find((item) => item.id === companyId);
  const employees = useMemo(
    () =>
      data.employees.filter(
        (item) => item.empresa_id === companyId && item.situacao !== "inativo",
      ),
    [data.employees, companyId],
  );
  const units = useMemo(
    () =>
      data.establishments?.filter(
        (unit) => unit.empresa_id === companyId && unit.ativo,
      ) ?? [],
    [data.establishments, companyId],
  );
  const disabled =
    busy || pending || !company || (company.situacao ?? "ativa") !== "ativa";
  const allRecords = useMemo(
    () => operationsForCompany(data, companyId, month),
    [data, companyId, month],
  );
  const records = useMemo(
    () =>
      allRecords
        .filter(
          (item) =>
            item.tipo === tab &&
            (status === "todos" || item.status === status) &&
            (!query ||
              `${item.titulo} ${data.employees.find((person) => person.id === item.funcionario_id)?.nome ?? ""}`
                .toLocaleLowerCase("pt-BR")
                .includes(query.toLocaleLowerCase("pt-BR"))),
        )
        .sort((a, b) => b.data_inicio.localeCompare(a.data_inicio)),
    [allRecords, tab, status, query, data.employees],
  );
  const comparison = useMemo(
    () =>
      actualEmployee &&
      employees.some((employee) => employee.id === actualEmployee)
        ? comparePlannedActual(data, companyId, actualEmployee, month)
        : [],
    [data, companyId, actualEmployee, month, employees],
  );

  async function perform(action: () => Promise<void>) {
    if (disabled) return;
    setError("");
    setNotice("");
    setPending(true);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível concluir. Confira os dados e tente novamente.",
      );
    } finally {
      setPending(false);
    }
  }
  function closeForm() {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (
      form?.dataset.dirty === "true" &&
      !window.confirm("Descartar as alterações deste registro operacional?")
    )
      return;
    setShowForm(false);
    setEditing(null);
    setFormDirty(false);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const read = (name: string) => String(values.get(name) ?? "").trim();
    const start = read("data_inicio"),
      end = read("data_fim") || start;
    let payload: Record<string, unknown> = {};
    try {
      if (tab === "ausencia")
        payload = { categoria: read("categoria"), motivo: read("motivo") };
      if (tab === "cobertura")
        payload = {
          estabelecimento_id: read("estabelecimento_id") || null,
          setor: read("setor"),
          cargo: read("cargo"),
          inicio: read("inicio"),
          fim: read("fim"),
          minimo: Number(read("minimo")),
          dias_semana: values.getAll("dia_semana").map(Number),
        };
      if (tab === "troca")
        payload = {
          destino_funcionario_id: read("destino_funcionario_id"),
          data_origem: read("data_origem"),
          data_destino: read("data_destino"),
          justificativa: read("justificativa"),
        };
      if (tab === "documento")
        payload = {
          fonte: read("fonte"),
          url: safeDocumentUrl(read("url")),
          vigencia_fim: read("vigencia_fim") || null,
          referencia: read("referencia"),
        };
      if (tab === "realizado") {
        if (read("periodos") && values.has("sem_marcacoes"))
          throw new Error(
            "Escolha entre informar períodos e declarar zero horas.",
          );
        if (!read("periodos") && !values.has("sem_marcacoes"))
          throw new Error(
            "Informe as marcações realizadas ou confirme expressamente o registro de zero horas.",
          );
        const parsed = validateShiftText(read("periodos"));
        if (!parsed.shifts) throw new Error(parsed.errors.intervals);
        payload = {
          intervalos: parsed.shifts,
          origem: "manual",
          observacao: read("observacao"),
        };
      }
      const swapDates =
        tab === "troca"
          ? [String(payload.data_origem), String(payload.data_destino)].sort()
          : null;
      const operation: CompanyOperation = {
        id: editing?.id ?? crypto.randomUUID(),
        empresa_id: companyId,
        tipo: tab,
        status: "pendente",
        titulo: read("titulo"),
        funcionario_id: ["ausencia", "troca", "realizado"].includes(tab)
          ? read("funcionario_id")
          : null,
        data_inicio: swapDates?.[0] ?? start,
        data_fim:
          swapDates?.[1] ??
          (tab === "realizado"
            ? start
            : tab === "documento"
              ? read("vigencia_fim") || "2199-12-31"
              : end),
        payload,
      };
      if (tab === "documento" && !payload.vigencia_fim)
        operation.data_fim = start;
      const errors = validateCompanyOperation(operation, data);
      if (errors.length) throw new Error(errors.join(" "));
      if (
        tab === "realizado" &&
        (data.operations ?? []).some(
          (item) =>
            item.id !== operation.id &&
            item.empresa_id === companyId &&
            item.funcionario_id === operation.funcionario_id &&
            item.tipo === "realizado" &&
            item.status !== "cancelado" &&
            item.data_inicio === operation.data_inicio,
        )
      )
        throw new Error(
          "Já existe um registro de marcações para esta pessoa e data. Edite o registro existente.",
        );
      await perform(async () => {
        await onSave(operation);
        form.dataset.dirty = "false";
        setFormDirty(false);
        setEditing(null);
        setShowForm(false);
        setNotice(
          "Registro salvo para conferência. A escala não foi alterada.",
        );
      });
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  function selectTab(next: CompanyOperation["tipo"]) {
    if (showForm) {
      const form = document.getElementById(formId) as HTMLFormElement | null;
      if (
        form?.dataset.dirty === "true" &&
        !window.confirm("Descartar o formulário aberto e trocar de seção?")
      )
        return;
    }
    setTab(next);
    setFormDirty(false);
    setShowForm(false);
    setEditing(null);
    setImportRows([]);
    setSuggestions([]);
    setReviewSwap(null);
    setError("");
    setNotice("");
  }
  function review(operation: CompanyOperation) {
    const errors = validateCompanyOperation(
      { ...operation, status: "aprovado" },
      data,
    );
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    if (operation.tipo === "troca") {
      setReviewSwap(operation);
      return;
    }
    if (
      operation.tipo === "realizado" &&
      (data.operations ?? []).some(
        (item) =>
          item.id !== operation.id &&
          item.tipo === "realizado" &&
          item.status === "aprovado" &&
          item.funcionario_id === operation.funcionario_id &&
          item.empresa_id === companyId &&
          item.data_inicio === operation.data_inicio,
      )
    ) {
      setError(
        "Há outro registro conferido nesta data. Resolva a duplicidade antes de conferir.",
      );
      return;
    }
    if (
      !window.confirm(
        `Conferir “${operation.titulo}”? O registro será usado nos indicadores operacionais; nenhuma escala ou pagamento será alterado automaticamente.`,
      )
    )
      return;
    void perform(async () => {
      await onSave({ ...operation, status: "aprovado" });
      setNotice(
        "Registro conferido. Revise os conflitos operacionais indicados abaixo.",
      );
    });
  }
  const swapAssessment = reviewSwap ? assessSwap(data, reviewSwap) : null;

  return (
    <section
      className="panel company-operations"
      aria-label="Operação e conferência da empresa"
    >
      <div className="panel-head">
        <div>
          <h2>Operação e conferência</h2>
          <p className="muted">
            {company?.nome ?? "Empresa indisponível"} · competência{" "}
            {month.slice(5)}/{month.slice(0, 4)}
          </p>
        </div>
      </div>
      <div className="tabs" role="group" aria-label="Seções operacionais">
        {(
          Object.entries(operationLabels) as [
            CompanyOperation["tipo"],
            string,
          ][]
        ).map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={`tab ${tab === key ? "active" : ""}`}
            aria-pressed={tab === key}
            onClick={() => selectTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="panel-body">
        <p className="muted">
          Os registros abaixo apoiam o planejamento. Ausências, documentos e
          marcações realizadas não alteram jornadas, folha de ponto ou
          pagamentos automaticamente. “Conferido” indica uma decisão
          operacional, sem certificar conformidade jurídica.
        </p>
        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="banner neutral" role="status">
            {notice}
          </p>
        )}
        <div className="filters mt-4">
          <label>
            Pesquisar registro
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Título ou funcionário"
            />
          </label>
          <label>
            Situação
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="todos">Todas</option>
              <option value="pendente">Pendentes</option>
              <option value="aprovado">Conferidos</option>
              <option value="cancelado">Cancelados</option>
            </select>
          </label>
          <button
            type="button"
            className="button primary"
            disabled={disabled}
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            Novo registro
          </button>
        </div>
        {tab === "realizado" && (
          <div className="mt-4">
            <label>
              Funcionário para comparação e importação
              <select
                value={actualEmployee}
                onChange={(event) => {
                  setActualEmployee(event.target.value);
                  setImportRows([]);
                }}
              >
                <option value="">Selecione</option>
                {employees.map((employee) => (
                  <option value={employee.id} key={employee.id}>
                    {employee.nome}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              Importação CSV documentada: <code>Data;Períodos</code>, uma linha
              por dia, como <code>2026-12-01;08:02-12:00,13:00-17:20</code>. Use
              horários efetivamente registrados ou ZERO para declarar zero
              horas. Campos vazios não são convertidos em marcações. A prévia
              exige conferência posterior.
            </p>
            <label>
              Importar marcações CSV
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                disabled={disabled || !actualEmployee}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  try {
                    if (file.size > 1000000)
                      throw new Error("Arquivo acima de 1 MB.");
                    setImportRows(
                      parseActualImport(
                        await file.text(),
                        data,
                        companyId,
                        actualEmployee,
                      ),
                    );
                    setError("");
                  } catch (cause) {
                    setError((cause as Error).message);
                    setImportRows([]);
                  }
                }}
              />
            </label>
            {importRows.length > 0 && (
              <div className="banner neutral">
                <span>
                  {importRows.length} datas lidas. Nenhuma foi gravada.{" "}
                  {
                    importRows.filter((row) =>
                      (data.operations ?? []).some(
                        (existing) =>
                          existing.empresa_id === companyId &&
                          existing.tipo === "realizado" &&
                          existing.status !== "cancelado" &&
                          existing.funcionario_id === actualEmployee &&
                          existing.data_inicio === row.data_inicio,
                      ),
                    ).length
                  }{" "}
                  duplicidades encontradas.
                </span>
                <button
                  type="button"
                  className="button"
                  disabled={disabled}
                  onClick={() =>
                    void perform(async () => {
                      const duplicate = importRows.some((row) =>
                        (data.operations ?? []).some(
                          (existing) =>
                            existing.empresa_id === companyId &&
                            existing.tipo === "realizado" &&
                            existing.status !== "cancelado" &&
                            existing.funcionario_id === actualEmployee &&
                            existing.data_inicio === row.data_inicio,
                        ),
                      );
                      if (duplicate)
                        throw new Error(
                          "A importação contém datas já registradas. Corrija o arquivo; nenhuma linha foi enviada.",
                        );
                      let saved = 0;
                      try {
                        for (const row of importRows) {
                          await onSave(row);
                          saved++;
                        }
                      } catch (cause) {
                        setImportRows(importRows.slice(saved));
                        throw new Error(
                          `${saved} registros salvos; os demais permanecem na prévia. ${(cause as Error).message}`,
                        );
                      }
                      setImportRows([]);
                      setNotice(
                        `${saved} registros salvos como pendentes para conferência.`,
                      );
                    })
                  }
                >
                  Salvar importação para conferência
                </button>
              </div>
            )}
            {comparison.length > 0 && (
              <details className="mt-4">
                <summary>Comparar planejado × realizado — {month}</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Programado (relógio)</th>
                        <th>Realizado conferido</th>
                        <th>Diferença de relógio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.map((row) => (
                        <tr key={row.date}>
                          <td>{dateLabel(row.date)}</td>
                          <td>
                            {row.planned === null
                              ? "Sem escala"
                              : formatMinutes(row.planned)}
                          </td>
                          <td>
                            {row.duplicate
                              ? "Duplicidade: revisar"
                              : row.actual === null
                                ? "Não informado"
                                : formatMinutes(row.actual)}
                          </td>
                          <td>
                            {row.delta === null
                              ? "—"
                              : `${row.delta < 0 ? "−" : "+"}${formatMinutes(Math.abs(row.delta))}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted">
                  Diferença de relógio não representa automaticamente horas
                  extras, falta, desconto ou banco de horas.
                </p>
              </details>
            )}
          </div>
        )}
        {showForm && (
          <form
            id={formId}
            className="form-grid mt-5"
            key={`${tab}-${editing?.id ?? "new"}`}
            onSubmit={submit}
            onChange={(event) => {
              event.currentTarget.dataset.dirty = "true";
              setFormDirty(true);
            }}
          >
            <h3 className="span2">
              {editing ? "Editar registro" : "Novo registro"} ·{" "}
              {operationLabels[tab]}
            </h3>
            <label className="span2">
              Título
              <input
                name="titulo"
                required
                maxLength={160}
                defaultValue={editing?.titulo ?? ""}
              />
            </label>
            {["ausencia", "troca", "realizado"].includes(tab) && (
              <label className="span2">
                Funcionário
                <select
                  name="funcionario_id"
                  required
                  defaultValue={editing?.funcionario_id ?? actualEmployee}
                >
                  <option value="">Selecione</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.nome}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tab !== "troca" && (
              <label>
                {tab === "documento" ? "Início da vigência" : "Data inicial"}
                <input
                  name="data_inicio"
                  type="date"
                  required
                  defaultValue={editing?.data_inicio ?? `${month}-01`}
                />
              </label>
            )}
            {["ausencia", "cobertura"].includes(tab) && (
              <label>
                Data final
                <input
                  name="data_fim"
                  type="date"
                  required
                  defaultValue={editing?.data_fim ?? monthDates(month).at(-1)}
                />
              </label>
            )}
            {tab === "ausencia" && (
              <>
                <label>
                  Tipo de ausência
                  <select
                    name="categoria"
                    defaultValue={String(
                      editing?.payload.categoria ?? "indisponibilidade",
                    )}
                  >
                    <option value="indisponibilidade">Indisponibilidade</option>
                    <option value="ferias">Férias</option>
                    <option value="afastamento">Afastamento</option>
                  </select>
                </label>
                <label className="span2">
                  Motivo ou referência
                  <textarea
                    name="motivo"
                    maxLength={1000}
                    defaultValue={String(editing?.payload.motivo ?? "")}
                  />
                </label>
                <p className="span2 muted">
                  Ao conferir, o sistema indica dias com trabalho programado
                  durante a ausência. Revise a escala individualmente; não
                  haverá substituição automática.
                </p>
              </>
            )}
            {tab === "cobertura" && (
              <>
                <label>
                  Estabelecimento
                  <select
                    name="estabelecimento_id"
                    defaultValue={String(
                      editing?.payload.estabelecimento_id ?? "",
                    )}
                  >
                    <option value="">Todos da empresa</option>
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Setor (opcional)
                  <input
                    name="setor"
                    maxLength={160}
                    defaultValue={String(editing?.payload.setor ?? "")}
                  />
                </label>
                <label>
                  Cargo (opcional)
                  <input
                    name="cargo"
                    maxLength={160}
                    defaultValue={String(editing?.payload.cargo ?? "")}
                  />
                </label>
                <label>
                  Pessoas mínimas
                  <input
                    name="minimo"
                    type="number"
                    min={1}
                    max={1000}
                    required
                    defaultValue={Number(editing?.payload.minimo ?? 1)}
                  />
                </label>
                <label>
                  Início da faixa
                  <input
                    name="inicio"
                    type="time"
                    required
                    defaultValue={String(editing?.payload.inicio ?? "08:00")}
                  />
                </label>
                <label>
                  Fim da faixa
                  <input
                    name="fim"
                    type="time"
                    required
                    defaultValue={String(editing?.payload.fim ?? "18:00")}
                  />
                </label>
                <fieldset className="span2">
                  <legend>Dias da semana</legend>
                  <div className="actions">
                    {days.map((day, index) => (
                      <label className="check-label" key={day}>
                        <input
                          type="checkbox"
                          name="dia_semana"
                          value={index}
                          defaultChecked={
                            editing
                              ? (
                                  editing.payload.dias_semana as number[]
                                ).includes(index)
                              : index > 0 && index < 6
                          }
                        />
                        {day}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <p className="muted span2">
                  Se o fim for igual ou anterior ao início, a faixa termina no
                  dia seguinte. A cobertura considera pessoas distintas,
                  horários reais e ausências conferidas.
                </p>
              </>
            )}
            {tab === "troca" && (
              <>
                <label>
                  Outro funcionário
                  <select
                    name="destino_funcionario_id"
                    required
                    defaultValue={String(
                      editing?.payload.destino_funcionario_id ?? "",
                    )}
                  >
                    <option value="">Selecione</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Dia do primeiro funcionário
                  <input
                    name="data_origem"
                    type="date"
                    required
                    defaultValue={String(
                      editing?.payload.data_origem ?? `${month}-01`,
                    )}
                  />
                </label>
                <label>
                  Dia do outro funcionário
                  <input
                    name="data_destino"
                    type="date"
                    required
                    defaultValue={String(
                      editing?.payload.data_destino ?? `${month}-01`,
                    )}
                  />
                </label>
                <label className="span2">
                  Justificativa
                  <textarea
                    name="justificativa"
                    required
                    maxLength={1000}
                    defaultValue={String(editing?.payload.justificativa ?? "")}
                  />
                </label>
                <p className="span2 muted">
                  Troca a programação que começa em cada data. A solicitação
                  fica pendente; as duas escalas precisam estar salvas e
                  carregadas. Nenhum plantão é aplicado sem nova conferência.
                </p>
              </>
            )}
            {tab === "documento" && (
              <>
                <label>
                  Fim da vigência (opcional)
                  <input
                    name="vigencia_fim"
                    type="date"
                    defaultValue={String(editing?.payload.vigencia_fim ?? "")}
                  />
                </label>
                <label className="span2">
                  Fonte / publicação
                  <input
                    name="fonte"
                    required
                    maxLength={500}
                    defaultValue={String(editing?.payload.fonte ?? "")}
                  />
                </label>
                <label className="span2">
                  Referência / instrumento
                  <input
                    name="referencia"
                    maxLength={500}
                    defaultValue={String(editing?.payload.referencia ?? "")}
                  />
                </label>
                <label className="span2">
                  Endereço HTTPS do documento (opcional)
                  <input
                    name="url"
                    type="url"
                    maxLength={2048}
                    placeholder="https://..."
                    defaultValue={String(editing?.payload.url ?? "")}
                  />
                </label>
                <p className="muted span2">
                  É um vínculo de referência; o arquivo não será enviado ou
                  tornado público pelo sistema. Confira as permissões do
                  endereço escolhido. Este cadastro não confirma automaticamente
                  uma regra jurídica.
                </p>
              </>
            )}
            {tab === "realizado" && (
              <>
                <label className="span2">
                  Períodos efetivamente registrados
                  <input
                    name="periodos"
                    placeholder="08:02-12:00,13:00-17:20"
                    defaultValue={
                      editing
                        ? (
                            (editing.payload.intervalos ?? []) as {
                              start: string;
                              end: string;
                              startDay?: number;
                              endDay?: number;
                            }[]
                          )
                            .map(
                              (shift) =>
                                `${shift.start}${shift.startDay ? " +1" : ""}-${shift.end}${shift.endDay ? " +1" : ""}`,
                            )
                            .join(", ")
                        : ""
                    }
                  />
                </label>
                <label className="check-label span2">
                  <input name="sem_marcacoes" type="checkbox" />
                  Confirmo zero horas efetivamente registradas nesta data
                </label>
                <label className="span2">
                  Observação / origem
                  <textarea
                    name="observacao"
                    maxLength={1000}
                    defaultValue={String(editing?.payload.observacao ?? "")}
                  />
                </label>
                <p className="span2 muted">
                  Os horários estão em branco para registrar dados reais. Eles
                  não serão copiados do planejamento nem enviados à folha de
                  ponto para preenchimento manual.
                </p>
              </>
            )}
            <div className="actions span2 dialog-actions">
              <button
                type="button"
                className="button"
                onClick={closeForm}
                disabled={pending}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={disabled}
              >
                Salvar para conferência
              </button>
            </div>
          </form>
        )}
        {reviewSwap && swapAssessment && (
          <section className="panel mt-5" aria-label="Conferência da troca">
            <div className="panel-body">
              <h3>Conferência dos dois vínculos · {reviewSwap.titulo}</h3>
              <p>
                {swapAssessment.canApply
                  ? "Não foram encontrados impedimentos ou fontes pendentes nos parâmetros avaliados. Revise os avisos antes de aplicar."
                  : "Troca bloqueada: resolva os impedimentos e a parametrização antes de aplicar."}
              </p>
              {swapAssessment.issues.map((issue, index) => (
                <p className="warning-text" key={index}>
                  {issue}
                </p>
              ))}
              <ul>
                {swapAssessment.alerts.slice(0, 30).map((alert, index) => (
                  <li key={index}>
                    {alert.employeeName} · {dateLabel(alert.date)}:{" "}
                    {alert.message}
                  </li>
                ))}
              </ul>
              <div className="actions">
                <button
                  type="button"
                  className="button"
                  disabled={disabled}
                  onClick={() => setReviewSwap(null)}
                >
                  Fechar conferência
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={disabled}
                  onClick={() =>
                    setSuggestions(suggestSwapCandidates(data, reviewSwap))
                  }
                >
                  Sugerir alternativas para revisão
                </button>
                {onApplySwap && (
                  <button
                    type="button"
                    className="button primary"
                    disabled={
                      disabled ||
                      !swapAssessment.canApply ||
                      reviewSwap.status !== "pendente"
                    }
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Aplicar a troca nas duas escalas como rascunho? Confira os horários e os avisos de ambos os funcionários.",
                        )
                      )
                        return;
                      void perform(async () => {
                        const latest = assessSwap(data, reviewSwap);
                        if (!latest.canApply)
                          throw new Error(
                            "A troca precisa de nova conferência.",
                          );
                        await onApplySwap(latest.schedules, {
                          ...reviewSwap,
                          status: "aprovado",
                        });
                        setReviewSwap(null);
                        setNotice(
                          "Troca aplicada às duas escalas. A publicação requer o fluxo próprio de revisão.",
                        );
                      });
                    }}
                  >
                    Aplicar troca conferida
                  </button>
                )}
              </div>
              {!onApplySwap && (
                <p className="muted">
                  A consulta não aplica alterações às escalas. A aplicação
                  depende da operação autorizada das duas escalas.
                </p>
              )}
              {suggestions.length > 0 && (
                <ul>
                  {suggestions.slice(0, 10).map(({ employee, assessment }) => (
                    <li key={employee.id}>
                      {employee.nome}:{" "}
                      {assessment.canApply
                        ? "candidato sem impedimentos ou fontes pendentes"
                        : "requer revisão"}{" "}
                      · {assessment.issues.length} pendências ·{" "}
                      {assessment.alerts.length} alertas.{" "}
                      <button
                        className="button small"
                        type="button"
                        onClick={() => {
                          setEditing({
                            ...reviewSwap,
                            payload: {
                              ...reviewSwap.payload,
                              destino_funcionario_id: employee.id,
                            },
                            status: "pendente",
                          });
                          setShowForm(true);
                          setReviewSwap(null);
                          setSuggestions([]);
                        }}
                      >
                        Revisar alternativa
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}
        <div className="mt-5" aria-live="polite">
          {records.length ? (
            records.slice(0, 100).map((operation) => {
              const person = data.employees.find(
                (employee) => employee.id === operation.funcionario_id,
              );
              const conflicts =
                operation.tipo === "ausencia"
                  ? absenceConflicts(data, operation)
                  : [];
              const gaps =
                operation.tipo === "cobertura"
                  ? coverageGaps(data, operation, month)
                  : [];
              const invalid = validateCompanyOperation(operation, data);
              return (
                <article className="panel mb-3" key={operation.id}>
                  <div className="panel-body">
                    <div className="flex justify-between gap-3 flex-wrap">
                      <div>
                        <h3>{operation.titulo}</h3>
                        <p className="muted">
                          {person?.nome ?? "Empresa"} ·{" "}
                          {dateLabel(operation.data_inicio)}
                          {operation.data_fim !== operation.data_inicio
                            ? ` a ${dateLabel(operation.data_fim)}`
                            : ""}
                        </p>
                      </div>
                      <span className="pill">
                        {statuses[operation.status] ?? "Revisar situação"}
                      </span>
                    </div>
                    {invalid.length > 0 && (
                      <p className="warning-text">
                        Revisar cadastro: {invalid.join(" ")}
                      </p>
                    )}
                    {operation.tipo === "ausencia" &&
                      operation.status === "aprovado" && (
                        <p
                          className={
                            conflicts.length ? "warning-text" : "muted"
                          }
                        >
                          {conflicts.length
                            ? `${conflicts.length} dias com trabalho programado durante a ausência. Abra as escalas para ajustar.`
                            : "Nenhum conflito com escalas carregadas; ausência não altera jornadas automaticamente."}
                        </p>
                      )}
                    {conflicts.length > 0 && (
                      <details>
                        <summary>Ver datas em conflito</summary>
                        <p>
                          {conflicts
                            .map((item) => dateLabel(item.date))
                            .join(", ")}
                        </p>
                        {onOpenEmployee && operation.funcionario_id && (
                          <div className="actions">
                            {conflicts.slice(0, 10).map((item) => (
                              <button
                                type="button"
                                className="button small"
                                key={item.date}
                                onClick={() =>
                                  onOpenEmployee(
                                    operation.funcionario_id!,
                                    item.date,
                                  )
                                }
                              >
                                Abrir escala de {dateLabel(item.date)}
                              </button>
                            ))}
                          </div>
                        )}
                      </details>
                    )}
                    {operation.tipo === "cobertura" &&
                      operation.status === "aprovado" && (
                        <details open={gaps.length > 0}>
                          <summary>
                            {gaps.length
                              ? `${gaps.length} faixas abaixo da cobertura mínima`
                              : "Nenhuma lacuna nas escalas carregadas"}
                          </summary>
                          <ul>
                            {gaps.slice(0, 25).map((gap, index) => (
                              <li key={index}>
                                {dateLabel(gap.date)} · {gap.from.slice(11, 16)}
                                –{gap.to.slice(11, 16)}
                                {gap.to.slice(0, 10) !== gap.date
                                  ? " (+1)"
                                  : ""}
                                : {gap.scheduled}/{gap.needed} pessoas
                              </li>
                            ))}
                          </ul>
                          {gaps.length > 25 && (
                            <p className="muted">
                              Mostrando as primeiras 25 faixas.
                            </p>
                          )}
                        </details>
                      )}
                    {operation.tipo === "documento" && (
                      <>
                        <p>
                          Fonte: {String(operation.payload.fonte ?? "")} ·
                          Referência:{" "}
                          {String(operation.payload.referencia ?? "")}
                        </p>
                        {typeof operation.payload.vigencia_fim === "string" &&
                          operation.payload.vigencia_fim < `${month}-01` && (
                            <p className="warning-text">
                              Vigência encerrada antes desta competência.
                              Confira um documento atualizado.
                            </p>
                          )}
                        {typeof operation.payload.vigencia_fim === "string" &&
                          operation.payload.vigencia_fim >= `${month}-01` &&
                          operation.payload.vigencia_fim <=
                            monthDates(month).at(-1)! && (
                            <p className="warning-text">
                              A vigência termina nesta competência; programe a
                              revisão do documento.
                            </p>
                          )}
                        {operation.payload.vigencia_fim && (
                          <p className="muted">
                            Vigência até{" "}
                            {dateLabel(String(operation.payload.vigencia_fim))}
                          </p>
                        )}
                        {(() => {
                          try {
                            const url = safeDocumentUrl(operation.payload.url);
                            return url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="button small"
                              >
                                Consultar documento externo
                              </a>
                            ) : null;
                          } catch {
                            return (
                              <p className="warning-text">
                                Endereço do documento inválido.
                              </p>
                            );
                          }
                        })()}
                      </>
                    )}
                    {operation.tipo === "realizado" && (
                      <p className="muted">
                        Origem:{" "}
                        {operation.payload.origem === "importacao"
                          ? "arquivo importado"
                          : "declaração manual"}
                        . Sem apuração automática de pagamento.
                      </p>
                    )}
                    <div className="actions mt-3">
                      <button
                        type="button"
                        className="button small"
                        disabled={disabled || operation.status === "aprovado"}
                        onClick={() => {
                          setEditing(operation);
                          setShowForm(true);
                          setError("");
                        }}
                      >
                        Editar
                      </button>
                      {operation.status === "pendente" && (
                        <button
                          type="button"
                          className="button small"
                          disabled={disabled}
                          onClick={() => review(operation)}
                        >
                          {operation.tipo === "troca"
                            ? "Avaliar os dois vínculos"
                            : "Conferir registro"}
                        </button>
                      )}
                      {operation.status !== "cancelado" && (
                        <button
                          type="button"
                          className="button small"
                          disabled={disabled}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Cancelar “${operation.titulo}”? Escalas já salvas não serão desfeitas.`,
                              )
                            )
                              return;
                            void perform(() =>
                              onSave({ ...operation, status: "cancelado" }),
                            );
                          }}
                        >
                          Cancelar registro
                        </button>
                      )}
                      <button
                        type="button"
                        className="button small"
                        disabled={disabled || operation.status !== "pendente"}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Excluir o registro pendente “${operation.titulo}”?`,
                            )
                          )
                            void perform(() => onRemove(operation.id));
                        }}
                      >
                        Excluir pendente
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          ) : (
            <p className="muted">
              Nenhum registro desta seção corresponde à competência e aos
              filtros.
            </p>
          )}
          {records.length > 100 && (
            <p className="muted">
              Mostrando os primeiros 100 resultados. Refine a pesquisa.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
