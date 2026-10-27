import assert from "node:assert/strict";
import { test } from "node:test";
import { demoData } from "../src/lib/demo";
import {
  computeDay,
  duplicateDays,
  evaluate,
  generateDays,
  minutes,
} from "../src/lib/engine";
import {
  dayPresentation,
  duplicationBaseDays,
  employeeLocation,
  generateCalendarDays,
  mergeGeneratedCalendarPolicy,
  preserveIndividualExceptions,
  projectData,
  projectDay,
  projectSchedule,
  specialDateMatchesDate,
  specialDateIdentity,
  specialDateTotals,
  validateSpecialDate,
  type CalendarContext,
} from "../src/lib/special-dates";
import type { Data } from "../src/lib/store";
import { exportRows } from "../src/lib/exports";
import { buildTimesheet } from "../src/lib/timesheet";
import type {
  Day,
  DayException,
  Employee,
  Establishment,
  Holiday,
  Model,
  Schedule,
  SpecialDate,
} from "../src/lib/types";

const demo = demoData();
const company = demo.companies[0];
const employee: Employee = { ...demo.employees[0], dias_descanso: [] };
const colleague: Employee = {
  ...employee,
  id: "colega",
  nome: "Colega da mesma empresa",
};
const secondCompany = demo.companies[1];
const otherEmployee = demo.employees[1];
const shifts = [
  { start: "08:00", end: "12:00" },
  { start: "13:00", end: "17:24" },
];
const workday = (data = "2026-12-02", overrides: Partial<Day> = {}): Day => ({
  data,
  intervalos: structuredClone(shifts),
  folga: false,
  feriado: null,
  observacao: "Planejamento original",
  ...overrides,
});
const event = (overrides: Partial<SpecialDate> = {}): SpecialDate => ({
  id: "evento-a",
  empresa_id: company.id,
  estabelecimento_id: null,
  nome: "Data da empresa",
  data_inicio: "2026-12-02",
  data_fim: null,
  categoria: "feriado_especifico",
  alcance: "empresa",
  funcionario_ids: [],
  recorrencia: "unica",
  expediente: "sem_expediente",
  intervalos: [],
  observacoes: "Motivo cadastrado",
  ativo: true,
  data_movel: false,
  uf: null,
  cidade: null,
  ...overrides,
});
const context = (
  events: SpecialDate[] = [],
  person = employee,
  establishments: Establishment[] = [],
  holidays: Holiday[] = [],
): CalendarContext => ({
  company: person.empresa_id === company.id ? company : secondCompany,
  employee: person,
  events,
  establishments,
  holidays,
});
const schedule = (
  days = [workday()],
  overrides: Partial<Schedule> = {},
): Schedule => ({
  id: "escala-a",
  empresa_id: company.id,
  funcionario_id: employee.id,
  modelo_id: demo.models[0].id,
  mes: "2026-12-01",
  modelo_tipo: "5x2",
  nome_funcionario: employee.nome,
  dias: days,
  ...overrides,
});
const exception = (overrides: Partial<DayException> = {}): DayException => ({
  categoria: "trabalho",
  nome: "",
  expediente: "normal",
  intervalos: [{ start: "09:00", end: "12:00" }],
  observacao: "Exceção aprovada pelo DP",
  ...overrides,
});
const withException = (day: Day, value: DayException): Day => ({
  ...day,
  calendario: {
    base: {
      intervalos: structuredClone(day.intervalos),
      folga: day.folga,
      feriado: day.feriado,
      observacao: day.observacao,
    },
    excecao: value,
  },
});
const unitA: Establishment = {
  id: "dormentes",
  empresa_id: company.id,
  nome: "Unidade Dormentes",
  cidade: "Dormentes",
  uf: "PE",
  ativo: true,
};
const unitB: Establishment = {
  id: "petrolina",
  empresa_id: company.id,
  nome: "Unidade Petrolina",
  cidade: "Petrolina",
  uf: "PE",
  ativo: true,
};

test("calendário legado sem novas configurações conserva referências, horários e dados", () => {
  const source = demo.schedules[0];
  const before = structuredClone(source);
  const output = projectSchedule(
    source,
    company,
    employee,
    [],
    [],
    demo.holidays,
  );
  assert.equal(output, source);
  assert.deepEqual(output, before);
  const invalid = workday(undefined, {
    intervalos: [{ start: "abc", end: "12:00" }],
  });
  assert.equal(projectDay(invalid, context()), invalid);
  assert.equal(dayPresentation(invalid).status, "Horários a conferir");
});

test("feriado empresarial suspende a programação reversivelmente e conserva o motivo", () => {
  const source = workday();
  const before = structuredClone(source);
  const projected = projectDay(source, context([event()]));
  assert.equal(projected.folga, true);
  assert.equal(minutes(projected.intervalos), 0);
  assert.equal(projected.feriado, "Data da empresa");
  assert.deepEqual(projected.calendario?.base, {
    intervalos: source.intervalos,
    folga: false,
    feriado: null,
    observacao: source.observacao,
  });
  assert.match(projected.observacao, /Planejamento original/);
  assert.match(projected.observacao, /Motivo cadastrado/);
  const restored = projectDay(projected, context());
  assert.deepEqual(restored.intervalos, source.intervalos);
  assert.equal(restored.feriado, null);
  assert.equal(restored.observacao, source.observacao);
  assert.deepEqual(source, before);
});

test("feriado de um funcionário não afeta colega nem outra empresa da mesma conta", () => {
  const individual = event({
    alcance: "funcionario",
    funcionario_ids: [employee.id],
  });
  assert.equal(projectDay(workday(), context([individual])).folga, true);
  assert.equal(
    projectDay(workday(), context([individual], colleague)).folga,
    false,
  );
  assert.equal(
    projectDay(workday(), context([individual], otherEmployee)).folga,
    false,
  );
  const foreign = event({ empresa_id: secondCompany.id });
  assert.equal(projectDay(workday(), context([foreign])).folga, false);
});

