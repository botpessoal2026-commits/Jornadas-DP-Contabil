import type { Data } from "./store";
import type { Model, Schedule } from "./types";
import { addDays, dateUTC, minutes, monthDates } from "./engine";
import { resolveEmployeeModelWithOrigin } from "./company-context";
import {
  employeeLocation,
  generateCalendarDays,
  preserveIndividualExceptions,
  projectSchedule,
} from "./special-dates";
import { validationDays } from "./schedule-context";
import { isScheduleLocked } from "./schedule-governance";

export type RotationGroup = "A" | "B";
export type RotationAssignment = { employeeId: string; group: RotationGroup };
export type RotationModel = {
  source: Model;
  model: Model;
  group: RotationGroup;
};
export type RotationPlan = {
  companyId: string;
  month: string;
  reference: string;
  models: RotationModel[];
  assignments: {
    employeeId: string;
    group: RotationGroup;
    modelId: string;
    expectedDefault: string | null;
    sourceId: string;
  }[];
  schedules: Schedule[];
};
export function rotationCandidates(data: Data, companyId: string | null) {
  const company = data.companies.find((item) => item.id === companyId);
  if (!company || (company.situacao ?? "ativa") !== "ativa") return [];
  return data.employees
    .filter(
      (employee) =>
        employee.empresa_id === companyId && employee.situacao !== "inativo",
    )
    .map((employee) => ({
      employee,
      model: resolveEmployeeModelWithOrigin(employee, company, data.models)
        .model,
    }))
    .sort((a, b) => a.employee.nome.localeCompare(b.employee.nome, "pt-BR"));
}

export function rotationPhase(
  anchor: string,
  reference: string,
): RotationGroup {
  const delta = Math.round((+dateUTC(anchor) - +dateUTC(reference)) / 86400000);
  return ((delta % 2) + 2) % 2 === 0 ? "A" : "B";
}

/** Copies only operational model data; legal rules, contracts and original models remain unchanged. */
export function prepareRestRotation(
  data: Data,
  companyId: string,
  month: string,
  reference: string,
  selection: RotationAssignment[],
  createId = () => crypto.randomUUID(),
): RotationPlan {
  if (!/^(19\d\d|20\d\d|21\d\d|2200)-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Selecione uma competência válida.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(reference) ||
    !Number.isFinite(+dateUTC(reference)) ||
    dateUTC(reference).toISOString().slice(0, 10) !== reference ||
    reference > monthDates(month).at(-1)!
  )
    throw new Error(
      "Informe uma data de referência válida, até o último dia da competência.",
    );
  if (
    selection.length < 2 ||
    selection.length > 200 ||
    new Set(selection.map((item) => item.employeeId)).size !== selection.length
  )
    throw new Error(
      "Selecione entre 2 e 200 funcionários diferentes para revezar.",
    );
  if (
    selection.some((item) => item.group !== "A" && item.group !== "B") ||
    !selection.some((item) => item.group === "A") ||
    !selection.some((item) => item.group === "B")
  )
    throw new Error("Distribua os funcionários entre os grupos A e B.");
  const company = data.companies.find((item) => item.id === companyId);
  if (!company || (company.situacao ?? "ativa") !== "ativa")
    throw new Error("Selecione uma empresa ativa.");
  const candidates = rotationCandidates(data, companyId);
  const models: RotationModel[] = [];
  const assignments: RotationPlan["assignments"] = [];
  const schedules = selection.map(({ employeeId, group }) => {
    const candidate = candidates.find(
      (item) => item.employee.id === employeeId,
    );
    if (
      !candidate ||
      candidate.model?.tipo !== "12x36" ||
      !candidate.model.turno?.length
    )
      throw new Error(
        "Todos os selecionados precisam de vínculo ativo e modelo 12×36 salvo nesta empresa.",
      );
    const { employee, model: source } = candidate;
    const old = data.schedules.find(
      (item) =>
        item.empresa_id === companyId &&
        item.funcionario_id === employeeId &&
        item.mes.slice(0, 7) === month,
    );
    if (old && isScheduleLocked(old))
      throw new Error(
        `${employee.nome}: reabra a escala com justificativa antes de substituir o planejamento.`,
      );
    const anchor = group === "A" ? reference : addDays(reference, 1);
    const baseName = source.nome.replace(
      / · Grupo [AB] · \d{4}-\d{2}-\d{2}$/,
      "",
    );
    const name = `${baseName} · Grupo ${group} · ${reference}`;
    const sameModel = (model: Model) =>
      model.empresa_id === companyId &&
      model.tipo === "12x36" &&
      model.nome === name &&
      model.ciclo_inicio === anchor &&
      JSON.stringify(model.turno) === JSON.stringify(source.turno) &&
      JSON.stringify(model.padrao) === JSON.stringify(source.padrao);
    let prepared = models.find((item) => sameModel(item.model));
    if (!prepared) {
      const existing = data.models.find(sameModel);
      prepared = {
        source: structuredClone(source),
        group,
        model: existing ?? {
          ...structuredClone(source),
          id: createId(),
          empresa_id: companyId,
          nome: name,
          ciclo_inicio: anchor,
        },
      };
      models.push(prepared);
    }
    assignments.push({
      employeeId,
      group,
      modelId: prepared.model.id,
      expectedDefault: employee.modelo_padrao_id ?? null,
      sourceId: source.id,
    });
    const schedule: Schedule = {
      id: old?.id ?? "",
      revisao: old?.revisao,
      status: old?.status ?? "rascunho",
      empresa_id: companyId,
      funcionario_id: employeeId,
      modelo_id: prepared.model.id,
      mes: `${month}-01`,
      nome_funcionario: employee.nome,
      modelo_nome: name,
      modelo_tipo: "12x36",
      dias: preserveIndividualExceptions(
        generateCalendarDays(
          month,
          prepared.model,
          employeeLocation(company, employee, data.establishments ?? []),
          data.holidays,
          company.folgar_feriados ?? false,
        ),
        old?.dias ?? [],
      ),
    };
    return projectSchedule(
      { ...schedule, dias: validationDays(schedule, data.schedules) },
      company,
      employee,
      data.specialDates ?? [],
      data.establishments ?? [],
      data.holidays,
    );
  });
  return { companyId, month, reference, models, assignments, schedules };
}

