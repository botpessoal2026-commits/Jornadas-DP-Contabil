import type { Data } from "./store";
import type { Alert, Day, Employee, Schedule, Shift } from "./types";
import {
  addDays,
  clock,
  computeDay,
  dateUTC,
  evaluate,
  monthDates,
  span,
} from "./engine";
import { classifyAlert } from "./alerts";
import { projectData } from "./special-dates";
import { scheduleRegime } from "./work-regime";
import { validateShiftText } from "./shift-editor";

export type CompanyOperation = {
  id: string;
  empresa_id: string;
  tipo: "ausencia" | "cobertura" | "troca" | "documento" | "realizado";
  status: "pendente" | "aprovado" | "cancelado";
  titulo: string;
  funcionario_id: string | null;
  data_inicio: string;
  data_fim: string;
  payload: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export const operationLabels: Record<CompanyOperation["tipo"], string> = {
  ausencia: "Ausências",
  cobertura: "Cobertura",
  troca: "Solicitações de troca",
  documento: "Documentos",
  realizado: "Planejado × realizado",
};

const validDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = dateUTC(value);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
};
const text = (value: unknown, max = 1000) =>
  typeof value === "string" && value.length <= max;
const reference = (value: unknown) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 200 &&
  !/[\u0000-\u001f\u007f]/u.test(value);
const own = (data: Data, companyId: string, employeeId: unknown) =>
  data.employees.find(
    (employee) =>
      employee.id === employeeId && employee.empresa_id === companyId,
  );

export function safeDocumentUrl(value: unknown): string | null {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("Informe um endereço HTTPS válido para o documento.");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error();
    return url.href;
  } catch {
    throw new Error("Informe um endereço HTTPS válido para o documento.");
  }
}