test("municípios e estabelecimentos possuem calendários independentes sem usar a cidade do escritório", () => {
  const dormentes = { ...employee, estabelecimento_id: unitA.id };
  const petrolina = { ...colleague, estabelecimento_id: unitB.id };
  const municipal = event({
    categoria: "feriado_municipal",
    nome: "Feriado local",
    uf: "PE",
    cidade: "DORMENTES",
  });
  const units = [unitA, unitB];
  assert.equal(
    projectDay(workday(), context([municipal], dormentes, units)).folga,
    true,
  );
  assert.equal(
    projectDay(workday(), context([municipal], petrolina, units)).folga,
    false,
  );
  const location = employeeLocation(company, dormentes, units);
  assert.equal(location.cidade, "Dormentes");
  assert.equal(location.nome, company.nome);
  assert.equal(location.id, company.id);
  assert.equal(company.cidade, "Recife");
  assert.throws(
    () =>
      employeeLocation(company, dormentes, [
        { ...unitA, empresa_id: secondCompany.id },
      ]),
    /Estabelecimento indisponível/,
  );
});

test("feriado oficial municipal usa a localidade do estabelecimento e mantém registros gerais isolados", () => {
  const local: Holiday = {
    id: "oficial-local",
    nome: "Data municipal",
    data: "2026-12-02",
    abrangencia: "municipal",
    uf: "PE",
    cidade: "Dormentes",
  };
  const a = projectDay(
    workday(),
    context(
      [],
      { ...employee, estabelecimento_id: unitA.id },
      [unitA, unitB],
      [local],
    ),
  );
  const b = projectDay(
    workday(),
    context(
      [],
      { ...colleague, estabelecimento_id: unitB.id },
      [unitA, unitB],
      [local],
    ),
  );
  assert.equal(a.feriado, local.nome);
  assert.equal(dayPresentation(a).kind, "feriado_trabalhado");
  assert.equal(b.feriado, null);
  const foreign = { ...local, empresa_id: secondCompany.id };
  assert.equal(
    projectDay(workday(), context([], employee, [], [foreign])).feriado,
    null,
  );
});

test("feriado trabalhado mantém horários individuais e totaliza apenas as horas previstas", () => {
  const day = withException(workday(), exception());
  const projected = projectDay(day, context([event()]));
  assert.equal(projected.feriado, "Data da empresa");
  assert.deepEqual(projected.intervalos, exception().intervalos);
  assert.equal(dayPresentation(projected).kind, "feriado_trabalhado");
  const totals = specialDateTotals(schedule([projected]));
  assert.equal(totals.holidays, 1);
  assert.equal(totals.workingHolidays, 1);
  assert.equal(totals.holidayMinutes, 180);
  assert.equal(totals.workDays, 1);
});

test("feriado coincidente com folga não cria jornada e preserva as duas informações", () => {
  const source = workday(undefined, { intervalos: [], folga: true });
  const projected = projectDay(
    source,
    context([event({ expediente: "normal" })]),
  );
  assert.equal(projected.intervalos.length, 0);
  assert.equal(dayPresentation(projected).label, "Feriado");
  assert.match(dayPresentation(projected).description, /Folga já programada/);
  assert.equal(specialDateTotals(schedule([projected])).workingHolidays, 0);
});

test("ponto facultativo com expediente normal não elimina horários nem se torna feriado legal", () => {
  const optional = event({
    categoria: "ponto_facultativo",
    nome: "Ponto facultativo da empresa",
    expediente: "normal",
  });
  const source = workday();
  const projected = projectDay(source, context([optional]));
  assert.deepEqual(projected.intervalos, source.intervalos);
  assert.equal(projected.feriado, null);
  assert.equal(dayPresentation(projected).kind, "ponto_facultativo");
  assert.equal(dayPresentation(projected).status, "Expediente normal");
  assert.equal(specialDateTotals(schedule([projected])).optionalDays, 1);
  assert.equal(specialDateTotals(schedule([projected])).holidays, 0);
});

test("ponto facultativo sem expediente depende da decisão explícita da empresa", () => {
  const optional = event({
    categoria: "ponto_facultativo",
    expediente: "sem_expediente",
  });
  const projected = projectDay(workday(), context([optional]));
  assert.equal(projected.intervalos.length, 0);
  assert.equal(projected.feriado, null);
  assert.equal(dayPresentation(projected).status, "Sem expediente");
  assert.equal(specialDateTotals(schedule([projected])).restDays, 1);
});

test("recesso de várias datas conserva feriados e folgas sem duplicar dias ou presumir férias", () => {
  const recess = event({
    categoria: "recesso",
    nome: "Recesso de final de ano",
    recorrencia: "periodo",
    data_inicio: "2026-12-24",
    data_fim: "2026-12-31",
  });
  const official: Holiday = {
    id: "natal",
    nome: "Natal",
    data: "2026-12-25",
    abrangencia: "nacional",
    uf: null,
    cidade: null,
  };
  const raw = schedule(
    generateDays("2026-12", demo.models[0], company, [], false),
  );
  const projected = projectSchedule(
    raw,
    company,
    employee,
    [recess],
    [],
    [official],
  );
  const closed = projected.dias.filter(
    (day) => day.data >= "2026-12-24" && day.data <= "2026-12-31",
  );
  assert.equal(closed.length, 8);
  assert.ok(closed.every((day) => day.intervalos.length === 0));
  const christmas = closed.find((day) => day.data === "2026-12-25")!;
  assert.match(
    dayPresentation(christmas).description,
    /Feriado nacional: Natal/,
  );
  assert.match(
    dayPresentation(christmas).description,
    /Recesso empresarial: Recesso de final de ano/,
  );
  assert.match(
    dayPresentation(closed.find((day) => day.data === "2026-12-26")!)
      .description,
    /Folga já programada/,
  );
  const totals = specialDateTotals(projected);
  assert.equal(totals.recessDays, 8);
  assert.equal(totals.holidays, 1);
  assert.equal(totals.workingHolidays, 0);
  assert.ok(!JSON.stringify(projected).includes("férias"));
  assert.ok(!JSON.stringify(projected).includes("desconto"));
});

