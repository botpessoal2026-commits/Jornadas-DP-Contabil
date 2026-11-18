"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Data } from "@/lib/store";
import { addDays, formatMinutes, monthDates } from "@/lib/engine";
import { reviewBulkSchedules } from "@/lib/schedule-bulk";
import {
  prepareRestRotation,
  rotationCandidates,
  rotationCoverage,
  rotationData,
  rotationPhase,
  type RotationGroup,
  type RotationPlan,
} from "@/lib/rest-rotation";
import { workRestDate } from "@/lib/work-rest-report";
import CompanyCoverage from "./company-coverage";

export default function RestRotation({
  data,
  companyId,
  month,
  busy = false,
  onSave,
  onDirtyChange,
}: {
  data: Data;
  companyId: string | null;
  month: string;
  busy?: boolean;
  onSave: (plan: RotationPlan) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const candidates = rotationCandidates(data, companyId);
  const eligible = candidates.filter((item) => item.model?.tipo === "12x36");
  const initial =
    eligible
      .map((item) => item.model?.ciclo_inicio)
      .filter((date): date is string => !!date)
      .sort()[0] ?? `${month}-01`;
  const [reference, setReference] = useState(initial);
  const [selection, setSelection] = useState<string[]>([]);
  const [groups, setGroups] = useState<Record<string, RotationGroup>>({});
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<{
    key: string;
    plan: RotationPlan;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const allowed = new Set(eligible.map((item) => item.employee.id));
  const selected = selection.filter((id) => allowed.has(id));
  const groupFor = (id: string) =>
    groups[id] ??
    rotationPhase(
      eligible.find((item) => item.employee.id === id)?.model?.ciclo_inicio ??
        reference,
      reference,
    );
  const key = JSON.stringify([
    companyId,
    month,
    reference,
    selected.map((id) => [id, groupFor(id)]),
  ]);
  const current = useRef(key);
  current.current = key;
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  const plan = preview?.key === key ? preview.plan : null;
  const hasPreview = !!plan;
  const callback = useRef(onDirtyChange);
  callback.current = onDirtyChange;
  useEffect(() => {
    callback.current(hasPreview);
    return () => callback.current(false);
  }, [hasPreview]);
  const review = useMemo(
    () =>
      plan ? reviewBulkSchedules(rotationData(data, plan), plan.schedules) : [],
    [data, plan],
  );
  const structuralErrors = review.some((item) => item.error);
  const coverage = useMemo(() => (plan ? rotationCoverage(plan) : []), [plan]);
  const locked = busy || pending;
  const selectingLocked = locked || hasPreview;
  const normalized = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR");
  const filtered = candidates.filter(({ employee }) =>
    normalized(`${employee.nome} ${employee.setor ?? ""}`).includes(
      normalized(query),
    ),
  );
  const groupCount = (group: RotationGroup) =>
    selected.filter((id) => groupFor(id) === group).length;
  function generate() {
    setError("");
    setMessage("");
    try {
      if (!companyId) throw new Error("Selecione uma empresa ativa.");
      const result = prepareRestRotation(
        data,
        companyId,
        month,
        reference,
        selected.map((employeeId) => ({
          employeeId,
          group: groupFor(employeeId),
        })),
      );
      reviewBulkSchedules(rotationData(data, result), result.schedules);
      setPreview({ key, plan: result });
      setConfirmed(false);
      setMessage(
        "Prévia preparada. Confira os grupos, a cobertura e os alertas antes de salvar.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível preparar o revezamento.",
      );
    }
  }
  async function save() {
    if (!plan || !confirmed || locked || structuralErrors) return;
    const sequence = ++request.current,
      expected = key;
    setPending(true);
    setError("");
    setMessage("");
    try {
      await onSave(plan);
      if (request.current !== sequence || current.current !== expected) return;
      setPreview(null);
      setConfirmed(false);
      setMessage(
        "Revezamento salvo. Os modelos individuais dos grupos serão usados nas próximas gerações. Confira as regras e a CCT antes de aprovar.",
      );
    } catch (cause) {
      if (request.current === sequence && current.current === expected)
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível salvar. A prévia foi preservada.",
        );
    } finally {
      if (request.current === sequence) setPending(false);
    }
  }
  return (
    <section className="panel" aria-label="Revezamento de folgas 12×36">
      <div className="panel-head">
        <div>
          <h2>Revezamento de folgas 12×36</h2>
          <p className="subtitle !mt-1">
            Enquanto um grupo folga, o outro inicia seus plantões.
          </p>
        </div>
      </div>
      <div className="panel-body">
        {!companyId || !candidates.length ? (
          <p className="muted">
            Selecione uma empresa ativa com funcionários cadastrados. Vincule um
            modelo 12×36 aos funcionários que participarão do revezamento.
          </p>
        ) : (
          <>
            <p className="muted">
              Os horários e intervalos de cada modelo são preservados. O grupo A
              usa a data de referência; o grupo B começa no dia seguinte. A
              alternância continua entre meses. Contratos, folgas individuais,
              feriados, regras legais e avisos de CCT continuam sendo
              conferidos.
            </p>
            <div className="filters mt-4">
              <label>
                Primeiro plantão do grupo A
                <input
                  type="date"
                  value={reference}
                  max={monthDates(month).at(-1)}
                  disabled={selectingLocked}
                  onChange={(event) => setReference(event.target.value)}
                />
              </label>
              <label>
                Pesquisar funcionários do revezamento
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Nome ou setor"
                />
              </label>
            </div>
            <p className="muted mt-3">
              Competência: {month} · Grupo B:{" "}
              {reference && Number.isFinite(+new Date(reference))
                ? workRestDate(addDays(reference, 1))
                : "confira a referência"}{" "}
              · Grupo A: {groupCount("A")} pessoa(s) · Grupo B:{" "}
              {groupCount("B")} pessoa(s)
            </p>
            <div className="actions mt-3">
              <button
                className="button small"
                disabled={selectingLocked || !eligible.length}
                onClick={() =>
                  setSelection(
                    filtered
                      .filter((item) => item.model?.tipo === "12x36")
                      .map((item) => item.employee.id),
                  )
                }
              >
                Selecionar funcionários 12×36
              </button>
              <button
                className="button small"
                disabled={selectingLocked || selected.length < 2}
                onClick={() =>
                  setGroups((currentGroups) => ({
                    ...currentGroups,
                    ...Object.fromEntries(
                      selected.map((id, index) => [
                        id,
                        index % 2 === 0 ? "A" : "B",
                      ]),
                    ),
                  }))
                }
              >
                Distribuir grupos A e B
              </button>
              <button
                className="button small"
                disabled={selectingLocked || !selected.length}
                onClick={() => setSelection([])}
              >
                Limpar seleção do revezamento
              </button>
            </div>
            <div className="rotation-people mt-4">
              {filtered.map(({ employee, model }) => (
                <div className="rotation-person" key={employee.id}>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      disabled={selectingLocked || model?.tipo !== "12x36"}
                      checked={selected.includes(employee.id)}
                      onChange={(event) =>
                        setSelection((currentSelection) =>
                          event.target.checked
                            ? [...currentSelection, employee.id]
                            : currentSelection.filter(
                                (id) => id !== employee.id,
                              ),
                        )
                      }
                    />
                    <span>
                      {employee.nome}
                      <small className="block muted">
                        {model?.nome ?? "Sem modelo"}
                        {model?.tipo !== "12x36"
                          ? " · vincule um modelo 12×36"
                          : ""}
                      </small>
                    </span>
                  </label>
                  {model?.tipo === "12x36" && (
                    <label>
                      Grupo de {employee.nome}
                      <select
                        disabled={
                          selectingLocked || !selected.includes(employee.id)
                        }
                        value={groupFor(employee.id)}
                        onChange={(event) =>
                          setGroups((currentGroups) => ({
                            ...currentGroups,
                            [employee.id]: event.target.value as RotationGroup,
                          }))
                        }
                      >
                        <option value="A">Grupo A</option>
                        <option value="B">Grupo B</option>
                      </select>
                    </label>
                  )}
                </div>
              ))}
            </div>
            <div className="actions mt-4">
              <button
                className="button primary"
                disabled={selectingLocked || selected.length < 2}
                onClick={generate}
              >
                Gerar prévia do revezamento
              </button>
            </div>
          </>
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
        {plan && (
          <>
            <h3 className="mt-5">Conferência do revezamento</h3>
            <p className="muted mt-2">
              Ao salvar, cópias dos modelos dos grupos serão criadas quando
              necessário e vinculadas aos funcionários. Os modelos originais e
              as escalas de outros meses permanecem preservados. Escalas
              bloqueadas exigem reabertura. O salvamento não aprova nem publica.
            </p>
            <div className="table-wrap mt-4">
              <table>
                <caption className="sr-only">Prévias dos grupos A e B</caption>
                <thead>
                  <tr>
                    <th scope="col">Funcionário</th>
                    <th scope="col">Grupo</th>
                    <th scope="col">Horas de relógio</th>
                    <th scope="col">Impedimentos</th>
                    <th scope="col">Avisos</th>
                    <th scope="col">Fontes pendentes</th>
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
                      <td>
                        {
                          plan.assignments.find(
                            (item) =>
                              item.employeeId === row.schedule.funcionario_id,
                          )?.group
                        }
                      </td>
                      <td>{row.error ? "—" : formatMinutes(row.clockTotal)}</td>
                      <td>{row.violations}</td>
                      <td>{row.attention}</td>
                      <td>{row.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CompanyCoverage
              data={rotationData(data, plan)}
              companyId={companyId}
              month={month}
              schedules={plan.schedules}
              defaultOpen
            />
            <details className="mt-4">
              <summary>Ver quem trabalha e quem folga em cada dia</summary>
              <p className="muted mt-3">
                Plantões contados pela data de início; turnos noturnos continuam
                no dia seguinte. Folgas, dispensas e exceções podem alterar a
                cobertura. Confira horários e funções da equipe.
              </p>
              <div className="rotation-coverage mt-3">
                {coverage.map((day) => (
                  <article className="work-rest-card" key={day.date}>
                    <h4>{workRestDate(day.date)}</h4>
                    <p>
                      {day.work.length} plantão(ões) iniciam · {day.rest.length}{" "}
                      sem início de plantão
                    </p>
                    <p className="muted">
                      Trabalham: {day.work.join(", ") || "Ninguém"}
                    </p>
                    <p className="muted">
                      Folga / sem expediente: {day.rest.join(", ") || "Ninguém"}
                    </p>
                    {!!day.missing.length && (
                      <p className="warning-text">
                        Sem escala: {day.missing.join(", ")}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </details>
            <label className="check-label mt-5">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={locked || structuralErrors}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              Conferi os grupos e autorizo vincular seus modelos aos
              funcionários e substituir somente as escalas selecionadas nesta
              competência.
            </label>
            <div className="actions mt-4">
              <button
                className="button primary"
                disabled={locked || !confirmed || structuralErrors}
                onClick={() => void save()}
              >
                {pending
                  ? "Salvando revezamento…"
                  : "Salvar revezamento sem aprovar"}
              </button>
              <button
                className="button"
                disabled={locked}
                onClick={() => setDiscard(true)}
              >
                Descartar prévia do revezamento
              </button>
            </div>
            {discard && (
              <div className="banner mt-3" role="alert">
                <div>
                  <p>
                    Descartar a prévia do revezamento? Os cadastros e as escalas
                    salvas serão preservados.
                  </p>
                  <div className="actions mt-3">
                    <button
                      className="button"
                      onClick={() => setDiscard(false)}
                    >
                      Continuar no revezamento
                    </button>
                    <button
                      className="button"
                      onClick={() => {
                        setPreview(null);
                        setDiscard(false);
                        setConfirmed(false);
                        setMessage(
                          "Prévia descartada. Nenhum registro salvo foi alterado.",
                        );
                      }}
                    >
                      Confirmar descarte do revezamento
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
