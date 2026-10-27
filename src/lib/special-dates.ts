import {
  addDays,
  computeDay,
  dateUTC,
  generateDays,
  holidayAt,
  minutes,
  span,
} from "./engine";
import { validationDays } from "./schedule-context";
import type { Data } from "./store";
import type {
  Company,
  DateOccurrence,
  Day,
  DayException,
  DayPlan,
  Employee,
  Establishment,
  Holiday,
  LegalRule,
  Model,
  Schedule,
  Shift,
  SpecialDate,
  SpecialDateCategory,
} from "./types";

export const categoryLabels: Record<SpecialDateCategory, string> = {
  feriado_nacional: "Feriado nacional",
  feriado_estadual: "Feriado estadual",
  feriado_municipal: "Feriado municipal",
  feriado_especifico: "Feriado específico",
  ponto_facultativo: "Ponto facultativo",
  recesso: "Recesso empresarial",
  sem_expediente: "Dia sem expediente",
};

export type CalendarContext = {
  company: Company;
  employee: Employee;
  events: SpecialDate[];
  establishments?: Establishment[];
  holidays?: Holiday[];
};

const holidayCategories = new Set<SpecialDateCategory>([
  "feriado_nacional",
  "feriado_estadual",
  "feriado_municipal",
  "feriado_especifico",
]);
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const isDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = dateUTC(value);
  return (
    Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value
  );
};
const planFromDay = (day: Day): DayPlan => ({
  intervalos: structuredClone(day.intervalos),
  folga: day.folga,
  feriado: day.feriado,
  observacao: day.observacao,
});
const baseForDay = (day: Day): DayPlan =>
  structuredClone(day.calendario?.base ?? planFromDay(day));

/** Keep a registered model's hours apart from the default holiday closure. */
export function generateCalendarDays(
  month: string,
  model: Model,
  company: Company,
  holidays: Holiday[],
  restOnHolidays = true,
  includeBoundary = true,
): Day[] {
  const generated = generateDays(
    month,
    model,
    company,
    holidays,
    false,
    includeBoundary,
  );
  if (!restOnHolidays) return generated;
  return generated.map((day) =>
    day.feriado && day.intervalos.length
      ? {
          ...day,
          intervalos: [],
          folga: true,
          calendario: {
            base: planFromDay(day),
            excecao: null,
            folgar_feriado: true,
          },
        }
      : day,
  );
}

/**
 * Copies are generated before holiday closure (duplicateDays(..., false)).
 * Their actual hours, including an explicit copied rest, become the new base.
 */
export function mergeGeneratedCalendarPolicy(
  days: Day[],
  generated: Day[],
): Day[] {
  const fresh = new Map(generated.map((day) => [day.data, day]));
  return days.map((day) => {
    const policy = fresh.get(day.data)?.calendario;
    if (policy?.folgar_feriado !== true) return day;
    const base = baseForDay(day);
    base.feriado ??= policy.base.feriado;
    return {
      ...day,
      intervalos: [],
      folga: true,
      feriado: base.feriado,
      calendario: {
        ...day.calendario,
        base,
        excecao: day.calendario?.excecao ?? null,
        folgar_feriado: true,
      },
    };
  });
}

/** The worker's optional establishment supplies the workplace location. */
export function employeeLocation(
  company: Company,
  employee: Employee,
  establishments: Establishment[] = [],
): Company {
  if (employee.empresa_id !== company.id)
    throw new Error("O funcionário deve pertencer à empresa do calendário.");
  if (!employee.estabelecimento_id) return company;
  const establishment = establishments.find(
    (entry) =>
      entry.id === employee.estabelecimento_id &&
      entry.empresa_id === company.id,
  );
  if (!establishment)
    throw new Error(
      "Estabelecimento indisponível para a empresa do funcionário.",
    );
  // Inactivation does not move an existing worker's historical workplace.
  return { ...company, cidade: establishment.cidade, uf: establishment.uf };
}