test("funcionário pode trabalhar durante recesso sem alterar o período empresarial dos colegas", () => {
  const recess = event({ categoria: "recesso", nome: "Recesso empresarial" });
  const personal = projectDay(
    withException(workday(), exception()),
    context([recess]),
  );
  const common = projectDay(workday(), context([recess], colleague));
  assert.equal(minutes(personal.intervalos), 180);
  assert.equal(dayPresentation(personal).hasWork, true);
  assert.match(dayPresentation(personal).description, /Recesso empresarial/);
  assert.equal(common.intervalos.length, 0);
  assert.equal(recess.expediente, "sem_expediente");
});

test("dia sem expediente individual tem justificativa e permanece distinto de falta ou feriado", () => {
  const personal = withException(
    workday(),
    exception({
      categoria: "sem_expediente",
      nome: "Decisão administrativa",
      expediente: "sem_expediente",
      intervalos: [],
      observacao: "Fechamento para manutenção",
    }),
  );
  const projected = projectDay(personal, context());
  const view = dayPresentation(projected);
  assert.equal(view.kind, "sem_expediente");
  assert.equal(view.isHoliday, false);
  assert.equal(projected.observacao, "Fechamento para manutenção");
  assert.equal(specialDateTotals(schedule([projected])).noWorkDays, 1);
  assert.ok(!/falta|desconto|compensação/i.test(view.description));
});

test("excluir ou inativar evento empresarial preserva exceções individuais e restaura a programação base", () => {
  const shared = event();
  const first = projectDay(
    withException(workday(), exception()),
    context([shared]),
  );
  const second = projectDay(workday(), context([shared], colleague));
  const removed = projectDay(first, context());
  const inactive = projectDay(
    second,
    context([{ ...shared, ativo: false }], colleague),
  );
  assert.deepEqual(removed.intervalos, exception().intervalos);
  assert.deepEqual(removed.calendario?.excecao, first.calendario?.excecao);
  assert.equal(removed.feriado, null);
  assert.deepEqual(inactive.intervalos, shifts);
  assert.equal(inactive.feriado, null);
  assert.equal(first.intervalos.length, 1);
  assert.equal(second.intervalos.length, 0);
});

test("períodos e recorrência anual atravessam mês e ano sem expandir datas móveis", () => {
  const period = event({
    categoria: "recesso",
    data_inicio: "2026-12-30",
    data_fim: "2027-01-02",
    recorrencia: "periodo",
  });
  assert.equal(specialDateMatchesDate(period, "2026-12-29"), false);
  assert.equal(specialDateMatchesDate(period, "2026-12-31"), true);
  assert.equal(specialDateMatchesDate(period, "2027-01-02"), true);
  assert.equal(specialDateMatchesDate(period, "2027-01-03"), false);
  assert.equal(specialDateMatchesDate(period, "2027-12-30"), false);
  const annual = { ...period, recorrencia: "anual" as const };
  assert.equal(specialDateMatchesDate(annual, "2028-01-01"), true);
  assert.equal(specialDateMatchesDate(annual, "2026-01-01"), false);
  assert.equal(specialDateMatchesDate(annual, "2028-01-03"), false);
});

test("evento e exceção sobrevivem ao transporte JSON e à reabertura do calendário salvo", () => {
  const config = event({ categoria: "recesso" });
  const raw = schedule([withException(workday(), exception())]);
  const saved = projectSchedule(raw, company, employee, [config]);
  const reopened: Schedule = JSON.parse(JSON.stringify(saved));
  const loadedConfig: SpecialDate = JSON.parse(JSON.stringify(config));
  assert.deepEqual(
    projectSchedule(reopened, company, employee, [loadedConfig]),
    saved,
  );
  assert.equal(
    projectSchedule(reopened, company, employee, []).dias[0].intervalos[0]
      .start,
    "09:00",
  );
});

test("avisos e limites de jornada continuam ativos após a classificação de uma data especial", () => {
  const longDay = workday(undefined, {
    intervalos: [
      { start: "07:00", end: "12:00" },
      { start: "13:00", end: "20:00" },
    ],
  });
  const optional = event({
    categoria: "ponto_facultativo",
    expediente: "normal",
  });
  const before = evaluate(
    [longDay],
    demo.rules,
    company,
    "2026-12",
    "5x2",
    employee,
  );
  const after = evaluate(
    [projectDay(longDay, context([optional]))],
    demo.rules,
    company,
    "2026-12",
    "5x2",
    employee,
  );
  assert.ok(after.alerts.some((alert) => alert.code === "diario"));
  assert.deepEqual(after.alerts, before.alerts);
});

test("projeção de eventos normais conserva os modelos 5×2 e a âncora do ciclo 12×36", () => {
  const cycle: Model = {
    ...demo.models[0],
    tipo: "12x36",
    ciclo_inicio: "2026-12-31",
    turno: [
      { start: "19:00", end: "23:00" },
      { start: "00:00", end: "07:00", startDay: 1, endDay: 1 },
    ],
  };
  const raw = schedule(generateDays("2027-01", cycle, company, [], false), {
    mes: "2027-01-01",
    modelo_tipo: "12x36",
  });
  const config = event({ data_inicio: "2027-01-02", expediente: "normal" });
  const projected = projectSchedule(raw, company, employee, [config]);
  assert.deepEqual(
    projected.dias.map((day) => day.intervalos),
    raw.dias.map((day) => day.intervalos),
  );
  assert.equal(
    projected.dias.find((day) => day.data === "2027-01-01")?.intervalos.length,
    0,
  );
  assert.equal(
    projected.dias.find((day) => day.data === "2027-01-02")?.intervalos.length,
    2,
  );
  assert.equal(cycle.ciclo_inicio, "2026-12-31");
});