/** The same validation is used before creating, approving and importing records. */
export function validateCompanyOperation(
  operation: CompanyOperation,
  data: Data,
): string[] {
  const errors: string[] = [];
  const company = data.companies.find(
    (item) => item.id === operation.empresa_id,
  );
  if (!company || (company.situacao ?? "ativa") !== "ativa")
    errors.push("Selecione uma empresa ativa e autorizada.");
  if (!reference(operation.id) || !reference(operation.empresa_id))
    errors.push("Identificação do registro inválida.");
  if (!Object.hasOwn(operationLabels, operation.tipo))
    errors.push("Tipo operacional inválido.");
  if (!["pendente", "aprovado", "cancelado"].includes(operation.status))
    errors.push("Situação do registro inválida.");
  if (!text(operation.titulo, 160) || !operation.titulo.trim())
    errors.push("Informe um título de até 160 caracteres.");
  const datesValid =
    validDate(operation.data_inicio) && validDate(operation.data_fim);
  if (
    !datesValid ||
    operation.data_fim < operation.data_inicio ||
    (datesValid &&
      +dateUTC(operation.data_fim) - +dateUTC(operation.data_inicio) >
        3660 * 86400000)
  )
    errors.push("Informe um período válido de até dez anos.");
  if (
    !operation.payload ||
    typeof operation.payload !== "object" ||
    Array.isArray(operation.payload)
  )
    return [...errors, "Dados operacionais inválidos."];
  try {
    if (JSON.stringify(operation.payload).length > 32000)
      errors.push("O registro excede o tamanho permitido.");
  } catch {
    return [...errors, "Dados operacionais inválidos."];
  }
  const employee = own(data, operation.empresa_id, operation.funcionario_id);
  if (["ausencia", "troca", "realizado"].includes(operation.tipo)) {
    if (!employee || employee.situacao === "inativo")
      errors.push("O funcionário deve estar ativo e pertencer à empresa.");
  } else if (operation.funcionario_id !== null)
    errors.push("Este registro não deve identificar um funcionário.");
  const p = operation.payload;
  if (operation.tipo === "ausencia") {
    if (
      !["ferias", "afastamento", "indisponibilidade"].includes(
        String(p.categoria),
      ) ||
      !text(p.motivo)
    )
      errors.push("Informe o tipo e o motivo da ausência.");
  } else if (operation.tipo === "cobertura") {
    if (
      p.estabelecimento_id !== null &&
      !data.establishments?.some(
        (unit) =>
          unit.id === p.estabelecimento_id &&
          unit.empresa_id === operation.empresa_id &&
          unit.ativo,
      )
    )
      errors.push("O estabelecimento deve pertencer à empresa e estar ativo.");
    if (!text(p.setor, 160) || !text(p.cargo, 160))
      errors.push("Setor ou cargo inválido.");
    try {
      clock(p.inicio as string);
      clock(p.fim as string);
    } catch {
      errors.push("Informe o início e o fim da faixa de cobertura.");
    }
    if (
      !Number.isInteger(p.minimo) ||
      Number(p.minimo) < 1 ||
      Number(p.minimo) > 1000
    )
      errors.push("Cobertura mínima deve ser de 1 a 1000 pessoas.");
    if (
      !Array.isArray(p.dias_semana) ||
      !p.dias_semana.length ||
      p.dias_semana.length > 7 ||
      new Set(p.dias_semana).size !== p.dias_semana.length ||
      p.dias_semana.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    )
      errors.push("Selecione os dias da semana da cobertura.");
  } else if (operation.tipo === "troca") {
    const target = own(data, operation.empresa_id, p.destino_funcionario_id);
    if (
      !target ||
      target.situacao === "inativo" ||
      target.id === operation.funcionario_id
    )
      errors.push("Selecione outro funcionário ativo da mesma empresa.");
    if (
      !validDate(p.data_origem) ||
      !validDate(p.data_destino) ||
      (validDate(p.data_origem) &&
        validDate(p.data_destino) &&
        (operation.data_inicio !== [p.data_origem, p.data_destino].sort()[0] ||
          operation.data_fim !== [p.data_origem, p.data_destino].sort()[1]))
    )
      errors.push("As datas da troca devem corresponder ao período informado.");
    if (!text(p.justificativa) || !String(p.justificativa ?? "").trim())
      errors.push("Informe a justificativa da troca.");
  } else if (operation.tipo === "documento") {
    if (
      !text(p.fonte, 500) ||
      !String(p.fonte ?? "").trim() ||
      !text(p.referencia, 500)
    )
      errors.push("Informe a fonte e a referência do documento.");
    if (
      p.vigencia_fim !== null &&
      (!validDate(p.vigencia_fim) ||
        p.vigencia_fim < operation.data_inicio ||
        p.vigencia_fim !== operation.data_fim)
    )
      errors.push("Fim da vigência inválido.");
    try {
      safeDocumentUrl(p.url);
    } catch (error) {
      errors.push((error as Error).message);
    }
  } else if (operation.tipo === "realizado") {
    if (operation.data_inicio !== operation.data_fim)
      errors.push("Cada registro realizado deve representar uma data.");
    if (
      !["manual", "importacao"].includes(String(p.origem)) ||
      !text(p.observacao)
    )
      errors.push("Informe a origem e observação das marcações.");
    if (!Array.isArray(p.intervalos) || p.intervalos.length > 12)
      errors.push("Informe até doze períodos efetivamente registrados.");
    else {
      try {
        const ranges = (p.intervalos as Shift[])
          .map((shift) => {
            if (
              typeof shift !== "object" ||
              !shift ||
              Object.keys(shift).some(
                (key) => !["start", "end", "startDay", "endDay"].includes(key),
              )
            )
              throw new Error();
            return span(shift);
          })
          .sort((a, b) => a[0] - b[0]);
        if (
          ranges.some(
            (range, index) => index > 0 && range[0] < ranges[index - 1][1],
          )
        )
          throw new Error();
        if (ranges.reduce((sum, range) => sum + range[1] - range[0], 0) > 1440)
          throw new Error();
      } catch {
        errors.push("Marcações inválidas, sobrepostas ou acima de 24 horas.");
      }
    }
  }
  return errors;
}

export function operationsForCompany(
  data: Data,
  companyId: string,
  month?: string,
) {
  return (data.operations ?? []).filter(
    (operation) =>
      operation.empresa_id === companyId &&
      (!month ||
        (operation.data_inicio <= monthDates(month).at(-1)! &&
          (operation.tipo === "documento" ||
            operation.data_fim >= `${month}-01`))),
  );
}

