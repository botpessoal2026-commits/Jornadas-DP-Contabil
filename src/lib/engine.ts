import type {
  Alert,
  Company,
  Employee,
  Day,
  Holiday,
  LegalRule,
  Model,
  Shift,
} from "./types";
export const dateISO = (date: Date) => date.toISOString().slice(0, 10);
export const dateUTC = (s: string) => new Date(`${s}T00:00:00Z`);
export function addDays(s: string, n: number) {
  const d = dateUTC(s);
  d.setUTCDate(d.getUTCDate() + n);
  return dateISO(d);
}
export function monday(s: string) {
  return addDays(s, -((dateUTC(s).getUTCDay() + 6) % 7));
}
export function monthDates(month: string) {
  const start = `${month.slice(0, 7)}-01`;
  const next = dateUTC(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const dates: string[] = [];
  for (let d = start; d < dateISO(next); d = addDays(d, 1)) dates.push(d);
  return dates;
}
export function clock(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error(`Horário inválido: ${value}`);
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
export function span(shift: Shift): [number, number] {
  const offset = shift.startDay ?? 0;
  const start = clock(shift.start),
    end = clock(shift.end);
  const day = shift.endDay ?? offset + (end <= start ? 1 : 0);
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 1 ||
    !Number.isInteger(day) ||
    day < offset ||
    day > 1
  )
    throw new Error("Turnos podem ocupar a data inicial e o dia seguinte.");
  const a = start + offset * 1440,
    b = end + day * 1440;
  if (b <= a || b - a > 1440) throw new Error("Duração inválida do turno.");
  return [a, b];
}
export const minutes = (shifts: Shift[]) =>
  shifts.reduce((sum, s) => {
    const [a, b] = span(s);
    return sum + b - a;
  }, 0);
export function formatMinutes(n: number) {
  const v = Math.round(n);
  return `${Math.floor(v / 60)}h${String(v % 60).padStart(2, "0")}`;
}
export function activeRule(rules: LegalRule[], key: string, date: string) {
  return rules
    .filter((r) => r.chave === key && r.inicio_vigencia <= date)
    .sort((a, b) => b.inicio_vigencia.localeCompare(a.inicio_vigencia))[0];
}
export function numberValue(
  rule: LegalRule | undefined,
  key: string,
): number | undefined {
  const v = rule?.valor[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
export function holidayAt(date: string, holidays: Holiday[], company: Company) {
  return holidays.find(
    (h) =>
      h.data === date &&
      (h.abrangencia === "nacional" ||
        (h.uf === company.uf &&
          (h.abrangencia === "estadual" ||
            h.cidade?.toLocaleLowerCase("pt-BR") ===
              company.cidade.toLocaleLowerCase("pt-BR")))),
  );
}
export function generateDays(
  month: string,
  model: Model,
  company: Company,
  holidays: Holiday[],
  restOnHolidays = true,
  includeBoundary = true,
): Day[] {
  const dates = monthDates(month);
  const start = includeBoundary ? addDays(monday(dates[0]), -1) : dates[0];
  const end = includeBoundary
    ? addDays(monday(dates.at(-1)!), 7)
    : dates.at(-1)!;
  const result: Day[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    let shifts = model.padrao[String(dateUTC(date).getUTCDay())] ?? [];
    if (model.tipo === "12x36") {
      if (!model.ciclo_inicio || !model.turno?.length)
        throw new Error("Informe data âncora e turno para o ciclo 12x36.");
      const delta = Math.round(
        (+dateUTC(date) - +dateUTC(model.ciclo_inicio)) / 86400000,
      );
      shifts = ((delta % 2) + 2) % 2 === 0 ? model.turno : [];
    }
    const holiday = holidayAt(date, holidays, company);
    const intervalos = holiday && restOnHolidays ? [] : structuredClone(shifts);
    result.push({
      data: date,
      intervalos,
      folga: intervalos.length === 0,
      feriado: holiday?.nome ?? null,
      observacao: "",
    });
  }
  return result;
}
function nightMinutes(shifts: Shift[], start: number, end: number) {
  let total = 0;
  for (const shift of shifts) {
    const [a, b] = span(shift);
    for (let day = -1; day <= 1; day++) {
      const x = start + day * 1440,
        y = end + day * 1440 + (end <= start ? 1440 : 0);
      total += Math.max(0, Math.min(b, y) - Math.max(a, x));
    }
  }
  return total;
}
export function calendarShifts(day: Day, days: Day[]): Shift[] {
  const ranges: [number, number][] = [];
  for (const shift of day.intervalos) {
    const [a, b] = span(shift);
    ranges.push([a, Math.min(b, 1440)]);
  }
  const previous = days.find((d) => d.data === addDays(day.data, -1));
  for (const shift of previous?.intervalos ?? []) {
    const [a, b] = span(shift);
    if (b > 1440) ranges.push([Math.max(0, a - 1440), b - 1440]);
  }
  const time = (n: number) =>
    `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  return ranges
    .filter(([a, b]) => b > a)
    .map(([a, b]) => ({
      start: time(a),
      end: b === 1440 ? "00:00" : time(b),
      ...(b === 1440 ? { endDay: 1 } : {}),
    }));
}
export function computeDay(day: Day, rules: LegalRule[], calendarDays?: Day[]) {
  const shifts = calendarDays
    ? calendarShifts(day, calendarDays)
    : day.intervalos;
  const worked = minutes(shifts);
  const r = activeRule(rules, "noturno", day.data);
  const start = numberValue(r, "inicio_minutos"),
    end = numberValue(r, "fim_minutos"),
    seconds = numberValue(r, "hora_reduzida_segundos"),
    premium = numberValue(r, "adicional_percentual");
  const night =
    start !== undefined && end !== undefined
      ? nightMinutes(shifts, start, end)
      : 0;
  const reduced = seconds && seconds > 0 ? (night * 3600) / seconds : night;
  return {
    worked,
    night,
    reducedNight: reduced,
    computed: worked - night + reduced,
    premiumPercent: premium,
  };
}
export function evaluate(
  days: Day[],
  rules: LegalRule[],
  company: Company,
  month: string,
  modelType?: Model["tipo"],
  employee?: Employee,
) {
  const alerts: Alert[] = [];
  const ordered = [...days].sort((a, b) => a.data.localeCompare(b.data));
  const selected = ordered.filter((d) => d.data.startsWith(month.slice(0, 7)));
  const alert = (
    date: string,
    code: string,
    message: string,
    r?: LegalRule,
    severity: Alert["severity"] = "erro",
  ) =>
    alerts.push({
      date,
      code,
      message,
      rule: r?.nome ?? "Configuração ausente",
      source:
        r?.fonte ?? "Cadastre uma regra e sua fonte em Parâmetros legais.",
      severity,
    });
  const contract = employee?.carga_semanal_minutos;
  const validContract =
    typeof contract === "number" &&
    Number.isInteger(contract) &&
    contract > 0 &&
    contract <= 10080;
  if (employee && !validContract)
    alert(
      selected[0]?.data ?? `${month.slice(0, 7)}-01`,
      "contrato_pendente",
      `${employee.nome}: carga semanal contratual não estruturada. Revise o cadastro; o texto não é convertido automaticamente.`,
      undefined,
      "aviso",
    );
  const used = new Set<string>();
  for (const day of ordered) {
    if (!selected.includes(day)) continue;
    const regime = activeRule(rules, "regime", day.data);
    const interval = activeRule(rules, "intervalo", day.data);
    const rest = activeRule(rules, "interjornada", day.data);
    const night = activeRule(rules, "noturno", day.data);
    const divisor = activeRule(rules, "divisor", day.data);
    for (const r of [regime, interval, rest, night, divisor]) {
      if (r && !r.confirmado && !used.has(r.id)) {
        alert(
          day.data,
          "pendente",
          `Regra pendente de conferência: ${r.nome}. ${r.observacao}`,
          r,
          "aviso",
        );
        used.add(r.id);
      }
    }
    if (!divisor)
      alert(
        day.data,
        "sem_divisor",
        "Fator do divisor mensal não configurado.",
      );
    if (!regime) {
      alert(
        day.data,
        "sem_regime",
        "Não existe regime cadastrado para esta data.",
      );
      continue;
    }
    const civilSpans = calendarShifts(day, ordered)
      .map(span)
      .sort((a, b) => a[0] - b[0]);
    if (civilSpans.some((p, i) => i > 0 && p[0] < civilSpans[i - 1][1]))
      alert(
        day.data,
        "sobreposicao_civil",
        "Turnos se sobrepõem, inclusive entre dias.",
        regime,
      );
    const worked = Math.max(
      computeDay(day, rules, ordered).computed,
      computeDay(day, rules).computed,
    );
    const daily =
      regime.valor.permite_limite_empresa === false
        ? numberValue(regime, "limite_diario_minutos")
        : (company.limite_diario_minutos ??
          numberValue(regime, "limite_diario_minutos"));
    if (daily === undefined)
      alert(day.data, "sem_limite", "Limite diário não configurado.", regime);
    else if (worked > daily + 0.001)
      alert(
        day.data,
        "diario",
        `${formatMinutes(worked)} na data civil ou na jornada iniciada supera o limite diário de ${formatMinutes(daily)}${company.limite_diario_minutos !== null && regime.valor.permite_limite_empresa !== false ? " previsto na configuração da empresa. CCT: " + (company.cct || "não informada") : "."}`,
        regime,
      );
    if (!interval)
      alert(
        day.data,
        "sem_intervalo",
        "Regra de intervalo intrajornada ausente.",
      );
    else if (day.intervalos.length) {
      const spans = day.intervalos.map(span).sort((a, b) => a[0] - b[0]);
      const actual = minutes(day.intervalos);
      const long = numberValue(interval, "acima_minutos"),
        short = numberValue(interval, "entre_inicio_minutos");
      const required =
        long !== undefined && actual > long
          ? numberValue(interval, "intervalo_longo_minutos")
          : short !== undefined && actual > short
            ? numberValue(interval, "intervalo_curto_minutos")
            : 0;
      const gaps = spans.slice(1).map((s, i) => s[0] - spans[i][1]);
      if (gaps.some((g) => g < 0))
        alert(
          day.data,
          "sobreposicao",
          "Intervalos de trabalho se sobrepõem.",
          interval,
        );
      if (required !== undefined && Math.max(0, ...gaps) < required)
        alert(
          day.data,
          "intrajornada",
          `Intervalo de ${required} min exigido; maior pausa: ${Math.max(0, ...gaps)} min.`,
          interval,
        );
    }
    if (day.intervalos.length) {
      const currentStart =
        +dateUTC(day.data) / 60000 +
        Math.min(...day.intervalos.map((s) => span(s)[0]));
      const prior = ordered
        .filter((d) => d.data < day.data && d.intervalos.length)
        .at(-1);
      const required = numberValue(rest, "minutos");
      if (!rest)
        alert(day.data, "sem_interjornada", "Regra de interjornada ausente.");
      if (prior && required !== undefined) {
        const priorEnd =
          +dateUTC(prior.data) / 60000 +
          Math.max(...prior.intervalos.map((s) => span(s)[1]));
        if (currentStart - priorEnd < required)
          alert(
            day.data,
            "interjornada",
            `Descanso de ${formatMinutes(currentStart - priorEnd)}; mínimo de ${formatMinutes(required)}.`,
            rest,
          );
      }
      if (!night)
        alert(day.data, "sem_noturno", "Regra de trabalho noturno ausente.");
      if (computeDay(day, rules).night > 0)
        alert(
          day.data,
          "noturno",
          `Trabalho noturno: ${formatMinutes(computeDay(day, rules).night)} de relógio, ${formatMinutes(computeDay(day, rules).reducedNight)} reduzidas; adicional parametrizado: ${computeDay(day, rules).premiumPercent ?? "não informado"}%. Não calcula remuneração nem prorrogação noturna.`,
          night,
          "aviso",
        );
    }
  }
  const weeks = [...new Set(selected.map((d) => monday(d.data)))].map(
    (start) => {
      const week = ordered.filter(
        (d) => d.data >= start && d.data <= addDays(start, 6),
      );
      const regimes = week.map((d) => activeRule(rules, "regime", d.data));
      const limits = regimes
        .map((r) => numberValue(r, "limite_semanal_minutos"))
        .filter((x): x is number => x !== undefined);
      const total = week.reduce(
        (s, d) => s + computeDay(d, rules, ordered).computed,
        0,
      );
      const limit = limits.length ? Math.min(...limits) : undefined;
      const rule = regimes.find(
        (r) => numberValue(r, "limite_semanal_minutos") === limit,
      );
      const reference =
        week.find((d) => d.data.startsWith(month.slice(0, 7)))?.data ?? start;
      if (week.length < 7)
        alert(
          reference,
          "semana_incompleta",
          "Semana incompleta: importe os dias adjacentes para validar horas e descansos.",
          rule,
          "aviso",
        );
      if (validContract && total > contract! + 0.001)
        alerts.push({
          date: reference,
          code: "contrato_semanal",
          severity: "erro",
          message: `${employee!.nome}: semana ${start}, ${formatMinutes(total)} supera a carga contratual de ${formatMinutes(contract!)}. Revise horários e instrumento aplicável.`,
          rule: "Carga semanal contratual",
          source:
            "Cadastro estruturado do funcionário; conferir contrato e CCT/ACT.",
        });
      if (limit !== undefined && total > limit + 0.001)
        alert(
          reference,
          "semanal",
          `Semana ${start}: ${formatMinutes(total)} excede ${formatMinutes(limit)}.`,
          rule,
        );
      if (new Set(regimes.map((r) => r?.id)).size > 1)
        alert(
          reference,
          "transicao",
          `Semana de transição (${start} a ${addDays(start, 6)}): aplicado preventivamente o menor teto, ${limit === undefined ? "ausente" : formatMinutes(limit)}. Confira o tratamento na CCT.`,
          rule,
          "aviso",
        );
      const rests = week.filter(
        (d) => computeDay(d, rules, ordered).worked === 0,
      ).length;
      const needed = Math.max(
        0,
        ...regimes.map((r) => numberValue(r, "descansos_semanais") ?? 0),
      );
      if (rests < needed && !(company.permite_6x1 && rests >= 1))
        alert(
          reference,
          "descanso",
          `${rests} descansos na semana; mínimo parametrizado: ${needed}.`,
          rule,
        );
      if (
        !company.permite_6x1 &&
        (modelType === "6x1" || (week.length === 7 && rests <= 1))
      )
        alert(
          reference,
          "6x1",
          "Escala 6x1 não autorizada na configuração da empresa. Confira a CCT.",
          rule,
        );
      if (
        regimes.some((r) => r?.valor.preferir_domingo === true) &&
        !week.some(
          (d) =>
            dateUTC(d.data).getUTCDay() === 0 &&
            computeDay(d, rules, ordered).worked === 0,
        )
      )
        alert(
          reference,
          "domingo",
          "Não há descanso no domingo nesta semana; confira a preferência e a CCT.",
          rule,
          "aviso",
        );
      return { start, end: addDays(start, 6), total, limit, rests };
    },
  );
  if (modelType === "12x36")
    alert(
      selected[0]?.data ?? `${month}-01`,
      "12x36",
      "Ciclo 12x36 exige conferência do instrumento aplicável. Os limites comuns continuam gerando alertas; nenhuma exceção é presumida.",
      activeRule(rules, "regime", selected[0]?.data ?? `${month}-01`),
      "aviso",
    );
  const periods = selected.reduce<
    { start: string; end: string; rule?: LegalRule; divisor?: number }[]
  >((out, d) => {
    const r = activeRule(rules, "regime", d.data);
    const f = numberValue(activeRule(rules, "divisor", d.data), "fator");
    const weekly = numberValue(r, "limite_semanal_minutos");
    const divisor =
      f !== undefined && weekly !== undefined ? (weekly / 60) * f : undefined;
    const last = out.at(-1);
    if (last && last.rule?.id === r?.id && last.divisor === divisor)
      last.end = d.data;
    else out.push({ start: d.data, end: d.data, rule: r, divisor });
    return out;
  }, []);
  return {
    alerts,
    weeks,
    periods,
    total: selected.reduce(
      (s, d) => s + computeDay(d, rules, ordered).computed,
      0,
    ),
    clockTotal: selected.reduce(
      (s, d) => s + computeDay(d, rules, ordered).worked,
      0,
    ),
  };
}
const weekdays = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function dominioText(model: Model) {
  if (model.tipo === "12x36")
    return `12x36, início do ciclo: ${model.ciclo_inicio}; ${model.turno?.map((s) => `${s.start} às ${s.end}${s.endDay ? " (dia seguinte)" : ""}`).join(" e ")}; conferir CCT.`;
  const groups = new Map<string, string[]>();
  const rest: string[] = [];
  for (const i of [1, 2, 3, 4, 5, 6, 0]) {
    const shifts = model.padrao[String(i)] ?? [];
    if (!shifts.length) {
      rest.push(weekdays[i]);
      continue;
    }
    const time = shifts
      .map(
        (s) =>
          `${s.start} às ${s.end}${span(s)[1] >= 1440 ? " (dia seguinte)" : ""}`,
      )
      .join(" e ");
    groups.set(time, [...(groups.get(time) ?? []), weekdays[i]]);
  }
  return (
    [...groups]
      .map(([time, days]) => `${days.join(", ")}, ${time}`)
      .join("; ") + `; descanso: ${rest.join(" e ") || "conforme ciclo"}`
  );
}

/** Repete o calendário por dia da semana e ocorrência (1ª segunda etc.).
 * Feriados de origem não viram folgas indevidas no destino; ciclos mantêm âncora.
 */
export function duplicateDays(
  source: Day[],
  targetMonth: string,
  model: Model,
  company: Company,
  holidays: Holiday[],
  restOnHolidays = true,
): Day[] {
  const generated = generateDays(
    targetMonth,
    model,
    company,
    holidays,
    restOnHolidays,
  );
  if (model.tipo === "12x36") return generated;
  const original = source;
  return generated.map((day) => {
    if (!day.data.startsWith(targetMonth) || (day.feriado && restOnHolidays))
      return day;
    const weekday = dateUTC(day.data).getUTCDay(),
      occurrence = Math.floor((Number(day.data.slice(8)) - 1) / 7);
    const prev = original
      .filter((d) => dateUTC(d.data).getUTCDay() === weekday)
      .sort((a, b) => a.data.localeCompare(b.data))[occurrence];
    if (!prev || (prev.feriado && !prev.intervalos.length)) return day;
    return {
      ...day,
      intervalos: structuredClone(prev.intervalos),
      folga: !prev.intervalos.length,
      observacao: prev.observacao,
    };
  });
}