test("datas fixas anuais não se aplicam retroativamente nem convertem 29 de fevereiro", () => {
  const fixed = event({ recorrencia: "anual", data_inicio: "2026-12-02" });
  validateSpecialDate(fixed, [employee], [], company.id);
  assert.equal(specialDateMatchesDate(fixed, "2027-12-02"), true);
  assert.equal(specialDateMatchesDate(fixed, "2025-12-02"), false);
  const leap = event({ data_inicio: "2024-02-29", recorrencia: "anual" });
  assert.equal(specialDateMatchesDate(leap, "2025-02-28"), false);
  assert.equal(specialDateMatchesDate(leap, "2025-03-01"), false);
  assert.equal(specialDateMatchesDate(leap, "2028-02-29"), true);
});

test("Carnaval, Sexta-feira Santa e outras datas móveis exigem o ano correto", () => {
  for (const nome of [
    "Carnaval",
    "Sexta-feira Santa",
    "Paixão de Cristo",
    "Corpus Christi",
    "Páscoa",
    "Quarta-feira de Cinzas",
  ]) {
    const movable = event({ nome, recorrencia: "anual" });
    assert.throws(
      () => validateSpecialDate(movable, [employee], [], company.id),
      /Datas móveis/,
    );
    assert.equal(specialDateMatchesDate(movable, "2027-12-02"), false);
    validateSpecialDate(
      { ...movable, recorrencia: "unica" },
      [employee],
      [],
      company.id,
    );
  }
  assert.throws(
    () =>
      validateSpecialDate(
        event({ nome: "Outra data", data_movel: true, recorrencia: "anual" }),
        [employee],
        [],
        company.id,
      ),
    /Datas móveis/,
  );
});

test("validação rejeita datas impossíveis, intervalos inválidos e referências de outro contexto", () => {
  for (const invalid of [
    event({ data_inicio: "2026-02-30" }),
    event({ data_fim: "2026-12-01", recorrencia: "periodo" }),
    event({ data_fim: "2026-12-03", recorrencia: "unica" }),
    event({ recorrencia: "periodo" }),
    event({ empresa_id: secondCompany.id }),
    event({ alcance: "empresa", funcionario_ids: [employee.id] }),
    event({
      alcance: "funcionario",
      funcionario_ids: [employee.id, colleague.id],
    }),
    event({ alcance: "selecionados", funcionario_ids: [] }),
    event({
      alcance: "selecionados",
      funcionario_ids: [employee.id, employee.id],
    }),
    event({ alcance: "funcionario", funcionario_ids: [otherEmployee.id] }),
    event({
      estabelecimento_id: unitA.id,
      alcance: "funcionario",
      funcionario_ids: [employee.id],
    }),
    event({ categoria: "feriado_municipal", uf: "PE", cidade: "" }),
    event({ categoria: "sem_expediente", expediente: "normal" }),
    event({ expediente: "reduzido", intervalos: [] }),
    event({
      expediente: "reduzido",
      intervalos: [
        { start: "08:00", end: "12:00" },
        { start: "11:00", end: "13:00" },
      ],
    }),
  ])
    assert.throws(() =>
      validateSpecialDate(
        invalid,
        [employee, colleague, otherEmployee],
        [unitA, unitB],
        company.id,
      ),
    );
  assert.doesNotThrow(() =>
    validateSpecialDate(
      event({ categoria: "feriado_municipal", uf: "PE", cidade: "Recife" }),
      [employee],
      [],
      company.id,
    ),
  );
});

test("prioridade individual, estabelecimento e empresa é estável e mantém todas as naturezas", () => {
  const person = { ...employee, estabelecimento_id: unitA.id };
  const corporate = event({
    id: "empresa",
    categoria: "recesso",
    nome: "Recesso geral",
  });
  const unit = event({
    id: "unidade",
    estabelecimento_id: unitA.id,
    categoria: "ponto_facultativo",
    expediente: "reduzido",
    intervalos: [{ start: "09:00", end: "12:00" }],
  });
  const individual = event({
    id: "individual",
    alcance: "funcionario",
    funcionario_ids: [person.id],
    expediente: "normal",
    nome: "Feriado com expediente individual",
  });
  const all = [corporate, unit, individual];
  const output = projectDay(workday(), context(all, person, [unitA]));
  assert.deepEqual(output.intervalos, shifts);
  assert.equal(output.eventos?.length, 3);
  assert.match(
    dayPresentation(output).description,
    /Recesso empresarial: Recesso geral/,
  );
  const withoutIndividual = projectDay(
    workday(),
    context([corporate, unit], person, [unitA]),
  );
  assert.equal(minutes(withoutIndividual.intervalos), 180);
  assert.deepEqual(
    projectDay(workday(), context([...all].reverse(), person, [unitA])),
    output,
  );
  const sameScope = projectDay(
    workday(),
    context([event({ expediente: "normal", id: "normal" }), corporate]),
  );
  assert.equal(sameScope.intervalos.length, 0);
});

test("expediente reduzido usa horários definidos e nunca cria trabalho em folga herdada", () => {
  const reduced = event({
    categoria: "ponto_facultativo",
    expediente: "reduzido",
    intervalos: [{ start: "09:00", end: "12:00" }],
  });
  const projected = projectDay(workday(), context([reduced]));
  assert.equal(minutes(projected.intervalos), 180);
  assert.equal(dayPresentation(projected).status, "Expediente reduzido");
  const rest = projectDay(
    workday(undefined, { folga: true, intervalos: [] }),
    context([reduced]),
  );
  assert.equal(rest.intervalos.length, 0);
  assert.match(dayPresentation(rest).description, /Folga já programada/);
  const individualWork = projectDay(
    withException(
      workday(undefined, { folga: true, intervalos: [] }),
      exception(),
    ),
    context([reduced]),
  );
  assert.equal(minutes(individualWork.intervalos), 180);
});