export function absenceConflicts(data: Data, operation: CompanyOperation) {
  if (
    operation.tipo !== "ausencia" ||
    operation.status !== "aprovado" ||
    validateCompanyOperation(operation, data).length
  )
    return [];
  const dates = new Map<string, number>();
  const ranges = workRanges(data, operation.empresa_id).filter(
    (range) => range.employee.id === operation.funcionario_id,
  );
  for (const range of ranges) {
    for (
      let date = new Date(range.from * 60000).toISOString().slice(0, 10);
      date <= new Date((range.to - 1) * 60000).toISOString().slice(0, 10);
      date = addDays(date, 1)
    ) {
      if (date < operation.data_inicio || date > operation.data_fim) continue;
      const start = +dateUTC(date) / 60000;
      const minutes = Math.max(
        0,
        Math.min(range.to, start + 1440) - Math.max(range.from, start),
      );
      dates.set(date, (dates.get(date) ?? 0) + minutes);
    }
  }
  return [...dates.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, minutes]) => ({ date, minutes }));
}

type WorkRange = { employee: Employee; from: number; to: number };
function workRanges(data: Data, companyId: string): WorkRange[] {
  return projectData(data)
    .schedules.filter((schedule) => schedule.empresa_id === companyId)
    .flatMap((schedule) => {
      const employee = own(data, companyId, schedule.funcionario_id);
      if (!employee || employee.situacao === "inativo") return [];
      return schedule.dias
        .filter((day) => day.data.startsWith(schedule.mes.slice(0, 7)))
        .flatMap((day) =>
          day.intervalos.flatMap((shift) => {
            try {
              const [a, b] = span(shift);
              const base = +dateUTC(day.data) / 60000;
              return [{ employee, from: base + a, to: base + b }];
            } catch {
              return [];
            }
          }),
        );
    });
}

/** Counts distinct people at every real boundary, including overnight shifts. */
export function coverageGaps(
  data: Data,
  operation: CompanyOperation,
  month: string,
) {
  if (
    operation.tipo !== "cobertura" ||
    operation.status !== "aprovado" ||
    validateCompanyOperation(operation, data).length
  )
    return [];
  const p = operation.payload;
  const ranges = workRanges(data, operation.empresa_id).filter(
    (range) =>
      (!p.estabelecimento_id ||
        range.employee.estabelecimento_id === p.estabelecimento_id) &&
      (!p.setor || range.employee.setor === p.setor) &&
      (!p.cargo || range.employee.cargo === p.cargo),
  );
  const absences = operationsForCompany(data, operation.empresa_id).filter(
    (entry) =>
      entry.tipo === "ausencia" &&
      entry.status === "aprovado" &&
      !validateCompanyOperation(entry, data).length,
  );
  return monthDates(month)
    .filter(
      (date) =>
        date >= operation.data_inicio &&
        date <= operation.data_fim &&
        (p.dias_semana as number[]).includes(dateUTC(date).getUTCDay()),
    )
    .flatMap((date) => {
      const start = +dateUTC(date) / 60000 + clock(p.inicio as string);
      let end = +dateUTC(date) / 60000 + clock(p.fim as string);
      if (end <= start) end += 1440;
      const relevant = ranges.filter(
        (range) => range.to > start && range.from < end,
      );
      const points = [
        ...new Set([
          start,
          end,
          ...relevant.flatMap((range) => [
            Math.max(start, range.from),
            Math.min(end, range.to),
          ]),
          ...absences
            .flatMap((entry) => [
              +dateUTC(entry.data_inicio) / 60000,
              +dateUTC(entry.data_fim) / 60000 + 1440,
            ])
            .filter((point) => point > start && point < end),
        ]),
      ].sort((a, b) => a - b);
      return points.slice(0, -1).flatMap((from, index) => {
        const to = points[index + 1];
        const people = new Map(
          relevant
            .filter(
              (range) =>
                range.from <= from &&
                range.to >= to &&
                !absences.some(
                  (entry) =>
                    entry.funcionario_id === range.employee.id &&
                    +dateUTC(entry.data_inicio) / 60000 <= from &&
                    +dateUTC(entry.data_fim) / 60000 + 1440 >= to,
                ),
            )
            .map((range) => [range.employee.id, range.employee.nome]),
        );
        return people.size < Number(p.minimo)
          ? [
              {
                date,
                from: new Date(from * 60000).toISOString(),
                to: new Date(to * 60000).toISOString(),
                scheduled: people.size,
                needed: Number(p.minimo),
                names: [...people.values()],
              },
            ]
          : [];
      });
    });
}