export function rotationData(data: Data, plan: RotationPlan): Data {
  return {
    ...data,
    models: [
      ...data.models.filter(
        (item) => !plan.models.some((next) => next.model.id === item.id),
      ),
      ...plan.models.map((item) => item.model),
    ],
    employees: data.employees.map((employee) => {
      const assignment = plan.assignments.find(
        (item) =>
          item.employeeId === employee.id &&
          employee.empresa_id === plan.companyId,
      );
      return assignment
        ? { ...employee, modelo_padrao_id: assignment.modelId }
        : employee;
    }),
  };
}

/** Demo uses the same atomic outcome, without any Supabase request. */
export function applyRotationLocally(data: Data, plan: RotationPlan): Data {
  const prepared = rotationData(data, plan);
  const changes: {
    tabela: string;
    before: unknown;
    after: unknown;
    id: string;
  }[] = [];
  for (const { model } of plan.models)
    if (!data.models.some((item) => item.id === model.id))
      changes.push({
        tabela: "modelos_jornada",
        before: null,
        after: model,
        id: model.id,
      });
  for (const assignment of plan.assignments)
    changes.push({
      tabela: "funcionarios",
      before: data.employees.find((item) => item.id === assignment.employeeId),
      after: prepared.employees.find(
        (item) => item.id === assignment.employeeId,
      ),
      id: assignment.employeeId,
    });
  const saved = plan.schedules.map((item) => {
    const before = data.schedules.find(
      (old) =>
        old.empresa_id === plan.companyId &&
        old.funcionario_id === item.funcionario_id &&
        old.mes.slice(0, 7) === plan.month,
    );
    const after = {
      ...item,
      id: before?.id || crypto.randomUUID(),
      revisao: (before?.revisao ?? 0) + 1,
      status: before?.status ?? ("rascunho" as const),
      updated_at: new Date().toISOString(),
    };
    changes.push({
      tabela: "escalas",
      before: before ?? null,
      after,
      id: after.id,
    });
    return after;
  });
  return {
    ...prepared,
    schedules: [
      ...data.schedules.filter(
        (item) =>
          !saved.some(
            (next) =>
              next.empresa_id === item.empresa_id &&
              next.funcionario_id === item.funcionario_id &&
              next.mes.slice(0, 7) === item.mes.slice(0, 7),
          ),
      ),
      ...saved,
    ],
    logs: [
      ...changes.map((change) => ({
        id: crypto.randomUUID(),
        tabela: change.tabela,
        acao: change.before ? "UPDATE" : "INSERT",
        alterado_em: new Date().toISOString(),
        empresa_id: plan.companyId,
        registro_id: change.id,
        ator_id: "demo-user",
        antes: change.before as Record<string, unknown> | null,
        depois: change.after as Record<string, unknown>,
        campos:
          change.tabela === "funcionarios"
            ? ["modelo_padrao_id"]
            : change.tabela === "escalas"
              ? ["dias", "modelo_id"]
              : ["nome", "ciclo_inicio", "turno"],
      })),
      ...data.logs,
    ],
  };
}

export function rotationCoverage(plan: RotationPlan) {
  return monthDates(plan.month).map((date) => {
    const work: string[] = [],
      rest: string[] = [],
      missing: string[] = [];
    plan.schedules.forEach((schedule) => {
      const day = schedule.dias.find((item) => item.data === date);
      const name = schedule.nome_funcionario ?? schedule.funcionario_id;
      if (!day) missing.push(name);
      else if (minutes(day.intervalos) > 0) work.push(name);
      else rest.push(name);
    });
    return { date, work, rest, missing };
  });
}

/** This payload is accepted only by the scoped, atomic rotation RPC. */
export function rotationPayload(plan: RotationPlan) {
  const fields = (model: Model) => ({
    id: model.id,
    empresa_id: model.empresa_id,
    nome: model.nome,
    tipo: model.tipo,
    padrao: model.padrao,
    ciclo_inicio: model.ciclo_inicio ?? null,
    turno: model.turno ?? null,
  });
  return {
    p_empresa: plan.companyId,
    p_mes: `${plan.month}-01`,
    p_referencia: plan.reference,
    p_modelos: plan.models.map(({ source, model, group }) => ({
      origem: fields(source),
      destino: fields(model),
      grupo: group,
    })),
    p_vinculos: plan.assignments.map((item) => ({
      funcionario_id: item.employeeId,
      grupo: item.group,
      modelo_id: item.modelId,
      modelo_origem_id: item.sourceId,
      modelo_padrao_esperado_id: item.expectedDefault,
    })),
    itens: plan.schedules.map((schedule) => ({
      id: schedule.id || null,
      empresa_id: schedule.empresa_id,
      funcionario_id: schedule.funcionario_id,
      modelo_id: schedule.modelo_id,
      mes: schedule.mes,
      nome_funcionario: schedule.nome_funcionario,
      modelo_nome: schedule.modelo_nome,
      modelo_tipo: schedule.modelo_tipo,
      dias: schedule.dias,
      revisao_esperada: schedule.revisao ?? null,
    })),
  };
}