test("fechamento civil corta reversivelmente a continuação noturna e respeita exceção na data fechada", () => {
  const previous = workday("2026-12-01", {
    intervalos: [{ start: "22:00", end: "06:00", endDay: 1 }],
  });
  const following = workday("2026-12-02", { intervalos: [], folga: true });
  const source = schedule([previous, following]);
  const closure = event({
    categoria: "sem_expediente",
    nome: "Fechamento administrativo",
  });
  const output = projectSchedule(source, company, employee, [closure]);
  assert.deepEqual(output.dias[0].intervalos, [
    { start: "22:00", end: "00:00", endDay: 1 },
  ]);
  assert.equal(computeDay(output.dias[1], [], output.dias).worked, 0);
  assert.deepEqual(
    projectSchedule(output, company, employee, []).dias.map(
      (day) => day.intervalos,
    ),
    source.dias.map((day) => day.intervalos),
  );
  assert.equal(computeDay(source.dias[1], [], source.dias).worked, 360);
  const exceptionOnClosedDate = schedule([
    previous,
    withException(
      following,
      exception({ intervalos: [{ start: "08:00", end: "12:00" }] }),
    ),
  ]);
  const reopened = projectSchedule(exceptionOnClosedDate, company, employee, [
    closure,
  ]);
  assert.deepEqual(reopened.dias[0].intervalos, previous.intervalos);
  assert.equal(computeDay(reopened.dias[1], [], reopened.dias).worked, 600);
});

test("fechamento noturno na virada de ano restaura a base sem perder a exceção do mês anterior", () => {
  const previous = withException(
    workday("2026-12-31"),
    exception({ intervalos: [{ start: "20:00", end: "08:00", endDay: 1 }] }),
  );
  const next = workday("2027-01-01", { intervalos: [], folga: true });
  const source = schedule([previous, next]);
  const closure = event({
    data_inicio: "2027-01-01",
    categoria: "recesso",
    nome: "Recesso no ano novo",
  });
  const projected = projectSchedule(source, company, employee, [closure]);
  assert.equal(computeDay(projected.dias[1], [], projected.dias).worked, 0);
  assert.deepEqual(
    projected.dias[0].calendario?.excecao,
    previous.calendario?.excecao,
  );
  const restored = projectSchedule(projected, company, employee, []);
  assert.equal(computeDay(restored.dias[1], [], restored.dias).worked, 480);
  assert.deepEqual(
    restored.dias[0].intervalos,
    previous.calendario?.excecao?.intervalos,
  );
});

test("horas de feriado noturno são por data civil e não duplicam hora reduzida ou eventos coincidentes", () => {
  const previous = workday("2026-12-01", {
    intervalos: [{ start: "22:00", end: "06:00", endDay: 1 }],
  });
  const holiday = workday("2026-12-02", {
    intervalos: [],
    folga: true,
    feriado: "Feriado do calendário",
  });
  const raw = schedule([previous, holiday]);
  const normal = event({ expediente: "normal", nome: "Feriado do calendário" });
  const projected = projectSchedule(raw, company, employee, [
    normal,
    { ...normal, id: "segunda-origem" },
  ]);
  const view = dayPresentation(projected.dias[1], projected.dias);
  assert.equal(view.kind, "feriado_trabalhado");
  assert.equal(view.hasWork, true);
  const totals = specialDateTotals(projected, demo.rules);
  assert.equal(totals.holidays, 1);
  assert.equal(totals.workingHolidays, 1);
  assert.equal(totals.holidayMinutes, 360);
  assert.equal(totals.restDays, 0);
  assert.equal(totals.workDays, 2);
  assert.equal(view.names.filter((name) => name === normal.nome).length, 1);
});

test("regeneração mantém exceções explícitas sobre a nova base sem reaplicar fechamentos removidos", () => {
  const old = projectDay(
    withException(workday(), exception()),
    context([event()]),
  );
  const generated = [
    workday(undefined, { intervalos: [{ start: "07:00", end: "11:00" }] }),
  ];
  const preserved = preserveIndividualExceptions(generated, [old]);
  assert.deepEqual(
    preserved[0].calendario?.base.intervalos,
    generated[0].intervalos,
  );
  assert.deepEqual(
    projectDay(preserved[0], context()).intervalos,
    exception().intervalos,
  );
  const inheritedOnly = projectDay(workday(), context([event()]));
  assert.equal(
    preserveIndividualExceptions(generated, [inheritedOnly])[0],
    generated[0],
  );
});

test("duplicação por dia da semana não transporta recessos nem eventos individuais datados", () => {
  const source = generateDays(
    "2026-12",
    demo.models[0],
    company,
    [],
    false,
    false,
  );
  const closure = event({ data_inicio: "2026-12-01", categoria: "recesso" });
  const projected = projectSchedule(schedule(source), company, employee, [
    closure,
  ]);
  const copied = duplicateDays(
    duplicationBaseDays(projected.dias),
    "2027-01",
    demo.models[0],
    company,
    [],
    false,
  );
  assert.deepEqual(
    copied.find((day) => day.data === "2027-01-05")?.intervalos,
    shifts,
  );
  const ordinaryEdit = withException(workday("2026-12-01"), exception());
  const ordinaryCopy = duplicateDays(
    duplicationBaseDays([
      ordinaryEdit,
      ...source.filter((day) => day.data !== ordinaryEdit.data),
    ]),
    "2027-01",
    demo.models[0],
    company,
    [],
    false,
  );
  assert.deepEqual(
    ordinaryCopy.find((day) => day.data === "2027-01-05")?.intervalos,
    exception().intervalos,
  );
  const dated = withException(
    workday("2026-12-01"),
    exception({
      categoria: "sem_expediente",
      expediente: "sem_expediente",
      intervalos: [],
    }),
  );
  assert.deepEqual(duplicationBaseDays([dated])[0].intervalos, shifts);
});

test("projeção de dados preserva consulta de legado inválido e não modifica empresas ou banco de horas", () => {
  const broken = schedule([
    workday(undefined, { intervalos: [{ start: "abc", end: "12:00" }] }),
  ]);
  const data: Data & {
    specialDates: SpecialDate[];
    establishments: Establishment[];
  } = {
    ...demo,
    employees: [
      { ...employee, estabelecimento_id: "unidade-indisponivel" },
      otherEmployee,
    ],
    schedules: [broken, demo.schedules[1]],
    specialDates: [event()],
    establishments: [],
  };
  const before = structuredClone(data);
  const result = projectData(data);
  assert.equal(result.schedules[0], broken);
  assert.equal(result.schedules[1], demo.schedules[1]);
  assert.deepEqual(result.companies, data.companies);
  assert.deepEqual(data, before);
  const badCounts = specialDateTotals(broken);
  assert.equal(badCounts.invalidDays, 1);
  assert.equal(badCounts.restDays, 0);
});