export type SwapAssessment = {
  schedules: Schedule[];
  alerts: (Alert & { employeeName: string })[];
  issues: string[];
  canApply: boolean;
};
export function assessSwap(
  data: Data,
  operation: CompanyOperation,
): SwapAssessment {
  const issues = validateCompanyOperation(operation, data);
  if (operation.tipo !== "troca")
    issues.push("O registro não é uma solicitação de troca.");
  if (operation.status !== "pendente")
    issues.push("Somente uma solicitação pendente pode ser aplicada.");
  if (issues.length)
    return { schedules: [], alerts: [], issues, canApply: false };
  const p = operation.payload;
  const pairs = [
    [operation.funcionario_id!, p.data_origem as string],
    [p.destino_funcionario_id as string, p.data_destino as string],
  ];
  const effective = projectData(data);
  const selected = pairs.map(([id, date]) =>
    effective.schedules.find(
      (schedule) =>
        schedule.empresa_id === operation.empresa_id &&
        schedule.funcionario_id === id &&
        schedule.mes.slice(0, 7) === date.slice(0, 7),
    ),
  );
  const sourceDays = selected.map((schedule, index) =>
    schedule?.dias.find((day) => day.data === pairs[index][1]),
  );
  if (selected.some((schedule) => !schedule) || sourceDays.some((day) => !day))
    return {
      schedules: [],
      alerts: [],
      issues: [
        "Salve e carregue as duas escalas e datas antes de avaliar a troca.",
      ],
      canApply: false,
    };
  const replacements = selected.map((schedule, index) => {
    const date = pairs[index][1];
    const shifts = structuredClone(sourceDays[1 - index]!.intervalos);
    const raw = data.schedules.find((item) => item.id === schedule!.id)!;
    return {
      ...raw,
      dias: raw.dias.map((day): Day =>
        day.data !== date
          ? day
          : {
              ...day,
              calendario: {
                ...day.calendario,
                base: structuredClone(
                  day.calendario?.base ?? {
                    intervalos: day.intervalos,
                    folga: day.folga,
                    feriado: day.feriado,
                    observacao: day.observacao,
                  },
                ),
                excecao: {
                  categoria: shifts.length ? "trabalho" : "folga",
                  nome: "Troca de plantão",
                  expediente: shifts.length ? "normal" : "sem_expediente",
                  intervalos: shifts,
                  observacao: operation.titulo,
                },
              },
            },
      ),
    };
  });
  const changed = projectData({
    ...data,
    schedules: [
      ...data.schedules.filter(
        (schedule) => !replacements.some((item) => item.id === schedule.id),
      ),
      ...replacements,
    ],
  });
  const company = data.companies.find(
    (item) => item.id === operation.empresa_id,
  )!;
  const alerts: SwapAssessment["alerts"] = [];
  for (const candidate of replacements) {
    const employee = own(data, operation.empresa_id, candidate.funcionario_id)!;
    const schedule = changed.schedules.find(
      (item) => item.id === candidate.id,
    )!;
    try {
      // projectData already reconciles saved neighboring dates before events.
      const report = evaluate(
        schedule.dias,
        data.rules,
        company,
        schedule.mes,
        scheduleRegime(schedule, data.models),
        employee,
      );
      alerts.push(
        ...report.alerts.map((alert) => ({
          ...alert,
          employeeName: employee.nome,
        })),
      );
      for (const absence of operationsForCompany(data, company.id).filter(
        (item) =>
          item.tipo === "ausencia" &&
          item.status === "aprovado" &&
          item.funcionario_id === employee.id,
      ))
        if (absenceConflicts(changed, absence).length)
          issues.push(
            `${employee.nome}: há trabalho durante ausência aprovada.`,
          );
    } catch (error) {
      issues.push(`${employee.nome}: ${(error as Error).message}`);
    }
  }
  return {
    schedules: replacements,
    alerts,
    issues,
    canApply:
      !issues.length &&
      !alerts.some((alert) => classifyAlert(alert) !== "attention"),
  };
}

/** Suggestions are a shortlist to review, not automatic schedule approval. */
export function suggestSwapCandidates(data: Data, operation: CompanyOperation) {
  if (operation.tipo !== "troca") return [];
  return data.employees
    .filter(
      (employee) =>
        employee.empresa_id === operation.empresa_id &&
        employee.id !== operation.funcionario_id &&
        employee.situacao !== "inativo",
    )
    .slice(0, 100)
    .map((employee) => {
      const candidate = {
        ...operation,
        payload: { ...operation.payload, destino_funcionario_id: employee.id },
      };
      const assessment = assessSwap(data, candidate);
      return { employee, assessment };
    })
    .sort(
      (a, b) =>
        Number(b.assessment.canApply) - Number(a.assessment.canApply) ||
        a.assessment.issues.length +
          a.assessment.alerts.length -
          (b.assessment.issues.length + b.assessment.alerts.length) ||
        a.employee.nome.localeCompare(b.employee.nome, "pt-BR"),
    );
}