/** Annual dates repeat their actual month/day; movable dates are never inferred. */
export function specialDateMatchesDate(event: SpecialDate, date: string) {
  if (!isDate(date) || !isDate(event.data_inicio)) return false;
  const end = event.data_fim ?? event.data_inicio;
  if (!isDate(end) || end < event.data_inicio) return false;
  if (event.recorrencia !== "anual")
    return date >= event.data_inicio && date <= end;
  if (event.data_movel || isMovableName(event.nome)) return false;
  const offset =
    Number(end.slice(0, 4)) - Number(event.data_inicio.slice(0, 4));
  if (offset < 0 || offset > 1) return false;
  const year = Number(date.slice(0, 4));
  for (const anchorYear of [year - 1, year]) {
    const first = `${anchorYear}${event.data_inicio.slice(4)}`;
    const last = `${anchorYear + offset}${end.slice(4)}`;
    // February 29 remains February 29: no February 28/March 1 substitution.
    if (!isDate(first) || !isDate(last) || first < event.data_inicio) continue;
    if (date >= first && date <= last) return true;
  }
  return false;
}

const isMovableName = (name: string) =>
  /carnaval|sexta.*santa|paixao|corpus\s+christi|pascoa|quarta.*cinzas/.test(
    normalize(name),
  );