test("identidade de evento ignora ordem, ID, espaços e ano âncora anual sem misturar escopos", () => {
  const source = event({
    nome: "  Data   especial  ",
    recorrencia: "anual",
    alcance: "selecionados",
    funcionario_ids: ["b", "a"],
  });
  const equivalent = {
    ...source,
    id: "outro-id",
    nome: "data especial",
    data_inicio: "2027-12-02",
    funcionario_ids: ["a", "b"],
    observacoes: "Outra observação",
    expediente: "normal" as const,
  };
  assert.equal(specialDateIdentity(source), specialDateIdentity(equivalent));
  assert.notEqual(
    specialDateIdentity(source),
    specialDateIdentity({ ...source, empresa_id: secondCompany.id }),
  );
  assert.notEqual(
    specialDateIdentity(source),
    specialDateIdentity({ ...source, estabelecimento_id: unitA.id }),
  );
  assert.notEqual(
    specialDateIdentity(source),
    specialDateIdentity({ ...source, funcionario_ids: ["c"] }),
  );
  assert.notEqual(
    specialDateIdentity(source),
    specialDateIdentity({ ...source, recorrencia: "unica" }),
  );
  assert.equal(
    specialDateIdentity(event()),
    specialDateIdentity(event({ data_fim: "2026-12-02" })),
  );
});

test("identidade distingue localidade municipal e período anual completo de uma data isolada", () => {
  const local = event({
    categoria: "feriado_municipal",
    uf: "PE",
    cidade: "Dormentes",
  });
  assert.notEqual(
    specialDateIdentity(local),
    specialDateIdentity({ ...local, cidade: "Petrolina" }),
  );
  assert.equal(
    specialDateIdentity(local),
    specialDateIdentity({ ...local, cidade: " DORMENTES ", uf: "pe" }),
  );
  assert.equal(
    specialDateIdentity({ ...local, cidade: "São Paulo" }),
    specialDateIdentity({ ...local, cidade: " SAO   PAULO " }),
  );
  const annual = event({ recorrencia: "anual", data_inicio: "2026-12-02" });
  assert.notEqual(
    specialDateIdentity(annual),
    specialDateIdentity({ ...annual, data_fim: "2027-12-02" }),
  );
});

test("geração distingue a dispensa no feriado das horas cadastradas no modelo", () => {
  const christmas = demo.holidays.find(
    (holiday) => holiday.data === "2026-12-25",
  )!;
  const generated = generateCalendarDays("2026-12", demo.models[0], company, [
    christmas,
  ]);
  const holiday = generated.find((day) => day.data === christmas.data)!;
  assert.equal(minutes(holiday.intervalos), 0);
  assert.equal(holiday.folga, true);
  assert.equal(holiday.calendario?.folgar_feriado, true);
  assert.equal(holiday.calendario?.base.folga, false);
  assert.equal(minutes(holiday.calendario!.base.intervalos), 504);
  const defaultSchedule = projectSchedule(
    schedule(generated),
    company,
    employee,
    [],
    [],
    [christmas],
  );
  assert.equal(
    minutes(
      defaultSchedule.dias.find((day) => day.data === christmas.data)!
        .intervalos,
    ),
    0,
  );
  assert.equal(
    dayPresentation(
      defaultSchedule.dias.find((day) => day.data === christmas.data)!,
    ).description.includes("Folga já programada"),
    false,
  );
  assert.deepEqual(
    projectSchedule(defaultSchedule, company, employee, [], [], [christmas]),
    defaultSchedule,
  );
  assert.deepEqual(
    generateCalendarDays(
      "2026-12",
      demo.models[0],
      company,
      [christmas],
      false,
    ),
    generateDays("2026-12", demo.models[0], company, [christmas], false),
  );
});

test("evento normal ou reduzido usa a base real no feriado e exclusão restaura a dispensa", () => {
  const christmas = demo.holidays.find(
    (holiday) => holiday.data === "2026-12-25",
  )!;
  const original = schedule(
    generateCalendarDays("2026-12", demo.models[0], company, [christmas]),
  );
  const before = structuredClone(original);
  for (const [expediente, intervalos, expected] of [
    ["normal", [], 504],
    ["reduzido", [{ start: "08:00", end: "12:00" }], 240],
    ["sem_expediente", [], 0],
  ] as const) {
    const decision = event({
      data_inicio: christmas.data,
      expediente,
      intervalos: structuredClone([...intervalos]),
    });
    const applied = projectSchedule(
      original,
      company,
      employee,
      [decision],
      [],
      [christmas],
    );
    const holiday = applied.dias.find((day) => day.data === christmas.data)!;
    assert.equal(minutes(holiday.intervalos), expected);
    assert.equal(holiday.calendario?.folgar_feriado, true);
    assert.equal(minutes(holiday.calendario!.base.intervalos), 504);
    const restored = projectSchedule(
      applied,
      company,
      employee,
      [],
      [],
      [christmas],
    );
    assert.equal(
      minutes(
        restored.dias.find((day) => day.data === christmas.data)!.intervalos,
      ),
      0,
    );
    assert.deepEqual(
      restored.dias.find((day) => day.data === christmas.data)?.calendario
        ?.base,
      holiday.calendario?.base,
    );
  }
  assert.deepEqual(original, before);
});