/** Real values are counted by civil date, independently from planned marks. */
export function comparePlannedActual(
  data: Data,
  companyId: string,
  employeeId: string,
  month: string,
) {
  if (!own(data, companyId, employeeId))
    throw new Error("Funcionário fora do contexto da empresa.");
  const effective = projectData(data);
  const planned = effective.schedules.find(
    (item) =>
      item.empresa_id === companyId &&
      item.funcionario_id === employeeId &&
      item.mes.slice(0, 7) === month,
  );
  const records = operationsForCompany(data, companyId).filter(
    (item) =>
      item.tipo === "realizado" &&
      item.funcionario_id === employeeId &&
      item.status === "aprovado" &&
      !validateCompanyOperation(item, data).length,
  );
  const actualDays: Day[] = records.map((item) => ({
    data: item.data_inicio,
    intervalos: structuredClone(item.payload.intervalos as Shift[]),
    folga: !(item.payload.intervalos as Shift[]).length,
    feriado: null,
    observacao: "",
  }));
  return monthDates(month).map((date) => {
    const plannedDay = planned?.dias.find((day) => day.data === date);
    const duplicates =
      records.filter((item) => item.data_inicio === date).length > 1 ||
      records.filter((item) => item.data_inicio === addDays(date, -1)).length >
        1;
    const actualDay = actualDays.find((day) => day.data === date);
    const carry = actualDays.some(
      (day) =>
        day.data === addDays(date, -1) &&
        day.intervalos.some((shift) => span(shift)[1] > 1440),
    );
    const actual = duplicates
      ? null
      : actualDay || carry
        ? computeDay(
            actualDay ?? {
              data: date,
              intervalos: [],
              folga: true,
              feriado: null,
              observacao: "",
            },
            [],
            actualDays,
          ).worked
        : null;
    const expected = plannedDay
      ? computeDay(plannedDay, [], planned!.dias).worked
      : null;
    return {
      date,
      planned: expected,
      actual,
      delta: expected === null || actual === null ? null : actual - expected,
      duplicate: duplicates,
    };
  });
}

/** Import supports a deliberately small, documented semicolon layout. */
export function parseActualImport(
  source: string,
  data: Data,
  companyId: string,
  employeeId: string,
): CompanyOperation[] {
  if (!own(data, companyId, employeeId))
    throw new Error("Funcionário fora do contexto da empresa.");
  if (source.length > 1000000) throw new Error("O arquivo excede 1 MB.");
  const lines = source
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter((line) => line.trim());
  if (/^data;/iu.test(lines[0] ?? "")) lines.shift();
  if (lines.length > 366 || !lines.length)
    throw new Error("Importe de 1 a 366 datas por arquivo.");
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const cells = line.split(";");
    const date = cells[0]?.trim();
    if (cells.length !== 2 || !validDate(date) || seen.has(date))
      throw new Error(
        `Linha ${index + 1}: use data única AAAA-MM-DD;períodos.`,
      );
    seen.add(date);
    const periods = cells[1].trim();
    if (!periods)
      throw new Error(
        `Linha ${index + 1}: informe os períodos ou ZERO, sem inferir marcações ausentes.`,
      );
    const validation = validateShiftText(
      /^ZERO$/iu.test(periods) ? "" : periods,
    );
    if (!validation.shifts)
      throw new Error(`Linha ${index + 1}: ${validation.errors.intervals}`);
    const operation: CompanyOperation = {
      id: crypto.randomUUID(),
      empresa_id: companyId,
      funcionario_id: employeeId,
      tipo: "realizado",
      status: "pendente",
      titulo: `Marcações importadas ${date}`,
      data_inicio: date,
      data_fim: date,
      payload: {
        intervalos: validation.shifts,
        origem: "importacao",
        observacao: "Importado para conferência; sem apuração automática.",
      },
    };
    const errors = validateCompanyOperation(operation, data);
    if (errors.length)
      throw new Error(`Linha ${index + 1}: ${errors.join(" ")}`);
    return operation;
  });
}
