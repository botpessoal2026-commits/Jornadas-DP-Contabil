import { periodForAlert } from "./alerts";
import { holidaysForCompany, rulesForCompany } from "./company-resources";
import { constitutionalPhase, validateRegimeValues } from "./work-regime";
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
export function activeRule(
  rules: LegalRule[],
  key: string,
  date: string,
  modelType?: Model["tipo"],
) {
  return rules
    .filter(
      (r) =>
        r.chave === key &&
        r.inicio_vigencia <= date &&
        (key !== "regime" ||
          (r.valor.tipo_regime === "12x36") === (modelType === "12x36")),
    )
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
  return holidaysForCompany(holidays, company.id).find(
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
  if (model.empresa_id != null && model.empresa_id !== company.id)
    throw new Error(
      "O modelo de jornada deve pertencer à empresa selecionada.",
    );
  const dates = monthDates(month);
  const start = includeBoundary
    ? addDays(monday(dates[0]), model.tipo === "12x36" ? -15 : -1)
    : dates[0];
  const end = includeBoundary
    ? addDays(monday(dates.at(-1)!), model.tipo === "12x36" ? 21 : 7)
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
  modelOrType?: Model["tipo"] | Model,
  employee?: Employee,
) {
  rules = rulesForCompany(rules, company.id);
  const modelType =
    typeof modelOrType === "object" ? modelOrType.tipo : modelOrType;
  if (modelType === "12x36")
    return evaluate12x36(
      days,
      rules,
      company,
      month,
      typeof modelOrType === "object" ? modelOrType : undefined,
      employee,
    );
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
      ruleId: r?.id,
      period: periodForAlert({ code, date }),
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
    if (
      employee?.carga_diaria_minutos &&
      worked > employee.carga_diaria_minutos + 0.001
    )
      alerts.push({
        date: day.data,
        code: "contrato_diario",
        severity: "erro",
        message: `${employee.nome}: ${formatMinutes(worked)} supera a carga diária contratual de ${formatMinutes(employee.carga_diaria_minutos)}. Revise o contrato e os horários; o modelo não autoriza a diferença.`,
        rule: "Carga diária contratual",
        source:
          "Cadastro estruturado do funcionário; conferir contrato e CCT/ACT.",
      });
    if (
      employee &&
      employee.dias_descanso.includes(dateUTC(day.data).getUTCDay()) &&
      worked > 0
    )
      alerts.push({
        date: day.data,
        code: "descanso_contratual",
        severity: "aviso",
        message: `${employee.nome}: há trabalho planejado em dia de descanso contratual. Revise a jornada ou documente a exceção aplicável.`,
        rule: "Descanso contratual",
        source:
          "Dias de descanso cadastrados no vínculo; conferir contrato e CCT/ACT.",
      });
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
          period: { start, end: addDays(start, 6) },
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
    cycles: [] as CycleReport[],
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
type CycleReport = {
  start: string;
  end: string;
  worked: number;
  average: number;
  limit: number;
};

/** Special shift limits concern elapsed/actual minutes, not reduced night hours. */
function evaluate12x36(
  days: Day[],
  rules: LegalRule[],
  company: Company,
  month: string,
  model?: Model,
  employee?: Employee,
) {
  const ordered = [...days].sort((a, b) => a.data.localeCompare(b.data));
  const selected = ordered.filter((day) =>
    day.data.startsWith(month.slice(0, 7)),
  );
  const alerts: Alert[] = [];
  const cycles: CycleReport[] = [];
  const emitted = new Set<string>();
  const add = (
    date: string,
    code: string,
    message: string,
    rule?: LegalRule,
    severity: Alert["severity"] = "erro",
    period?: { start: string; end: string },
  ) => {
    alerts.push({
      date,
      code,
      message,
      rule: rule?.nome ?? "Regime especial 12×36 — CLT, art. 59-A",
      source:
        rule?.fonte ??
        "CLT, art. 59-A — https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm",
      ruleId: rule?.id,
      severity,
      period,
    });
  };
  const pending = (
    date: string,
    code: string,
    message: string,
    rule?: LegalRule,
  ) => {
    const key = `${code}:${rule?.id ?? "ausente"}:${constitutionalPhase(date).start}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    add(date, code, message, rule, "aviso");
  };
  const epoch = (date: string) => +dateUTC(date) / 60000;
  const ranges = ordered.flatMap((day) =>
    day.intervalos.map((shift) => {
      const [a, b] = span(shift);
      return [epoch(day.data) + a, epoch(day.data) + b] as [number, number];
    }),
  );
  const dates = new Set(ordered.map((day) => day.data));
  const complete = (start: string, end: string) => {
    for (let date = start; date <= end; date = addDays(date, 1))
      if (!dates.has(date)) return false;
    return true;
  };
  const restUnits = (start: string, end: string) => {
    const from = epoch(start),
      to = epoch(addDays(end, 1));
    const spans = ranges
      .filter(([a, b]) => b > from && a < to)
      .map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    let cursor = from,
      rests = 0;
    for (const [a, b] of spans) {
      if (a > cursor) rests += Math.floor((a - cursor) / 1440);
      cursor = Math.max(cursor, b);
    }
    return rests + Math.floor((to - cursor) / 1440);
  };
  const proof = (rule?: LegalRule) =>
    !!rule &&
    rule.confirmado &&
    !!rule.fonte.trim() &&
    rule.valor.comprovado === true &&
    ["acordo_individual", "cct", "act"].includes(
      String(rule.valor.fundamento_tipo),
    ) &&
    typeof rule.valor.fundamento_referencia === "string" &&
    !!rule.valor.fundamento_referencia.trim() &&
    !/demonstra|exemplo|fict[ií]ci|hip[oó]tese|n[aã]o valid/i.test(
      `${rule.valor.fundamento_referencia} ${rule.fonte}`,
    );
  if (
    employee &&
    (!employee.carga_semanal_minutos ||
      !Number.isInteger(employee.carga_semanal_minutos) ||
      employee.carga_semanal_minutos < 0 ||
      employee.carga_semanal_minutos > 10080)
  )
    pending(
      selected[0]?.data ?? `${month.slice(0, 7)}-01`,
      "contrato_pendente",
      `${employee.nome}: carga semanal contratual não estruturada. Revise o cadastro; a carga contratual é conferida pela média dos ciclos, sem impor o pico de uma semana isolada.`,
    );
  for (const day of selected) {
    const regime = activeRule(rules, "regime", day.data, "12x36");
    const phase = constitutionalPhase(day.data);
    if (!regime)
      pending(
        day.data,
        "sem_regime_12x36",
        "Cadastre parâmetros específicos do regime 12×36 e sua vigência. O teto diário comum da empresa não é aplicado aos plantões.",
      );
    else {
      try {
        validateRegimeValues(regime.valor);
      } catch {
        pending(
          day.data,
          "sem_regime_12x36",
          "Os parâmetros 12×36 estão incompletos ou incompatíveis com os limites próprios do regime. Confira duração, descanso, intervalo e alternância.",
          regime,
        );
      }
      if (!proof(regime))
        pending(
          day.data,
          "sem_fundamento_12x36",
          "Comprove o instrumento aplicável ao vínculo: acordo individual escrito, CCT ou ACT. Informe a referência e confirme a conferência; um exemplo demonstrativo não comprova o regime.",
          regime,
        );
      if (
        (numberValue(regime, "limite_media_semanal_minutos") ?? Infinity) >
          phase.weekly ||
        (numberValue(regime, "descansos_semanais") ?? 0) < phase.rests
      )
        pending(
          day.data,
          "sem_adequacao_12x36",
          `Revise os parâmetros para a vigência de ${phase.start}: teto semanal de ${formatMinutes(phase.weekly)} e ${phase.rests} repouso(s). O regime especial não dispensa a adequação à EC nº 141/2026.`,
          regime,
        );
    }
    for (const key of ["noturno", "divisor"]) {
      const rule = activeRule(rules, key, day.data);
      if (!rule)
        pending(
          day.data,
          `sem_${key}`,
          `Parâmetro de ${key} ausente para esta data.`,
        );
      else if (!rule.confirmado)
        pending(
          day.data,
          "pendente",
          `Regra pendente de conferência: ${rule.nome}. ${rule.observacao}`,
          rule,
        );
    }
    const civil = calendarShifts(day, ordered)
      .map(span)
      .sort((a, b) => a[0] - b[0]);
    if (civil.some(([a], i) => i > 0 && a < civil[i - 1][1]))
      add(
        day.data,
        "sobreposicao_civil",
        "Turnos se sobrepõem, inclusive entre dias.",
        regime,
      );
    if (!day.intervalos.length) continue;
    const spans = day.intervalos.map(span).sort((a, b) => a[0] - b[0]);
    const actual = minutes(day.intervalos);
    const elapsed = Math.max(...spans.map((s) => s[1])) - spans[0][0];
    const gaps = spans.slice(1).map(([a], i) => a - spans[i][1]);
    if (gaps.some((gap) => gap < 0))
      add(
        day.data,
        "sobreposicao",
        "Intervalos de trabalho se sobrepõem.",
        regime,
      );
    const configuredMaximum = numberValue(regime, "plantao_maximo_minutos");
    const maximum = Math.min(
      720,
      configuredMaximum && configuredMaximum > 0 ? configuredMaximum : 720,
    );
    if (elapsed > maximum || actual > maximum)
      add(
        day.data,
        "plantao_12x36",
        `Plantão com ${formatMinutes(elapsed)} entre início e término, ${formatMinutes(actual)} de trabalho efetivo; máximo permitido: ${formatMinutes(maximum)}.`,
        regime,
      );
    if (
      employee?.carga_diaria_minutos &&
      actual > employee.carga_diaria_minutos + 0.001
    )
      add(
        day.data,
        "contrato_diario",
        `${employee.nome}: ${formatMinutes(actual)} de trabalho efetivo supera a carga diária contratual de ${formatMinutes(employee.carga_diaria_minutos)}. Revise o cadastro contratual do vínculo 12×36.`,
        regime,
      );
    if (employee?.dias_descanso.includes(dateUTC(day.data).getUTCDay()))
      add(
        day.data,
        "descanso_contratual",
        `${employee.nome}: há plantão em dia cadastrado como descanso contratual. Confira a aplicabilidade desse cadastro ao ciclo 12×36.`,
        regime,
        "aviso",
      );
    const indemnified = regime?.valor.intervalo_tratamento === "indenizado";
    const requiredInterval = numberValue(regime, "intervalo_minimo_minutos");
    if (indemnified) {
      if (!proof(regime))
        pending(
          day.data,
          "sem_intervalo_12x36",
          "A indenização do intervalo deve estar documentada e conferida no instrumento aplicável. O sistema não calcula a indenização.",
          regime,
        );
    } else if (
      Math.max(0, ...gaps) <
      (requiredInterval && requiredInterval > 0 ? requiredInterval : 60)
    )
      add(
        day.data,
        "intrajornada",
        `Plantão 12×36: intervalo exigido de ${requiredInterval && requiredInterval > 0 ? requiredInterval : 60} min; maior pausa contínua: ${Math.max(0, ...gaps)} min.`,
        regime,
      );
    if (
      !indemnified &&
      requiredInterval !== undefined &&
      requiredInterval < 60 &&
      !["cct", "act"].includes(String(regime?.valor.fundamento_tipo))
    )
      pending(
        day.data,
        "sem_intervalo_12x36",
        "Confira o instrumento coletivo que fundamenta a redução do intervalo usufruído em relação à referência de 60 minutos.",
        regime,
      );
    const currentStart = epoch(day.data) + spans[0][0];
    const prior = ordered
      .filter((entry) => entry.data < day.data && entry.intervalos.length)
      .at(-1);
    if (prior) {
      const previousSpans = prior.intervalos.map(span);
      const previousStart =
        epoch(prior.data) + Math.min(...previousSpans.map(([a]) => a));
      const previousEnd =
        epoch(prior.data) + Math.max(...previousSpans.map(([, b]) => b));
      const requiredRest = Math.max(
        2160,
        numberValue(regime, "descanso_minimo_minutos") ?? 2160,
      );
      if (currentStart - previousEnd < requiredRest)
        add(
          day.data,
          "interjornada_12x36",
          `Descanso entre plantões de ${formatMinutes(Math.max(0, currentStart - previousEnd))}; mínimo de ${formatMinutes(requiredRest)} consecutivas, contado do término real do plantão anterior.`,
          regime,
        );
      if ((currentStart - previousStart) % 2880 !== 0)
        add(
          day.data,
          "alternancia_12x36",
          "O início do plantão não respeita a alternância de 48 horas em relação ao plantão anterior. Folgas adicionais podem suprimir plantões sem deslocar a âncora do ciclo.",
          regime,
        );
    } else if (!complete(addDays(day.data, -3), addDays(day.data, -1)))
      pending(
        day.data,
        "sem_contexto_12x36",
        "Faltam dias anteriores para conferir o descanso real entre plantões e a continuidade do ciclo entre meses.",
        regime,
      );
    if (model?.ciclo_inicio && model.turno?.length) {
      const anchor =
        epoch(model.ciclo_inicio) +
        Math.min(...model.turno.map((shift) => span(shift)[0]));
      if ((currentStart - anchor) % 2880 !== 0)
        pending(
          day.data,
          "sem_ancora_12x36",
          "A escala registrada diverge da âncora atual do modelo, que pode ter sido alterado depois da geração. Confira a referência histórica; o descanso e a alternância são validados pelos horários efetivamente registrados na escala.",
          regime,
        );
    }
    const night = activeRule(rules, "noturno", day.data);
    const computed = computeDay(day, rules);
    if (computed.night > 0)
      add(
        day.data,
        "noturno",
        `Trabalho noturno: ${formatMinutes(computed.night)} de relógio, ${formatMinutes(computed.reducedNight)} reduzidas; adicional parametrizado: ${computed.premiumPercent ?? "não informado"}%. O limite do plantão é conferido em horas de relógio; remuneração e prorrogação noturna exigem conferência própria.`,
        night,
        "aviso",
      );
  }
  // Fourteen civil days contain seven nominal 48-hour cycles. This is an
  // operational overload check, not a declaration of legal compensation.
  for (const day of selected) {
    const start = addDays(day.data, -13),
      end = day.data;
    const regime = activeRule(rules, "regime", day.data, "12x36");
    if (!complete(addDays(start, -1), end)) {
      pending(
        day.data,
        "sem_contexto_12x36",
        "Falta contexto completo de 14 dias, incluindo a véspera, para conferir a média de trabalho dos ciclos. Os dias ausentes não são presumidos como folga.",
        regime,
      );
      continue;
    }
    const from = epoch(start),
      to = epoch(addDays(end, 1));
    const worked = ranges.reduce(
      (sum, [a, b]) => sum + Math.max(0, Math.min(b, to) - Math.max(a, from)),
      0,
    );
    const phase = constitutionalPhase(day.data);
    const configured = numberValue(regime, "limite_media_semanal_minutos");
    const limit = Math.min(
      phase.weekly,
      configured && configured > 0 ? configured : phase.weekly,
    );
    const average = worked / 2;
    cycles.push({ start, end, average, limit, worked });
    const period = { start, end };
    const phases = new Set<string>();
    for (let date = start; date <= end; date = addDays(date, 1))
      phases.add(
        `${activeRule(rules, "regime", date, "12x36")?.id ?? "ausente"}:${constitutionalPhase(date).start}`,
      );
    const transitional = phases.size > 1;
    if (transitional)
      pending(
        day.data,
        "sem_transicao_12x36",
        "A janela de ciclos contém datas de vigências diferentes. Confira o tratamento da transição no instrumento aplicável; o teto novo não é aplicado retroativamente às horas anteriores. Os limites de cada plantão e o descanso de 36h continuam sendo verificados.",
        regime,
      );
    if (!transitional && average > limit + 0.001)
      add(
        day.data,
        "ciclo_12x36",
        `Média indicativa nos ciclos de ${start} a ${end}: ${formatMinutes(average)} por semana (${formatMinutes(worked)} efetivas em 14 dias), superior ao teto de ${formatMinutes(limit)}. Confira a compensação e a vigência do instrumento aplicável.`,
        regime,
        "erro",
        period,
      );
    const contract = employee?.carga_semanal_minutos;
    if (!transitional && contract && average > contract + 0.001)
      add(
        day.data,
        "contrato_ciclo_12x36",
        `${employee!.nome}: média de ${formatMinutes(average)} por semana nos ciclos supera a carga contratual de ${formatMinutes(contract)}.`,
        regime,
        "erro",
        period,
      );
  }
  const weeks = [...new Set(selected.map((day) => monday(day.data)))].map(
    (start) => {
      const end = addDays(start, 6);
      const reference =
        selected.find((day) => day.data >= start && day.data <= end)?.data ??
        start;
      const regime = activeRule(rules, "regime", reference, "12x36");
      const needed = Math.max(
        constitutionalPhase(end).rests,
        numberValue(regime, "descansos_semanais") ?? 0,
      );
      const rests = restUnits(start, end);
      const week = ordered.filter(
        (day) => day.data >= start && day.data <= end,
      );
      const phases = new Set(
        week.map(
          (day) =>
            `${activeRule(rules, "regime", day.data, "12x36")?.id ?? "ausente"}:${constitutionalPhase(day.data).start}`,
        ),
      );
      if (!complete(addDays(start, -1), end))
        pending(
          reference,
          "sem_contexto_12x36",
          "Faltam dias adjacentes para conferir os repousos contínuos de 24 horas. Uma data civil sem início de plantão não é presumida como repouso integral.",
          regime,
        );
      else if (phases.size > 1)
        pending(
          reference,
          "sem_transicao_12x36",
          "A semana contém vigências diferentes para o repouso semanal. Confira a regra de transição antes de comparar toda a semana com a exigência nova.",
          regime,
        );
      else if (rests < needed) {
        const monthly =
          regime?.valor.descanso_semanal_tratamento === "media_mensal";
        const collective =
          monthly &&
          regime?.valor.descanso_compensacao_comprovada === true &&
          typeof regime.valor.descanso_compensacao_referencia === "string" &&
          !!regime.valor.descanso_compensacao_referencia.trim() &&
          !/demonstra|exemplo|fict[ií]ci/i.test(
            regime.valor.descanso_compensacao_referencia,
          );
        if (monthly && !collective)
          pending(
            reference,
            "sem_compensacao_12x36",
            "A compensação mensal de repousos exige CCT ou ACT específico comprovado, separado do fundamento individual do 12×36. Informe e confira essa referência coletiva.",
            regime,
          );
        else if (collective) {
          // The whole calendar month and every seven-day gap must be available.
          const monthDays = monthDates(month);
          const fullMonth = complete(
            addDays(monthDays[0], -1),
            monthDays.at(-1)!,
          );
          const requiredMonth = Math.ceil((monthDays.length * needed) / 7);
          const monthlyRests = restUnits(monthDays[0], monthDays.at(-1)!);
          let weeklyMinimum = true;
          for (const day of selected) {
            const a = addDays(day.data, -6);
            if (
              !complete(addDays(a, -1), day.data) ||
              restUnits(a, day.data) < 1
            )
              weeklyMinimum = false;
          }
          if (!fullMonth)
            pending(
              reference,
              "sem_contexto_12x36",
              "A compensação de repousos não pode ser conferida sem o calendário mensal completo e os dias adjacentes.",
              regime,
            );
          else if (monthlyRests < requiredMonth || !weeklyMinimum)
            add(
              reference,
              "descanso_12x36",
              `Compensação mensal insuficiente: ${monthlyRests} repousos de 24h, referência mínima de ${requiredMonth} no mês, e exigência de ao menos um repouso em cada intervalo máximo de uma semana.`,
              regime,
              "erro",
              { start, end },
            );
        } else
          add(
            reference,
            "descanso_12x36",
            `${rests} repouso(s) contínuo(s) de 24 horas nesta semana; mínimo aplicável: ${needed}. Não são contadas como repouso integral as datas ocupadas pela continuação de plantões noturnos.`,
            regime,
            "erro",
            { start, end },
          );
      }
      return {
        start,
        end,
        rests,
        limit: undefined,
        total: week.reduce(
          (sum, day) => sum + computeDay(day, rules, ordered).computed,
          0,
        ),
      };
    },
  );
  const periods = selected.reduce<
    { start: string; end: string; rule?: LegalRule; divisor?: number }[]
  >((out, day) => {
    const rule = activeRule(rules, "regime", day.data, "12x36");
    const last = out.at(-1);
    if (
      last &&
      last.rule?.id === rule?.id &&
      constitutionalPhase(last.start).start ===
        constitutionalPhase(day.data).start
    )
      last.end = day.data;
    else out.push({ start: day.data, end: day.data, rule, divisor: undefined });
    return out;
  }, []);
  return {
    alerts,
    weeks,
    periods,
    cycles,
    total: selected.reduce(
      (sum, day) => sum + computeDay(day, rules, ordered).computed,
      0,
    ),
    clockTotal: selected.reduce(
      (sum, day) => sum + computeDay(day, rules, ordered).worked,
      0,
    ),
  };
}

const weekdays = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function dominioText(model: Model) {
  if (model.tipo === "12x36")
    return `12x36, início do ciclo: ${model.ciclo_inicio}; ${model.turno?.map((s) => `${s.start} às ${s.end}${s.endDay ? " (dia seguinte)" : ""}`).join(" e ")}; conferir o instrumento aplicável (acordo individual escrito, CCT ou ACT).`;
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