/** Same equality as the active-record database index, independent of row ID. */
export function specialDateIdentity(
  event: SpecialDate | Omit<SpecialDate, "id">,
) {
  const text = (value: string | null) =>
    (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  const end = event.data_fim ?? event.data_inicio;
  const annual = event.recorrencia === "anual";
  const geographical =
    event.categoria === "feriado_estadual" ||
    event.categoria === "feriado_municipal";
  return JSON.stringify([
    event.empresa_id,
    event.estabelecimento_id ?? "",
    text(event.nome),
    event.categoria,
    event.alcance,
    [...event.funcionario_ids].sort(),
    event.recorrencia,
    annual ? event.data_inicio.slice(5) : event.data_inicio,
    annual ? end.slice(5) : end,
    annual
      ? Number(end.slice(0, 4)) - Number(event.data_inicio.slice(0, 4))
      : 0,
    geographical ? normalize(event.uf ?? "") : "",
    event.categoria === "feriado_municipal"
      ? normalize(event.cidade ?? "")
      : "",
  ]);
}

function eventApplies(
  event: SpecialDate,
  date: string,
  context: CalendarContext,
  location: Company,
) {
  if (
    !event.ativo ||
    event.empresa_id !== context.company.id ||
    !specialDateMatchesDate(event, date)
  )
    return false;
  if (
    event.estabelecimento_id &&
    event.estabelecimento_id !== context.employee.estabelecimento_id
  )
    return false;
  if (
    event.alcance !== "empresa" &&
    !event.funcionario_ids.includes(context.employee.id)
  )
    return false;
  if (
    event.categoria === "feriado_estadual" ||
    event.categoria === "feriado_municipal"
  ) {
    if (!event.uf || normalize(event.uf) !== normalize(location.uf))
      return false;
    if (
      event.categoria === "feriado_municipal" &&
      (!event.cidade || normalize(event.cidade) !== normalize(location.cidade))
    )
      return false;
  }
  return true;
}

const eventPriority = (event: SpecialDate) =>
  event.alcance !== "empresa" ? 3 : event.estabelecimento_id ? 2 : 1;
const operationPriority: Record<SpecialDate["expediente"], number> = {
  sem_expediente: 3,
  reduzido: 2,
  normal: 1,
  individual: 0,
};
function compareEvents(a: SpecialDate, b: SpecialDate) {
  return (
    eventPriority(b) - eventPriority(a) ||
    operationPriority[b.expediente] - operationPriority[a.expediente] ||
    b.data_inicio.localeCompare(a.data_inicio) ||
    a.id.localeCompare(b.id)
  );
}
const occurrenceForEvent = (event: SpecialDate): DateOccurrence => ({
  id: event.id,
  nome: event.nome,
  categoria: event.categoria,
  origem:
    event.alcance !== "empresa"
      ? "individual"
      : event.estabelecimento_id
        ? "estabelecimento"
        : "empresa",
  expediente: event.expediente,
});
const notesTogether = (values: string[]) =>
  unique(
    values.flatMap((value) => value.split("\n").map((part) => part.trim())),
  ).join("\n");

/** Separate date natures from the effective work decision, retaining both. */
export function projectDay(day: Day, context: CalendarContext): Day {
  const location = employeeLocation(
    context.company,
    context.employee,
    context.establishments,
  );
  const base = baseForDay(day);
  const exception = day.calendario?.excecao ?? null;
  const applicable = context.events
    .filter((event) => eventApplies(event, day.data, context, location))
    .sort(compareEvents);
  const holiday = holidayAt(day.data, context.holidays ?? [], location);
  const changedOfficialNature = holiday && !base.feriado;
  if (
    !day.calendario &&
    !applicable.length &&
    !exception &&
    !changedOfficialNature
  )
    return day;

  const occurrences = applicable.map(occurrenceForEvent);
  if (
    holiday &&
    !occurrences.some(
      (entry) =>
        holidayCategories.has(entry.categoria) && entry.nome === holiday.nome,
    )
  )
    occurrences.push({
      id: `oficial:${holiday.id}`,
      nome: holiday.nome,
      categoria: `feriado_${holiday.abrangencia}` as SpecialDateCategory,
      origem: "oficial",
      expediente:
        base.intervalos.length && !day.calendario?.folgar_feriado
          ? "normal"
          : "sem_expediente",
    });
  if (
    base.feriado &&
    !occurrences.some(
      (entry) =>
        holidayCategories.has(entry.categoria) && entry.nome === base.feriado,
    )
  )
    occurrences.push({
      id: `legado:${day.data}:${base.feriado}`,
      nome: base.feriado,
      categoria: "feriado_especifico",
      origem: "empresa",
      expediente:
        base.intervalos.length && !day.calendario?.folgar_feriado
          ? "normal"
          : "sem_expediente",
    });

  let shifts = day.calendario?.folgar_feriado
    ? []
    : structuredClone(base.intervalos);
  const winner = applicable[0];
  if (winner?.expediente === "sem_expediente") shifts = [];
  else if (winner?.expediente === "normal" && !base.folga)
    shifts = structuredClone(base.intervalos);
  else if (
    winner?.expediente === "reduzido" &&
    base.intervalos.length &&
    !base.folga
  )
    shifts = structuredClone(winner.intervalos);
  // Normal/individual decisions never create a shift on a programmed rest day.
  if (exception) {
    shifts =
      exception.expediente === "sem_expediente" ||
      exception.categoria === "folga" ||
      exception.categoria === "sem_expediente"
        ? []
        : structuredClone(exception.intervalos);
    const category: SpecialDateCategory | null =
      exception.categoria === "feriado"
        ? "feriado_especifico"
        : ["ponto_facultativo", "recesso", "sem_expediente"].includes(
              exception.categoria,
            )
          ? (exception.categoria as SpecialDateCategory)
          : null;
    if (category)
      occurrences.unshift({
        id: `excecao:${day.data}`,
        nome: exception.nome.trim() || categoryLabels[category],
        categoria: category,
        origem: "individual",
        expediente: exception.expediente,
      });
  }
  const holidays = unique(
    occurrences
      .filter((entry) => holidayCategories.has(entry.categoria))
      .map((entry) => entry.nome),
  );
  return {
    ...day,
    intervalos: shifts,
    folga: shifts.length === 0,
    feriado: holidays.join(" · ") || null,
    observacao: notesTogether([
      exception ? exception.observacao : base.observacao,
      ...applicable.map((event) => event.observacoes),
    ]),
    calendario: {
      ...day.calendario,
      base,
      excecao: exception ? structuredClone(exception) : null,
    },
    eventos: occurrences,
  };
}

function explicitlyClosed(day: Day, context: CalendarContext) {
  const exception = day.calendario?.excecao;
  if (exception)
    return (
      exception.expediente === "sem_expediente" ||
      exception.categoria === "folga" ||
      exception.categoria === "sem_expediente"
    );
  const location = employeeLocation(
    context.company,
    context.employee,
    context.establishments,
  );
  const winner = context.events
    .filter((event) => eventApplies(event, day.data, context, location))
    .sort(compareEvents)[0];
  return winner?.expediente === "sem_expediente";
}

/** Civil closures also remove the previous shift's tail, reversibly from base. */
export function projectSchedule(
  schedule: Schedule,
  company: Company,
  employee: Employee,
  events: SpecialDate[],
  establishments: Establishment[] = [],
  holidays: Holiday[] = [],
): Schedule {
  if (
    schedule.empresa_id !== company.id ||
    schedule.funcionario_id !== employee.id ||
    employee.empresa_id !== company.id
  )
    throw new Error(
      "A empresa, o funcionário e a escala do calendário devem corresponder.",
    );
  const context: CalendarContext = {
    company,
    employee,
    events,
    establishments,
    holidays,
  };
  const days = schedule.dias.map((day) => projectDay(day, context));
  const byDate = new Map(days.map((day) => [day.data, day]));
  const projected = days.map((day) => {
    const next = byDate.get(addDays(day.data, 1));
    if (!next || !explicitlyClosed(next, context)) return day;
    let changed = false;
    const shifts: Shift[] = [];
    for (const shift of day.intervalos) {
      let a: number, b: number;
      try {
        [a, b] = span(shift);
      } catch {
        shifts.push(shift);
        continue;
      }
      if (b <= 1440) shifts.push(shift);
      else {
        changed = true;
        if (a < 1440) shifts.push({ ...shift, end: "00:00", endDay: 1 });
      }
    }
    return changed
      ? {
          ...day,
          intervalos: shifts,
          folga: shifts.length === 0,
          calendario: {
            ...day.calendario,
            base: baseForDay(day),
            excecao: day.calendario?.excecao ?? null,
          },
        }
      : day;
  });
  return projected.every((day, index) => day === schedule.dias[index])
    ? schedule
    : { ...schedule, dias: projected };
}

/** An invalid legacy schedule remains available to its existing review UI. */
export function projectData(data: Data): Data {
  const resources = data as Data & {
    specialDates?: SpecialDate[];
    establishments?: Establishment[];
  };
  return {
    ...data,
    schedules: data.schedules.map((schedule) => {
      const company = data.companies.find(
        (entry) => entry.id === schedule.empresa_id,
      );
      const employee = data.employees.find(
        (entry) =>
          entry.id === schedule.funcionario_id &&
          entry.empresa_id === schedule.empresa_id,
      );
      if (!company || !employee) return schedule;
      try {
        // Reconcile saved civil dates before applying closures or exceptions:
        // projections from a neighbor must never replace the effective result.
        const days = validationDays(schedule, data.schedules);
        const reconciled =
          days.length === schedule.dias.length &&
          days.every((day, index) => day === schedule.dias[index])
            ? schedule
            : { ...schedule, dias: days };
        return projectSchedule(
          reconciled,
          company,
          employee,
          resources.specialDates ?? [],
          resources.establishments ?? [],
          data.holidays,
        );
      } catch {
        return schedule;
      }
    }),
  };
}

/** Regenerating a month preserves explicit exceptions, never projected closures. */
export function preserveIndividualExceptions(
  generated: Day[],
  previous: Day[],
): Day[] {
  const prior = new Map(previous.map((day) => [day.data, day]));
  return generated.map((day) => {
    const exception = prior.get(day.data)?.calendario?.excecao;
    return exception
      ? {
          ...day,
          calendario: {
            ...day.calendario,
            base: baseForDay(day),
            excecao: structuredClone(exception),
          },
        }
      : day;
  });
}

/** Date-specific corporate closures must not turn into copied weekday rests. */
export function duplicationBaseDays(days: Day[]): Day[] {
  return days.map((day) => {
    if (!day.calendario) return day;
    const base = baseForDay(day);
    const exception = day.calendario.excecao;
    if (exception && ["trabalho", "folga"].includes(exception.categoria)) {
      const shifts =
        exception.categoria === "folga" ||
        exception.expediente === "sem_expediente"
          ? []
          : structuredClone(exception.intervalos);
      return {
        data: day.data,
        intervalos: shifts,
        folga: shifts.length === 0,
        feriado: null,
        observacao: exception.observacao,
      };
    }
    return { data: day.data, ...base };
  });
}

export type DayPresentation = {
  label: string;
  kind:
    | "trabalho"
    | "folga"
    | "feriado"
    | "feriado_trabalhado"
    | "ponto_facultativo"
    | "recesso"
    | "sem_expediente";
  description: string;
  status: string;
  hasWork: boolean;
  isHoliday: boolean;
  names: string[];
};

export function dayPresentation(day: Day, days?: Day[]): DayPresentation {
  let hasWork: boolean;
  let invalid = false;
  try {
    hasWork =
      (days ? computeDay(day, [], days).worked : minutes(day.intervalos)) > 0;
  } catch {
    hasWork = day.intervalos.length > 0;
    invalid = true;
  }
  const occurrences = day.eventos ?? [];
  const exception = day.calendario?.excecao;
  const isHoliday =
    !!day.feriado?.trim() ||
    occurrences.some((event) => holidayCategories.has(event.categoria));
  const nature = occurrences.find(
    (event) => !holidayCategories.has(event.categoria),
  );
  const kind: DayPresentation["kind"] = isHoliday
    ? hasWork
      ? "feriado_trabalhado"
      : "feriado"
    : exception?.categoria === "folga"
      ? "folga"
      : exception?.categoria === "trabalho"
        ? hasWork
          ? "trabalho"
          : "folga"
        : nature
          ? (nature.categoria as DayPresentation["kind"])
          : hasWork
            ? "trabalho"
            : "folga";
  const labels: Record<DayPresentation["kind"], string> = {
    trabalho: "Trabalho",
    folga: "Folga",
    feriado: "Feriado",
    feriado_trabalhado: "Feriado trabalhado",
    ponto_facultativo: "Ponto facultativo",
    recesso: "Recesso empresarial",
    sem_expediente: "Dia sem expediente",
  };
  const details = occurrences.map(
    (event) => `${categoryLabels[event.categoria]}: ${event.nome}`,
  );
  if (
    day.feriado &&
    !occurrences.some((event) => holidayCategories.has(event.categoria))
  )
    details.push(`Feriado: ${day.feriado}`);
  if (day.calendario?.base.folga && occurrences.length)
    details.push("Folga já programada");
  if (exception?.categoria === "folga") details.push("Folga individual");
  const decision = exception?.expediente ?? occurrences[0]?.expediente;
  return {
    label: labels[kind],
    kind,
    description: unique(details).join(" · "),
    status: invalid
      ? "Horários a conferir"
      : !hasWork
        ? "Sem expediente"
        : decision === "individual"
          ? "Configuração individual pendente"
          : decision === "reduzido"
            ? "Expediente reduzido"
            : "Expediente normal",
    hasWork,
    isHoliday,
    names: unique([
      ...occurrences.map((entry) => entry.nome),
      ...(!occurrences.some((event) =>
        holidayCategories.has(event.categoria),
      ) && day.feriado
        ? [day.feriado]
        : []),
    ]),
  };
}

/** Civil-date holiday hours are counted once, in clock minutes, including carry. */
export function specialDateTotals(schedule: Schedule, rules: LegalRule[] = []) {
  const totals = {
    workDays: 0,
    restDays: 0,
    holidays: 0,
    workingHolidays: 0,
    holidayMinutes: 0,
    optionalDays: 0,
    recessDays: 0,
    noWorkDays: 0,
    invalidDays: 0,
  };
  for (const day of schedule.dias.filter((entry) =>
    entry.data.startsWith(schedule.mes.slice(0, 7)),
  )) {
    const view = dayPresentation(day, schedule.dias);
    const categories = new Set(
      day.eventos?.map((event) => event.categoria) ?? [],
    );
    if (
      categories.has("ponto_facultativo") ||
      day.calendario?.excecao?.categoria === "ponto_facultativo"
    )
      totals.optionalDays++;
    if (
      categories.has("recesso") ||
      day.calendario?.excecao?.categoria === "recesso"
    )
      totals.recessDays++;
    if (
      categories.has("sem_expediente") ||
      day.calendario?.excecao?.categoria === "sem_expediente"
    )
      totals.noWorkDays++;
    if (view.isHoliday) totals.holidays++;
    let worked: number;
    try {
      worked = computeDay(day, rules, schedule.dias).worked;
    } catch {
      totals.invalidDays++;
      continue;
    }
    if (worked > 0) totals.workDays++;
    else totals.restDays++;
    if (view.isHoliday && worked > 0) {
      totals.workingHolidays++;
      totals.holidayMinutes += worked;
    }
  }
  return totals;
}

export function validateSpecialDate(
  value: Omit<SpecialDate, "id"> | SpecialDate,
  employees: Employee[],
  establishments: Establishment[],
  companyId: string,
): void {
  if (!companyId || value.empresa_id !== companyId)
    throw new Error("A data deve pertencer à empresa ativa.");
  if (!value.nome?.trim() || value.nome.length > 200)
    throw new Error(
      "Informe um nome de até 200 caracteres para a data especial.",
    );
  if (!Object.hasOwn(categoryLabels, value.categoria))
    throw new Error("Escolha a categoria da data especial.");
  if (
    !isDate(value.data_inicio) ||
    (value.data_fim != null && !isDate(value.data_fim))
  )
    throw new Error("Informe datas válidas para o evento.");
  const end = value.data_fim ?? value.data_inicio;
  if (end < value.data_inicio)
    throw new Error("A data final não pode ser anterior à data inicial.");
  if (!["unica", "anual", "periodo"].includes(value.recorrencia))
    throw new Error("Escolha a recorrência do evento.");
  if (value.recorrencia === "unica" && end !== value.data_inicio)
    throw new Error(
      "Para mais de uma data, selecione período determinado ou repetição anual.",
    );
  if (value.recorrencia === "periodo" && !value.data_fim)
    throw new Error("Informe a data final do período.");
  const duration = (+dateUTC(end) - +dateUTC(value.data_inicio)) / 86400000;
  if (duration > (value.recorrencia === "anual" ? 366 : 3660))
    throw new Error(
      "O período excede o intervalo permitido para esta recorrência.",
    );
  if (typeof value.ativo !== "boolean" || typeof value.data_movel !== "boolean")
    throw new Error("Confira o status e a identificação de data móvel.");
  if (
    value.recorrencia === "anual" &&
    (value.data_movel || isMovableName(value.nome))
  )
    throw new Error(
      "Datas móveis precisam ser cadastradas para o ano correto; não use repetição anual de uma data fixa.",
    );
  if (
    !["empresa", "selecionados", "funcionario"].includes(value.alcance) ||
    !Array.isArray(value.funcionario_ids)
  )
    throw new Error("Escolha os funcionários abrangidos pelo evento.");
  const ids = value.funcionario_ids;
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string" || !id)
  )
    throw new Error("Não repita funcionários na abrangência do evento.");
  if (
    (value.alcance === "empresa" && ids.length) ||
    (value.alcance === "funcionario" && ids.length !== 1) ||
    (value.alcance === "selecionados" && !ids.length)
  )
    throw new Error(
      "A seleção de funcionários deve corresponder à abrangência escolhida.",
    );
  if (value.estabelecimento_id) {
    const establishment = establishments.find(
      (entry) =>
        entry.id === value.estabelecimento_id && entry.empresa_id === companyId,
    );
    if (!establishment || (value.ativo && !establishment.ativo))
      throw new Error("Selecione um estabelecimento ativo da empresa.");
  }
  for (const id of ids) {
    const employee = employees.find(
      (entry) => entry.id === id && entry.empresa_id === companyId,
    );
    if (
      !employee ||
      (value.estabelecimento_id &&
        employee.estabelecimento_id !== value.estabelecimento_id)
    )
      throw new Error(
        "Os funcionários selecionados devem pertencer à empresa e ao estabelecimento escolhidos.",
      );
  }
  if (
    value.categoria === "feriado_estadual" ||
    value.categoria === "feriado_municipal"
  ) {
    if (!value.uf || !/^[A-Z]{2}$/.test(value.uf))
      throw new Error("Informe a UF do feriado.");
    if (value.categoria === "feriado_municipal" && !value.cidade?.trim())
      throw new Error("Informe o município do feriado.");
  }
  if (
    !["sem_expediente", "normal", "reduzido", "individual"].includes(
      value.expediente,
    )
  )
    throw new Error("Escolha a situação do expediente.");
  if (
    value.categoria === "sem_expediente" &&
    value.expediente !== "sem_expediente"
  )
    throw new Error(
      "Um dia sem expediente não pode ter trabalho programado neste evento.",
    );
  if (!Array.isArray(value.intervalos))
    throw new Error("Confira os horários específicos do evento.");
  if (value.expediente !== "reduzido" && value.intervalos.length)
    throw new Error(
      "Use horários específicos somente para expediente reduzido.",
    );
  if (value.expediente === "reduzido") {
    if (!value.intervalos.length)
      throw new Error("Informe os horários do expediente reduzido.");
    const ranges = value.intervalos.map(span).sort((a, b) => a[0] - b[0]);
    if (
      ranges.some(
        (range, index) => index > 0 && range[0] < ranges[index - 1][1],
      )
    )
      throw new Error(
        "Os horários do expediente reduzido não podem se sobrepor.",
      );
  }
}
