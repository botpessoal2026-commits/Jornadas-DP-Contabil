"use client";
import { useMemo, useState } from "react";
import { Check, History, LockKeyhole, Send } from "lucide-react";
import type { Data } from "@/lib/store";
import { loadScheduleVersions } from "@/lib/store";
import type { Schedule, ScheduleReview, ScheduleStatus } from "@/lib/types";
import { validateSchedule } from "@/lib/validation";
import { projectData, employeeLocation } from "@/lib/special-dates";
import {
  isScheduleLocked,
  reviewAttestation,
  scheduleStatus,
  scheduleStatusLabels,
  transitionEligibility,
  type ScheduleVersion,
} from "@/lib/schedule-governance";

const nextSteps: Partial<Record<ScheduleStatus, ScheduleStatus>> = {
  rascunho: "em_revisao",
  em_revisao: "aprovada",
  aprovada: "publicada",
  publicada: "fechada",
};
const actionLabels: Partial<Record<ScheduleStatus, string>> = {
  em_revisao: "Encaminhar para revisão",
  aprovada: "Aprovar escala",
  publicada: "Publicar versão",
  fechada: "Fechar competência",
};

export default function ScheduleGovernance({
  schedule,
  data,
  demo = false,
  busy = false,
  onTransition,
}: {
  schedule: Schedule;
  data: Data;
  demo?: boolean;
  busy?: boolean;
  onTransition: (
    next: ScheduleStatus,
    reason: string,
    review: ScheduleReview,
  ) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [versions, setVersions] = useState<ScheduleVersion[] | null>(null);
  const counts = useMemo(() => {
    const company = data.companies.find(
      (entry) => entry.id === schedule.empresa_id,
    );
    const employee = data.employees.find(
      (entry) =>
        entry.id === schedule.funcionario_id &&
        entry.empresa_id === schedule.empresa_id,
    );
    if (!company || !employee)
      return {
        violations: 1,
        pendingSources: 1,
        error: "Empresa ou funcionário indisponível.",
      };
    try {
      const { counts: reviewed } = validateSchedule(data, schedule);
      return {
        ...reviewed,
        error: "",
      };
    } catch {
      return {
        violations: 1,
        pendingSources: 1,
        error: "Não foi possível conferir os horários desta escala.",
      };
    }
  }, [schedule, data]);
  const status = scheduleStatus(schedule);
  const next = nextSteps[status];
  const reasonRequired = status !== "rascunho";
  const pending = busy || working;
  const forwardError = next
    ? transitionEligibility(schedule, next, counts, reason)
    : null;
  const act = async (target: ScheduleStatus) => {
    setError("");
    const invalid = transitionEligibility(schedule, target, counts, reason);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (["aprovada", "publicada", "fechada"].includes(target) && !checked) {
      setError(
        "Confirme que conferiu os horários, as regras e os documentos aplicáveis.",
      );
      return;
    }
    setWorking(true);
    try {
      await onTransition(target, reason, reviewAttestation(counts, checked));
      setReason("");
      setChecked(false);
      setVersions(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar a situação.",
      );
    } finally {
      setWorking(false);
    }
  };
  const readVersions = async () => {
    setError("");
    setWorking(true);
    try {
      setVersions(
        demo
          ? (data.scheduleVersions ?? [])
              .filter(
                (entry) =>
                  entry.escala_id === schedule.id &&
                  entry.empresa_id === schedule.empresa_id,
              )
              .sort((a, b) => b.versao - a.versao)
          : await loadScheduleVersions(schedule.empresa_id, schedule.id),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível consultar as versões.",
      );
    } finally {
      setWorking(false);
    }
  };
  const downloadVersion = async (version: ScheduleVersion) => {
    setError("");
    setWorking(true);
    try {
      if (
        version.empresa_id !== schedule.empresa_id ||
        version.escala_id !== schedule.id
      )
        throw new Error("Versão indisponível para esta escala.");
      const frozen = projectData(version.snapshot.data);
      const saved = frozen.schedules.find(
        (entry) => entry.id === version.escala_id,
      );
      const company = frozen.companies.find(
        (entry) => entry.id === version.empresa_id,
      );
      const employee = frozen.employees.find(
        (entry) =>
          entry.id === saved?.funcionario_id &&
          entry.empresa_id === company?.id,
      );
      if (!saved || !company || !employee)
        throw new Error("O contexto desta versão está incompleto.");
      const { exportTimesheetPDF } = await import("@/lib/exports");
      await exportTimesheetPDF(
        saved,
        employeeLocation(company, employee, frozen.establishments ?? []),
        employee,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível gerar a folha desta versão.",
      );
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="panel" aria-label="Revisão e publicação da escala">
      <div className="panel-head">
        <h2>Revisão e publicação</h2>
        <span className="pill">
          {scheduleStatusLabels[status]} · revisão {schedule.revisao ?? 0}
        </span>
      </div>
      <div className="panel-body">
        <p className="muted">
          Salvar conserva o planejamento. Aprovar registra sua conferência;
          publicar congela uma versão dos horários, dados e regras. Essas etapas
          não substituem a análise dos documentos aplicáveis.
        </p>
        {isScheduleLocked(schedule) && (
          <p className="banner neutral">
            <LockKeyhole size={16} /> Escala protegida contra edição. Reabra com
            justificativa para gerar uma nova versão.
          </p>
        )}
        <div className="actions mt-4" aria-label="Etapas da escala">
          {(
            Object.entries(scheduleStatusLabels) as [ScheduleStatus, string][]
          ).map(([value, label]) => (
            <span
              key={value}
              className={`pill ${value === status ? "" : "neutral"}`}
              aria-current={value === status ? "step" : undefined}
            >
              {value === status && <Check size={12} />}
              {label}
            </span>
          ))}
        </div>
        {counts.error && <p className="warning-text mt-3">{counts.error}</p>}
        <p className="muted mt-3">
          {counts.violations} bloqueante(s) ·{" "}
          {"attention" in counts ? counts.attention : 0} de atenção ·{" "}
          {"informative" in counts ? counts.informative : 0} informativo(s) ·{" "}
          {counts.pendingSources} fonte(s) pendente(s).
        </p>
        {next && forwardError && (
          <p className="warning-text mt-3">{forwardError}</p>
        )}
        <label className="block mt-4">
          Justificativa{" "}
          {"attention" in counts && (counts.attention ?? 0) > 0
            ? "para conferência dos alertas de atenção (mínimo 10 caracteres)"
            : reasonRequired
              ? "para devolução ou reabertura (mínimo 10 caracteres)"
              : "(opcional)"}
          <textarea
            value={reason}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {next && ["aprovada", "publicada", "fechada"].includes(next) && (
          <label className="check-label mt-4">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            Conferi os horários, as regras, os documentos e os alertas de
            atenção aplicáveis. Não há bloqueantes ou fontes pendentes.
          </label>
        )}
        <div className="actions mt-4">
          {next && (
            <button
              type="button"
              className="button primary"
              disabled={pending || Boolean(forwardError)}
              onClick={() => void act(next)}
            >
              <Send size={15} />
              {actionLabels[next]}
            </button>
          )}
          {status !== "rascunho" && (
            <button
              type="button"
              className="button"
              disabled={pending || reason.trim().length < 10}
              onClick={() => void act("rascunho")}
            >
              Reabrir como rascunho
            </button>
          )}
          <button
            type="button"
            className="button"
            disabled={pending || !schedule.id}
            onClick={() => void readVersions()}
          >
            <History size={15} />
            Consultar versões publicadas
          </button>
        </div>
        {error && (
          <p className="warning-text mt-4" role="alert">
            {error}
          </p>
        )}
        {versions !== null && (
          <div className="mt-4" aria-label="Versões publicadas">
            {!versions.length ? (
              <p className="muted">Nenhuma versão publicada desta escala.</p>
            ) : (
              versions.map((version) => (
                <article key={version.id} className="resource-card mt-3">
                  <strong>
                    Versão {version.versao} · revisão {version.revisao}
                  </strong>
                  <p className="muted">
                    {new Date(version.publicado_em).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    })}
                    {demo ? " · Demonstração" : ""}
                  </p>
                  {version.justificativa && <p>{version.justificativa}</p>}
                  <button
                    type="button"
                    className="button small mt-2"
                    disabled={pending}
                    onClick={() => void downloadVersion(version)}
                  >
                    Gerar folha desta versão
                  </button>
                </article>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}