test("normal e reduzido não criam expediente em folga real nem em legado sem horas originais", () => {
  const saturday: Holiday = {
    id: "feriado-sabado",
    empresa_id: company.id,
    nome: "Data no sábado",
    data: "2026-12-26",
    abrangencia: "nacional",
    cidade: null,
    uf: null,
  };
  const current = schedule(
    generateCalendarDays("2026-12", demo.models[0], company, [saturday]),
  );
  for (const expediente of ["normal", "reduzido"] as const) {
    const decision = event({
      data_inicio: saturday.data,
      expediente,
      intervalos:
        expediente === "reduzido" ? [{ start: "08:00", end: "12:00" }] : [],
    });
    const projected = projectSchedule(
      current,
      company,
      employee,
      [decision],
      [],
      [saturday],
    );
    const holiday = projected.dias.find((day) => day.data === saturday.data)!;
    assert.equal(minutes(holiday.intervalos), 0);
    assert.equal(holiday.calendario?.base.folga, true);
    assert.ok(
      dayPresentation(holiday).description.includes("Folga já programada"),
    );
  }
  const legacy = workday("2026-12-25", {
    intervalos: [],
    folga: true,
    feriado: "Natal",
  });
  const projectedLegacy = projectDay(
    legacy,
    context([event({ data_inicio: legacy.data, expediente: "normal" })]),
  );
  assert.equal(minutes(projectedLegacy.intervalos), 0);
  assert.equal(minutes(projectedLegacy.calendario!.base.intervalos), 0);
});

test("duplicação conserva ajustes de horários e a política fresca do feriado no destino", () => {
  const christmas = demo.holidays.find(
    (holiday) => holiday.data === "2026-12-25",
  )!;
  const source = generateDays(
    "2026-11",
    demo.models[0],
    company,
    [],
    false,
    false,
  );
  source.find((day) => day.data === "2026-11-27")!.intervalos = [
    { start: "09:00", end: "12:00" },
  ];
  const copied = duplicateDays(
    source,
    "2026-12",
    demo.models[0],
    company,
    [christmas],
    false,
  );
  const fresh = generateCalendarDays("2026-12", demo.models[0], company, [
    christmas,
  ]);
  const merged = mergeGeneratedCalendarPolicy(copied, fresh);
  const original = merged.find((day) => day.data === christmas.data)!;
  assert.equal(minutes(original.intervalos), 0);
  assert.equal(minutes(original.calendario!.base.intervalos), 180);
  const decision = event({ data_inicio: christmas.data, expediente: "normal" });
  const opened = projectSchedule(
    schedule(merged),
    company,
    employee,
    [decision],
    [],
    [christmas],
  );
  assert.equal(
    minutes(opened.dias.find((day) => day.data === christmas.data)!.intervalos),
    180,
  );
  const restored = projectSchedule(
    opened,
    company,
    employee,
    [],
    [],
    [christmas],
  );
  assert.equal(
    minutes(
      restored.dias.find((day) => day.data === christmas.data)!.intervalos,
    ),
    0,
  );
  assert.equal(
    merged.find((day) => day.data === "2026-12-04"),
    copied.find((day) => day.data === "2026-12-04"),
  );
  const unrestricted = generateCalendarDays(
    "2026-12",
    demo.models[0],
    company,
    [christmas],
    false,
  );
  assert.equal(
    mergeGeneratedCalendarPolicy(copied, unrestricted).find(
      (day) => day.data === christmas.data,
    ),
    copied.find((day) => day.data === christmas.data),
  );
});

test("uma folga manual copiada para feriado não é aberta ao reaplicar a configuração normal", () => {
  const christmas = demo.holidays.find(
    (holiday) => holiday.data === "2026-12-25",
  )!;
  const source = generateDays(
    "2026-11",
    demo.models[0],
    company,
    [],
    false,
    false,
  );
  const manualRest = source.find((day) => day.data === "2026-11-27")!;
  manualRest.intervalos = [];
  manualRest.folga = true;
  const copied = duplicateDays(
    source,
    "2026-12",
    demo.models[0],
    company,
    [christmas],
    false,
  );
  const fresh = generateCalendarDays("2026-12", demo.models[0], company, [
    christmas,
  ]);
  const merged = mergeGeneratedCalendarPolicy(copied, fresh);
  const holiday = merged.find((day) => day.data === christmas.data)!;
  assert.equal(holiday.calendario?.base.folga, true);
  const opened = projectSchedule(
    schedule(merged),
    company,
    employee,
    [event({ data_inicio: christmas.data, expediente: "normal" })],
    [],
    [christmas],
  );
  assert.equal(
    minutes(opened.dias.find((day) => day.data === christmas.data)!.intervalos),
    0,
  );
});

test("regeneração preserva a exceção individual usando somente a política nova do feriado", () => {
  const christmas = demo.holidays.find(
    (holiday) => holiday.data === "2026-12-25",
  )!;
  const closed = generateCalendarDays("2026-12", demo.models[0], company, [
    christmas,
  ]);
  const holiday = closed.find((day) => day.data === christmas.data)!;
  holiday.calendario!.excecao = exception();
  const previous = structuredClone(closed);
  const regenerated = preserveIndividualExceptions(
    generateCalendarDays(
      "2026-12",
      demo.models[0],
      company,
      [christmas],
      false,
    ),
    closed,
  );
  const restored = regenerated.find((day) => day.data === christmas.data)!;
  assert.equal(restored.calendario?.folgar_feriado, undefined);
  assert.deepEqual(restored.calendario?.excecao, exception());
  const defaulted = preserveIndividualExceptions(
    generateCalendarDays("2026-12", demo.models[0], company, [christmas]),
    regenerated,
  );
  assert.equal(
    defaulted.find((day) => day.data === christmas.data)?.calendario
      ?.folgar_feriado,
    true,
  );
  assert.deepEqual(closed, previous);
});

