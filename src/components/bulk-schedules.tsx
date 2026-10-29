"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, RefreshCw, RotateCcw, RotateCw } from "lucide-react";
import { formatMinutes, monthDates } from "@/lib/engine";
import { applyBulkDayChanges, reviewBulkSchedules } from "@/lib/schedule-bulk";
import { validateShiftText } from "@/lib/shift-editor";
import type { Data } from "@/lib/store";
import type { Schedule } from "@/lib/types";

type BulkSchedulesProps = {
  data: Data;
  companyId: string | null;
  month: string;
  onGenerate: (employeeIds: string[], month: string) => Promise<Schedule[]>;
  onDuplicate?: (employeeIds: string[], month: string) => Promise<Schedule[]>;
  onSave: (schedules: Schedule[]) => Promise<void>;
  onExport?: (schedules: Schedule[]) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  busy?: boolean;
};

const noSchedules: Schedule[] = [];

function searchValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

/** Batch changes remain previews until a separate, explicit save confirmation. */
export default function BulkSchedules({
  data,
  companyId,
  month,
  onGenerate,
  onDuplicate,
  onSave,
  onExport,
  onDirtyChange,
  busy = false,
}: BulkSchedulesProps) {
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("");
  const [unit, setUnit] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [targetMonth, setTargetMonth] = useState(month);
  const [preview, setPreview] = useState<{
    context: string;
    schedules: Schedule[];
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [history, setHistory] = useState<Schedule[][]>([]);
  const [future, setFuture] = useState<Schedule[][]>([]);
  const [discardRequested, setDiscardRequested] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [changeKind, setChangeKind] = useState("work");
  const [shiftText, setShiftText] = useState("08:00-12:00, 13:00-17:00");
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  const company = data.companies.find((entry) => entry.id === companyId);
  const candidates = useMemo(
    () =>
      data.employees.filter(
        (employee) =>
          employee.empresa_id === companyId &&
          employee.situacao !== "inativo" &&
          (company?.situacao ?? "ativa") === "ativa",
      ),
    [data.employees, companyId, company?.situacao],
  );
  const allowed = new Set(candidates.map((employee) => employee.id));
  const selected = selection.filter((id) => allowed.has(id));
  const selectionKey = [...selected].sort().join(",");
  const context = `${companyId}:${targetMonth}:${selectionKey}`;
  const activeContext = useRef(context);
  activeContext.current = context;
  const schedules =
    preview?.context === context ? preview.schedules : noSchedules;
  const hasPreview = schedules.length > 0;
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  useEffect(() => {
    dirtyCallback.current?.(hasPreview);
    return () => dirtyCallback.current?.(false);
  }, [hasPreview]);
  useEffect(() => {
    if (!hasPreview) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasPreview]);
  const review = useMemo(
    () => (schedules.length ? reviewBulkSchedules(data, schedules) : []),
    [data, schedules],
  );
  const queryText = searchValue(query);
  const filtered = candidates.filter(
    (employee) =>
      (!queryText ||
        searchValue(
          `${employee.nome} ${employee.matricula ?? ""} ${employee.setor ?? ""}`,
        ).includes(queryText)) &&
      (!sector || employee.setor === sector) &&
      (!unit || employee.estabelecimento_id === unit),
  );
  const sectors = [
    ...new Set(
      candidates.flatMap((employee) =>
        employee.setor ? [employee.setor] : [],
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const locked = pending || busy;
  const selectingLocked = locked || hasPreview;
  const validMonth = /^(19\d\d|20\d\d|21\d\d|2200)-(0[1-9]|1[0-2])$/.test(
    targetMonth,
  );
  const dates = validMonth ? monthDates(targetMonth) : [];
  const editStart = dates.includes(start) ? start : (dates[0] ?? "");
  const editEnd = dates.includes(end) ? end : editStart;
  const totals = review.reduce(
    (sum, row) => ({
      violations: sum.violations + row.violations,
      attention: sum.attention + row.attention,
      pending: sum.pending + row.pending,
      errors: sum.errors + (row.error ? 1 : 0),
    }),
    { violations: 0, attention: 0, pending: 0, errors: 0 },
  );

  async function generate(mode: "generate" | "duplicate") {
    if (locked || !company || !selected.length || !validMonth) return;
    const expected = context;
    const id = ++request.current;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const items = await (
        mode === "duplicate" && onDuplicate ? onDuplicate : onGenerate
      )(selected, targetMonth);
      if (request.current !== id || activeContext.current !== expected) return;
      if (!items.length)
        throw new Error(
          "Nenhuma prévia foi gerada. Confira os modelos dos funcionários selecionados.",
        );
      if (
        items.some(
          (item) =>
            item.empresa_id !== companyId ||
            !selected.includes(item.funcionario_id) ||
            item.mes.slice(0, 7) !== targetMonth,
        )
      )
        throw new Error("O resultado não corresponde à seleção deste lote.");
      reviewBulkSchedules(data, items);
      setPreview({ context: expected, schedules: items });
      setHistory([]);
      setFuture([]);
      setConfirmed(false);
      setMessage(
        `${items.length} prévia(s) preparadas. Confira o lote antes de salvar.`,
      );
    } catch (cause) {
      if (request.current === id && activeContext.current === expected)
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível gerar o lote.",
        );
    } finally {
      if (request.current === id) setPending(false);
    }
  }

  function changeDays() {
    setError("");
    try {
      if (editEnd < editStart)
        throw new Error("A data final deve ser igual ou posterior à inicial.");
      const chosen = dates.filter(
        (date) => date >= editStart && date <= editEnd,
      );
      const validation =
        changeKind === "rest" ? null : validateShiftText(shiftText);
      if (
        validation &&
        (!validation.shifts || Object.keys(validation.errors).length)
      )
        throw new Error(
          Object.values(validation.errors).join(" ") ||
            "Confira os períodos de trabalho.",
        );
      const changed = schedules.map((schedule) =>
        applyBulkDayChanges(schedule, chosen, validation?.shifts ?? null),
      );
      setHistory((current) => [...current.slice(-19), schedules]);
      setFuture([]);
      setPreview({ context, schedules: changed });
      setConfirmed(false);
      setMessage(
        `Alteração aplicada a ${chosen.length} dia(s) de ${changed.length} prévia(s). Confira os novos alertas.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível aplicar a alteração.",
      );
    }
  }

  async function save() {
    if (locked || !confirmed || !schedules.length || totals.errors) return;
    const expected = context;
    const id = ++request.current;
    setPending(true);
    setError("");
    setMessage("");
    try {
      await onSave(schedules);
      if (request.current !== id || activeContext.current !== expected) return;
      setPreview(null);
      setHistory([]);
      setFuture([]);
      setConfirmed(false);
      setMessage(
        "Lote salvo. O salvamento não representa aprovação ou publicação.",
      );
    } catch (cause) {
      if (request.current === id && activeContext.current === expected)
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível salvar o lote. As prévias foram preservadas.",
        );
    } finally {
      if (request.current === id) setPending(false);
    }
  }

  return (
    <section className="panel" aria-label="Operações em lote de escalas">
      <div className="panel-head">
        <div>
          <h2>Operações em lote</h2>
          <p className="subtitle !mt-1">
            Gerar, duplicar, conferir e salvar pessoas selecionadas.
          </p>
        </div>
      </div>
      <div className="panel-body">
        {!company ? (
          <p className="muted">
            Selecione uma empresa ativa no topo para preparar um lote.
          </p>
        ) : (
          <>
            <div className="filters">
              <label>
                Pesquisar funcionários do lote
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Nome, matrícula ou setor"
                />
              </label>
              <label>
                Setor do lote
                <select
                  value={sector}
                  onChange={(event) => setSector(event.target.value)}
                >
                  <option value="">Todos os setores</option>
                  {sectors.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Estabelecimento do lote
                <select
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                >
                  <option value="">Todos os estabelecimentos</option>
                  {(data.establishments ?? [])
                    .filter((entry) => entry.empresa_id === companyId)
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.nome}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Competência de destino
                <input
                  type="month"
                  min="1900-01"
                  max="2200-12"
                  value={targetMonth}
                  disabled={selectingLocked}
                  onChange={(event) => {
                    setTargetMonth(event.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
            </div>
            <div className="actions mt-4">
              <button
                type="button"
                className="button small"
                disabled={selectingLocked || !filtered.length}
                onClick={() =>
                  setSelection((current) => [
                    ...new Set([
                      ...current,
                      ...filtered.map((employee) => employee.id),
                    ]),
                  ])
                }
              >
                Selecionar resultados
              </button>
              <button
                type="button"
                className="button small"
                disabled={selectingLocked || !selected.length}
                onClick={() => setSelection([])}
              >
                Limpar seleção
              </button>
              <span className="muted" role="status">
                {selected.length} selecionado(s) · {filtered.length}{" "}
                resultado(s)
              </span>
            </div>
            <div
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 max-h-64 overflow-auto rounded-lg border border-[#dbe5f1] p-3"
              aria-label="Funcionários do lote"
            >
              {filtered.map((employee) => (
                <label key={employee.id} className="check-label">
                  <input
                    type="checkbox"
                    checked={selected.includes(employee.id)}
                    disabled={selectingLocked}
                    onChange={(event) =>
                      setSelection((current) =>
                        event.target.checked
                          ? [...current, employee.id]
                          : current.filter((id) => id !== employee.id),
                      )
                    }
                  />
                  <span>
                    {employee.nome}
                    {employee.setor ? ` · ${employee.setor}` : ""}
                  </span>
                </label>
              ))}
              {!filtered.length && (
                <p className="muted">
                  Nenhum funcionário ativo corresponde aos filtros.
                </p>
              )}
            </div>
            <p className="muted mt-3">
              Cada funcionário usa seu modelo e suas regras. Eventos e exceções
              individuais são conferidos separadamente. Gerar prévias não salva
              nem aprova escalas.
            </p>
            <div className="actions mt-4">
              <button
                type="button"
                className="button primary"
                disabled={selectingLocked || !selected.length || !validMonth}
                onClick={() => void generate("generate")}
              >
                <RefreshCw size={15} aria-hidden="true" />
                Gerar prévias do lote
              </button>
              {onDuplicate && (
                <button
                  type="button"
                  className="button"
                  disabled={selectingLocked || !selected.length || !validMonth}
                  onClick={() => void generate("duplicate")}
                >
                  <Copy size={15} aria-hidden="true" />
                  Duplicar selecionados
                </button>
              )}
            </div>
          </>
        )}
        {error && (
          <p className="banner error mt-4" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="muted mt-4" role="status">
            {message}
          </p>
        )}
        {schedules.length > 0 && (
          <>
            <div className="actions mt-4">
              <p className="muted">
                Seleção preservada enquanto há prévias. Salve ou descarte para
                preparar outro lote.
              </p>
              <button
                type="button"
                className="button small"
                disabled={locked}
                onClick={() => setDiscardRequested(true)}
              >
                Descartar prévias do lote
              </button>
            </div>
            {discardRequested && (
              <div className="banner mt-3" role="alert">
                <div>
                  <p>
                    Descartar todas as prévias deste lote? As escalas salvas
                    permanecem preservadas.
                  </p>
                  <div className="actions mt-3">
                    <button
                      type="button"
                      className="button"
                      onClick={() => setDiscardRequested(false)}
                    >
                      Continuar no lote
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        setPreview(null);
                        setHistory([]);
                        setFuture([]);
                        setConfirmed(false);
                        setDiscardRequested(false);
                        setMessage(
                          "Prévias do lote descartadas. Nenhuma escala salva foi alterada.",
                        );
                      }}
                    >
                      Confirmar descarte do lote
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className="table-wrap mt-5">
              <table>
                <caption className="sr-only">
                  Conferência das prévias selecionadas
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Funcionário</th>
                    <th scope="col">Horas de relógio</th>
                    <th scope="col">Horas computadas</th>
                    <th scope="col">Impedimentos</th>
                    <th scope="col">Avisos</th>
                    <th scope="col">Pendências</th>
                  </tr>
                </thead>
                <tbody>
                  {review.map((row) => (
                    <tr key={row.schedule.funcionario_id}>
                      <th scope="row">
                        {row.employeeName}
                        {row.error && (
                          <p className="warning-text">{row.error}</p>
                        )}
                      </th>
                      <td>{row.error ? "—" : formatMinutes(row.clockTotal)}</td>
                      <td>{row.error ? "—" : formatMinutes(row.total)}</td>
                      <td>{row.violations}</td>
                      <td>{row.attention}</td>
                      <td>{row.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="mt-5 rounded-lg border border-[#dbe5f1] p-4">
              <summary className="font-semibold">
                Editar dias das prévias em lote
              </summary>
              <p className="muted mt-3">
                Aplica uma exceção individual nos dias escolhidos de todas as
                prévias deste lote. Os horários originais e os feriados
                permanecem identificados. A conferência é recalculada.
              </p>
              <div className="filters mt-3">
                <label>
                  Primeiro dia
                  <input
                    type="date"
                    min={dates[0]}
                    max={dates.at(-1)}
                    value={editStart}
                    disabled={locked}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </label>
                <label>
                  Último dia
                  <input
                    type="date"
                    min={editStart}
                    max={dates.at(-1)}
                    value={editEnd}
                    disabled={locked}
                    onChange={(event) => setEnd(event.target.value)}
                  />
                </label>
                <label>
                  Aplicar
                  <select
                    value={changeKind}
                    disabled={locked}
                    onChange={(event) => setChangeKind(event.target.value)}
                  >
                    <option value="work">Trabalho</option>
                    <option value="rest">Folga</option>
                  </select>
                </label>
                {changeKind === "work" && (
                  <label>
                    Períodos de trabalho
                    <input
                      value={shiftText}
                      disabled={locked}
                      onChange={(event) => setShiftText(event.target.value)}
                      placeholder="08:00-12:00, 13:00-17:00"
                    />
                  </label>
                )}
              </div>
              <div className="actions mt-3">
                <button
                  type="button"
                  className="button"
                  disabled={locked}
                  onClick={changeDays}
                >
                  Aplicar aos dias escolhidos
                </button>
                <button
                  type="button"
                  className="button small"
                  disabled={locked || !history.length}
                  onClick={() => {
                    setFuture((current) => [...current, schedules]);
                    setPreview({
                      context,
                      schedules: history[history.length - 1],
                    });
                    setHistory((current) => current.slice(0, -1));
                    setConfirmed(false);
                  }}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  Desfazer no lote
                </button>
                <button
                  type="button"
                  className="button small"
                  disabled={locked || !future.length}
                  onClick={() => {
                    setHistory((current) => [...current, schedules]);
                    setPreview({
                      context,
                      schedules: future[future.length - 1],
                    });
                    setFuture((current) => current.slice(0, -1));
                    setConfirmed(false);
                  }}
                >
                  <RotateCw size={15} aria-hidden="true" />
                  Refazer no lote
                </button>
              </div>
            </details>
            <p className="muted mt-4">
              {totals.violations} grupo(s) de impedimentos · {totals.attention}{" "}
              grupo(s) de avisos · {totals.pending} grupo(s) de fontes/regras
              pendentes. Salvar mantém essas ocorrências e não aprova o lote.
            </p>
            <label className="check-label mt-4">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={locked || !!totals.errors}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              Conferi as {schedules.length} prévias e autorizo substituir as
              escalas desta seleção na competência de destino.
            </label>
            <div className="actions mt-4">
              <button
                type="button"
                className="button primary"
                disabled={locked || !confirmed || !!totals.errors}
                onClick={() => void save()}
              >
                {pending ? "Processando lote…" : "Salvar lote sem aprovar"}
              </button>
              {onExport && (
                <button
                  type="button"
                  className="button"
                  disabled={locked || !!totals.errors}
                  onClick={async () => {
                    setPending(true);
                    setError("");
                    try {
                      await onExport(schedules);
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Não foi possível exportar o lote.",
                      );
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  <Download size={15} aria-hidden="true" />
                  Exportar lote
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
