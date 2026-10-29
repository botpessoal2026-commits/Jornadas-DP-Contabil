"use client";
import { useId, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
  Info,
} from "lucide-react";
import type { AlertGroup, AlertOccurrence, AlertSummary } from "@/lib/alerts";
import { classificationLabels } from "@/lib/validation-policy";

function dateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
function periodLabel(occurrence: AlertOccurrence) {
  return occurrence.period
    ? `${dateLabel(occurrence.period.start)} a ${dateLabel(occurrence.period.end)}`
    : dateLabel(occurrence.date);
}
function countLabel(groups: number, occurrences: number) {
  return `${groups} ${groups === 1 ? "grupo" : "grupos"} · ${occurrences} ${occurrences === 1 ? "ocorrência" : "ocorrências"}`;
}
type Props = {
  summary: AlertSummary;
  onSelect: (date: string) => void;
  onConfigure: () => void;
  onEmployeeReview?: () => void;
};

function Group({
  group,
  onSelect,
  onConfigure,
  onEmployeeReview,
}: Props & { group: AlertGroup }) {
  const resolve = () => {
    if (group.action === "rules") onConfigure();
    else if (group.action === "employee") onEmployeeReview?.();
    else onSelect(group.occurrences[0].date);
  };
  const actionLabel =
    group.action === "rules"
      ? `Conferir regra: ${group.rule}`
      : group.action === "employee"
        ? "Revisar contrato do funcionário"
        : group.classification === "informativo"
          ? `Ver dia: ${group.title}`
          : `Resolver: ${group.title}`;
  return (
    <article
      className={`alert-group ${group.category.replace("_", "-")}`}
      data-alert-id={group.id}
      data-alert-code={group.code}
      data-rule-id={group.ruleId}
    >
      <div className="alert-group-heading">
        <h4>{group.title}</h4>
        <span className="pill neutral">
          {classificationLabels[group.classification]}
        </span>
        <span className="alert-count">
          {group.count} {group.count === 1 ? "ocorrência" : "ocorrências"}
        </span>
      </div>
      <p className="alert-context">
        {group.companyName}
        {group.employeeName ? ` · ${group.employeeName}` : ""}
      </p>
      <details
        className="alert-group-details"
        open={group.category === "violation" ? true : undefined}
      >
        <summary>Detalhes e orientação</summary>
        <p>{group.message}</p>
        <p className="alert-suggestion">{group.suggestedAction}</p>
        <p className="alert-period">
          <strong>Data / período:</strong> {periodLabel(group.occurrences[0])}
          {group.count > 1 ? " e demais ocorrências abaixo" : ""}
        </p>
        <details className="alert-rule-details">
          <summary>Regra e fonte</summary>
          <p>
            <strong>{group.rule}</strong>
          </p>
          <p className="alert-source">{group.source}</p>
        </details>
      </details>
      {(group.action !== "employee" || onEmployeeReview) && (
        <button
          type="button"
          className="button small alert-resolve"
          onClick={resolve}
        >
          <ChevronRight size={15} aria-hidden="true" />
          {actionLabel}
        </button>
      )}
      {group.count > 1 && (
        <details className="alert-occurrences">
          <summary>Ver {group.count} ocorrências e períodos</summary>
          <ul>
            {group.occurrences.map((occurrence) => (
              <li key={occurrence.id} data-occurrence-id={occurrence.id}>
                <p>
                  <strong>{periodLabel(occurrence)}</strong>
                </p>
                <p>{occurrence.message}</p>
                {group.action === "day" || group.action === "period" ? (
                  <button
                    type="button"
                    className="button small"
                    onClick={() => onSelect(occurrence.date)}
                  >
                    Editar {dateLabel(occurrence.date)}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

export default function ScheduleAlerts(props: Props) {
  const { summary } = props;
  const headingId = useId();
  const [nextProblem, setNextProblem] = useState(0);
  const problems = [
    ...new Set(
      [...summary.violations, ...summary.attention].flatMap((group) =>
        group.occurrences.map((occurrence) => occurrence.date),
      ),
    ),
  ].sort();
  return (
    <section className="schedule-alerts" aria-label="Conferência da escala">
      {problems.length > 0 && (
        <div className="alert-overview" aria-label="Resumo das ocorrências">
          <span>
            <strong>{summary.counts.violations}</strong> bloqueante(s) ·{" "}
            <strong>{summary.counts.attention}</strong> de atenção ·{" "}
            <strong>{summary.informative.length}</strong> informativo(s) ·{" "}
            <strong>{summary.counts.pendingSources}</strong> pendência(s) de
            fonte
          </span>
          <button
            type="button"
            className="button small"
            onClick={() => {
              props.onSelect(problems[nextProblem % problems.length]);
              setNextProblem((current) => current + 1);
            }}
          >
            Próximo problema <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      {summary.violations.length ? (
        <section
          className="alert-section violation"
          aria-labelledby={`${headingId}-violations`}
        >
          <div className="alert-section-heading">
            <h3 id={`${headingId}-violations`}>
              <AlertTriangle size={19} aria-hidden="true" />
              Bloqueantes
            </h3>
            <p>
              {countLabel(
                summary.counts.violations,
                summary.occurrenceCounts.violations,
              )}
            </p>
          </div>
          {summary.violations.map((group) => (
            <Group key={group.id} {...props} group={group} />
          ))}
        </section>
      ) : (
        <p className="alert-clear-row" role="status">
          <Check size={17} className="alert-clear-icon" aria-hidden="true" />
          Sem violações impeditivas
        </p>
      )}
      {summary.attention.length ? (
        <section
          className="alert-section attention"
          aria-labelledby={`${headingId}-attention`}
        >
          <div className="alert-section-heading">
            <h3 id={`${headingId}-attention`}>
              <AlertTriangle size={19} aria-hidden="true" />
              Atenção
            </h3>
            <p>
              {countLabel(
                summary.counts.attention,
                summary.occurrenceCounts.attention,
              )}
            </p>
          </div>
          {summary.attention.map((group) => (
            <Group key={group.id} {...props} group={group} />
          ))}
        </section>
      ) : (
        <p className="alert-clear-row" role="status">
          <Check size={17} className="alert-clear-icon" aria-hidden="true" />
          Sem alertas de atenção
        </p>
      )}
      {summary.informative.length > 0 && (
        <details
          className="alert-section informative"
          data-testid="informative-alerts"
        >
          <summary className="alert-section-heading">
            <span className="alert-section-title">
              <Info size={19} aria-hidden="true" /> Informativos
            </span>
            <span>
              {countLabel(
                summary.informative.length,
                summary.informative.reduce(
                  (total, group) => total + group.count,
                  0,
                ),
              )}
            </span>
          </summary>
          <p className="alert-empty">
            Informações de planejamento que, por si só, não representam
            irregularidade.
          </p>
          {summary.informative.map((group) => (
            <Group key={group.id} {...props} group={group} />
          ))}
        </details>
      )}
      <details
        className="alert-section pending-source"
        data-testid="pending-sources"
      >
        <summary className="alert-section-heading">
          <span className="alert-section-title">
            <BookOpen size={19} aria-hidden="true" />
            Fontes e regras pendentes
          </span>
          <span>
            {countLabel(
              summary.counts.pendingSources,
              summary.occurrenceCounts.pendingSources,
            )}
          </span>
        </summary>
        <p className="alert-empty">
          Pendências de parametrização são separadas das violações trabalhistas.
          Fontes e regras não conferidas impedem afirmar conformidade jurídica.
        </p>
        {summary.pendingSources.length ? (
          summary.pendingSources.map((group) => (
            <Group key={group.id} {...props} group={group} />
          ))
        ) : (
          <p className="alert-empty">
            Nenhuma fonte pendente nos parâmetros usados.
          </p>
        )}
      </details>
    </section>
  );
}