test("política do feriado preserva plantões 12×36 na virada do ano e restauração após corte noturno", () => {
  const model: Model = {
    ...demo.models[0],
    empresa_id: company.id,
    tipo: "12x36",
    ciclo_inicio: "2026-12-24",
    turno: [
      { start: "19:00", end: "23:00" },
      { start: "00:00", end: "07:00", startDay: 1, endDay: 1 },
    ],
  };
  const eve: Holiday = {
    id: "vespera",
    nome: "Data da unidade",
    data: "2026-12-24",
    abrangencia: "nacional",
    uf: null,
    cidade: null,
  };
  const generated = generateCalendarDays("2026-12", model, company, [eve]);
  assert.deepEqual(
    generated.map(({ calendario, eventos, ...day }) => day),
    generateDays("2026-12", model, company, [eve]),
  );
  const opening = event({ data_inicio: eve.data, expediente: "normal" });
  const closure = event({
    id: "fechamento-seguinte",
    data_inicio: "2026-12-25",
    categoria: "sem_expediente",
  });
  const projected = projectSchedule(
    schedule(generated, { modelo_tipo: "12x36" }),
    company,
    employee,
    [opening, closure],
    [],
    [eve],
  );
  const clipped = projected.dias.find((day) => day.data === eve.data)!;
  assert.equal(minutes(clipped.intervalos), 240);
  assert.equal(clipped.calendario?.folgar_feriado, true);
  assert.equal(minutes(clipped.calendario!.base.intervalos), 660);
  assert.deepEqual(
    projectSchedule(
      projected,
      company,
      employee,
      [opening, closure],
      [],
      [eve],
    ),
    projected,
  );
  const restored = projectSchedule(
    projected,
    company,
    employee,
    [opening],
    [],
    [eve],
  );
  assert.equal(
    minutes(restored.dias.find((day) => day.data === eve.data)!.intervalos),
    660,
  );
  const defaulted = projectSchedule(restored, company, employee, [], [], [eve]);
  assert.equal(
    minutes(defaulted.dias.find((day) => day.data === eve.data)!.intervalos),
    0,
  );
  const january = generateCalendarDays("2027-01", model, company, [eve]);
  assert.deepEqual(
    january.map(({ calendario, eventos, ...day }) => day),
    generateDays("2027-01", model, company, [eve]),
  );
  assert.equal(january.find((day) => day.data === "2027-01-01")?.folga, false);
  assert.equal(january.find((day) => day.data === "2027-01-02")?.folga, true);
});

function savedMonthBoundaryData(
  events: SpecialDate[],
  nextDayException?: DayException,
): Data {
  const previousDate = "2026-09-30";
  const currentDate = "2026-10-01";
  const morning = [{ start: "08:00", end: "12:00" }];
  const stalePrevious = workday(previousDate, { intervalos: morning });
  const actualPrevious = withException(
    stalePrevious,
    exception({ intervalos: [{ start: "22:00", end: "02:00", endDay: 1 }] }),
  );
  const nextForecast = workday(currentDate, { intervalos: morning });
  const actualNext = nextDayException
    ? withException(nextForecast, nextDayException)
    : nextForecast;
  return {
    ...demo,
    companies: [company],
    employees: [employee],
    holidays: [],
    specialDates: events,
    schedules: [
      schedule([actualPrevious, nextForecast], {
        id: "setembro-real",
        mes: "2026-09-01",
      }),
      schedule([stalePrevious, actualNext], {
        id: "outubro-real",
        mes: "2026-10-01",
      }),
    ],
  };
}

test("competências vizinhas usam a jornada noturna salva antes da projeção em calendário, exportação e folha", () => {
  const input = savedMonthBoundaryData([
    event({
      data_inicio: "2026-10-01",
      categoria: "ponto_facultativo",
      expediente: "normal",
    }),
  ]);
  const original = structuredClone(input);
  const projected = projectData(input);
  const october = projected.schedules[1];
  const first = october.dias.find((day) => day.data === "2026-10-01")!;
  assert.equal(computeDay(first, [], october.dias).worked, 360);
  assert.deepEqual(
    october.dias.find((day) => day.data === "2026-09-30")!.intervalos,
    [{ start: "22:00", end: "02:00", endDay: 1 }],
  );
  assert.equal(
    exportRows(october, [], employee, company)[0]["Horas relógio"],
    "6h00",
  );
  assert.ok(
    buildTimesheet(october, company, employee).rows[0].planned.includes(
      "00:00–02:00 (continuação)",
    ),
  );
  assert.deepEqual(projectData(projected), projected);
  assert.deepEqual(input, original);
});

test("fechamento civil na virada do mês recorta a jornada real do mês anterior e a exclusão a restaura", () => {
  const input = savedMonthBoundaryData([
    event({ data_inicio: "2026-10-01", categoria: "sem_expediente" }),
  ]);
  const original = structuredClone(input);
  const projected = projectData(input);
  for (const saved of projected.schedules) {
    assert.deepEqual(
      saved.dias.find((day) => day.data === "2026-09-30")!.intervalos,
      [{ start: "22:00", end: "00:00", endDay: 1 }],
    );
    const first = saved.dias.find((day) => day.data === "2026-10-01")!;
    assert.equal(computeDay(first, [], saved.dias).worked, 0);
  }
  assert.deepEqual(projectData(projected), projected);
  const restored = projectData({ ...projected, specialDates: [] });
  for (const saved of restored.schedules)
    assert.deepEqual(
      saved.dias.find((day) => day.data === "2026-09-30")!.intervalos,
      [{ start: "22:00", end: "02:00", endDay: 1 }],
    );
  assert.deepEqual(input, original);
});

test("exceção individual real da nova competência prevalece sobre a projeção de fechamento no mês anterior", () => {
  const input = savedMonthBoundaryData(
    [event({ data_inicio: "2026-10-01", categoria: "sem_expediente" })],
    exception({
      intervalos: [],
      observacao: "Manter continuação do plantão anterior",
    }),
  );
  const original = structuredClone(input);
  const projected = projectData(input);
  for (const saved of projected.schedules) {
    assert.deepEqual(
      saved.dias.find((day) => day.data === "2026-09-30")!.intervalos,
      [{ start: "22:00", end: "02:00", endDay: 1 }],
    );
    const first = saved.dias.find((day) => day.data === "2026-10-01")!;
    assert.equal(computeDay(first, [], saved.dias).worked, 120);
    assert.equal(
      first.calendario?.excecao?.observacao,
      "Manter continuação do plantão anterior",
    );
  }
  assert.deepEqual(projectData(projected), projected);
  assert.deepEqual(input, original);
});
