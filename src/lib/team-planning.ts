import type { Data } from "./store";
import type { Schedule } from "./types";
import { resolveEmployeeModelWithOrigin } from "./company-context";
import {
  prepareRestRotation,
  rotationPayload,
  applyRotationLocally,
  type RotationPlan,
} from "./rest-rotation";
import { isScheduleLocked } from "./schedule-governance";
import { scheduleWriteItems } from "./schedule-write";
import { span } from "./engine";

export type TeamGenerationOptions = { rotate12: boolean; reference: string };
export type TeamGeneration = { schedules: Schedule[]; rotation?: RotationPlan };
export function teamPlanningSelection(
  data: Data,
  companyId: string,
  ids: string[],
  month: string,
  copyFromMonth?: string,
) {
  if (!/^(19\d\d|20\d\d|21\d\d|2200)-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Informe uma competência válida.");
  if (!ids.length || ids.length > 200 || new Set(ids).size !== ids.length)
    throw new Error(
      "Selecione entre 1 e 200 funcionários diferentes por lote.",
    );
  const company = data.companies.find((item) => item.id === companyId);
  if (!company || (company.situacao ?? "ativa") !== "ativa")
    throw new Error("Selecione uma empresa ativa.");
  return ids.map((id) => {
    const employee = data.employees.find(
      (item) =>
        item.id === id &&
        item.empresa_id === companyId &&
        item.situacao !== "inativo",
    );
    if (!employee)
      throw new Error("Há um funcionário inativo ou fora da empresa ativa.");
    const source = copyFromMonth
      ? data.schedules.find(
          (item) =>
            item.empresa_id === companyId &&
            item.funcionario_id === id &&
            item.mes.slice(0, 7) === copyFromMonth,
        )
      : null;
    if (copyFromMonth && !source)
      throw new Error(
        `${employee.nome}: não há escala salva na competência de origem.`,
      );
    const model = source
      ? data.models.find(
          (item) =>
            item.id === source.modelo_id &&
            (!item.empresa_id || item.empresa_id === companyId),
        )
      : resolveEmployeeModelWithOrigin(employee, company, data.models).model;
    if (!model)
      throw new Error(
        `${employee.nome}: vincule um modelo individual ou padrão da empresa antes de gerar a equipe.`,
      );
    const previous = data.schedules.find(
      (item) =>
        item.empresa_id === companyId &&
        item.funcionario_id === id &&
        item.mes.slice(0, 7) === month,
    );
    if (previous && isScheduleLocked(previous))
      throw new Error(
        `${employee.nome}: reabra a escala com justificativa antes de gerar outro planejamento nesta competência.`,
      );
    return { employee, model };
  });
}
export function automaticTeamRotation(
  data: Data,
  companyId: string,
  month: string,
  ids: string[],
  reference: string,
) {
  const participants = teamPlanningSelection(data, companyId, ids, month)
    .filter((item) => item.model.tipo === "12x36")
    .sort(
      (a, b) =>
        a.employee.nome.localeCompare(b.employee.nome, "pt-BR") ||
        a.employee.id.localeCompare(b.employee.id),
    );
  if (participants.length < 2)
    throw new Error(
      "Para distribuir grupos A/B, selecione pelo menos dois funcionários com modelo 12×36. Para os demais casos, mantenha os modelos atuais.",
    );
  const buckets = new Map<string, typeof participants>();
  for (const participant of participants) {
    const key = JSON.stringify([
      participant.model.turno?.map(span).sort((a, b) => a[0] - b[0]),
      participant.employee.estabelecimento_id ?? "",
      participant.employee.setor ?? "",
    ]);
    buckets.set(key, [...(buckets.get(key) ?? []), participant]);
  }
  const assignments: { employeeId: string; group: "A" | "B" }[] = [];
  let aCount = 0,
    bCount = 0;
  for (const bucket of buckets.values()) {
    const startWithA = aCount <= bCount;
    bucket.forEach((item, index) => {
      const group = (index % 2 === 0) === startWithA ? "A" : "B";
      assignments.push({ employeeId: item.employee.id, group });
      if (group === "A") aCount += 1;
      else bCount += 1;
    });
  }
  return prepareRestRotation(data, companyId, month, reference, assignments);
}
export function rotationForTeamSchedules(
  schedules: Schedule[],
  rotation: RotationPlan,
) {
  const items = schedules.filter((schedule) =>
    rotation.assignments.some(
      (assignment) => assignment.employeeId === schedule.funcionario_id,
    ),
  );
  if (
    items.length !== rotation.assignments.length ||
    items.some(
      (item) =>
        item.empresa_id !== rotation.companyId ||
        item.mes.slice(0, 7) !== rotation.month ||
        item.modelo_id !==
          rotation.assignments.find(
            (assignment) => assignment.employeeId === item.funcionario_id,
          )?.modelId,
    )
  )
    throw new Error(
      "As escalas selecionadas não correspondem aos grupos da prévia.",
    );
  return { ...rotation, schedules: items };
}
export function teamGenerationPayload(
  schedules: Schedule[],
  rotation: RotationPlan,
) {
  const plan = rotationForTeamSchedules(schedules, rotation),
    payload = rotationPayload(plan);
  if (
    schedules.some(
      (item) =>
        item.empresa_id !== rotation.companyId ||
        item.mes.slice(0, 7) !== rotation.month,
    )
  )
    throw new Error("O lote deve pertencer à mesma empresa e competência.");
  return {
    p_empresa: plan.companyId,
    itens: scheduleWriteItems(schedules),
    p_revezamento: {
      mes: `${plan.month}-01`,
      referencia: plan.reference,
      modelos: payload.p_modelos,
      vinculos: payload.p_vinculos,
    },
  };
}
export function applyTeamGenerationLocally(
  data: Data,
  schedules: Schedule[],
  rotation: RotationPlan,
): Data {
  const plan = rotationForTeamSchedules(schedules, rotation);
  for (const item of schedules) {
    const employee = data.employees.find(
      (person) =>
        person.id === item.funcionario_id &&
        person.empresa_id === plan.companyId &&
        person.situacao !== "inativo",
    );
    const previous = data.schedules.find(
      (old) =>
        old.empresa_id === plan.companyId &&
        old.funcionario_id === item.funcionario_id &&
        old.mes.slice(0, 7) === item.mes.slice(0, 7),
    );
    if (
      !employee ||
      item.empresa_id !== plan.companyId ||
      item.mes.slice(0, 7) !== plan.month ||
      (previous && isScheduleLocked(previous))
    )
      throw new Error(
        "O lote contém um vínculo indisponível ou uma escala bloqueada.",
      );
    if (previous && (previous.revisao ?? 0) !== (item.revisao ?? 0))
      throw new Error(
        "Uma escala foi alterada. Atualize os dados antes de salvar.",
      );
  }
  const next = applyRotationLocally(data, plan);
  const normal = schedules.filter(
    (item) =>
      !plan.assignments.some(
        (assignment) => assignment.employeeId === item.funcionario_id,
      ),
  );
  for (const item of normal) {
    const old = next.schedules.find(
      (previous) =>
        previous.empresa_id === item.empresa_id &&
        previous.funcionario_id === item.funcionario_id &&
        previous.mes.slice(0, 7) === plan.month,
    );
    const saved = {
      ...item,
      id: old?.id || item.id || crypto.randomUUID(),
      revisao: (old?.revisao ?? 0) + 1,
      status: old?.status ?? ("rascunho" as const),
      updated_at: new Date().toISOString(),
    };
    next.schedules = [
      ...next.schedules.filter((previous) => previous !== old),
      saved,
    ];
    next.logs = [
      {
        id: crypto.randomUUID(),
        empresa_id: plan.companyId,
        registro_id: saved.id,
        tabela: "escalas",
        acao: old ? "UPDATE" : "INSERT",
        ator_id: "demo-user",
        alterado_em: new Date().toISOString(),
        antes: old ? { ...old } : null,
        depois: { ...saved },
        campos: ["dias", "modelo_id"],
      },
      ...next.logs,
    ];
  }
  return next;
}
