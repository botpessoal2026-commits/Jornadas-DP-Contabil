import assert from "node:assert/strict";
import { test } from "node:test";
import { demoData } from "../src/lib/demo";
import {
  activeRule,
  computeDay,
  duplicateDays,
  evaluate,
  generateDays,
} from "../src/lib/engine";
import {
  default12x36Values,
  regimeKey,
  scheduleRegime,
  validateRegimeValues,
} from "../src/lib/work-regime";
import type { Day, LegalRule, Model, Schedule } from "../src/lib/types";

const data = demoData();
const company = { ...data.companies[0], limite_diario_minutos: 504 };
const baseRules = data.rules
  .filter((rule) => rule.valor.tipo_regime !== "12x36")
  .map((rule) => ({ ...rule, confirmado: true }));
const special: LegalRule = {
  id: "regime-especial",
  empresa_id: company.id,
  chave: "regime",
  nome: "Regime especial documentado",
  inicio_vigencia: "2017-11-11",
  valor: {
    ...default12x36Values,
    fundamento_tipo: "acordo_individual",
    fundamento_referencia: "Instrumento escrito do vínculo, arquivo RH-527",
    comprovado: true,
  },
  fonte: "CLT, art. 59-A — documento conferido pelo DP",
  observacao: "Conferência do instrumento aplicável ao vínculo",
  confirmado: true,
};
const model: Model = {
  id: "modelo-neutro",
  empresa_id: company.id,
  nome: "Equipe de atendimento",
  tipo: "12x36",
  padrao: {},
  ciclo_inicio: "2026-10-01",
  turno: [
    { start: "07:00", end: "12:00" },
    { start: "13:00", end: "19:00" },
  ],
};
const rules = [...baseRules, special];
const generate = (m = model, month = "2026-10") =>
  generateDays(month, m, company, [], false);
const errors = (
  days: Day[],
  m: Model | Model["tipo"] = model,
  rs = rules,
  month = "2026-10",
) =>
  evaluate(days, rs, company, month, m).alerts.filter(
    (alert) => alert.severity === "erro",
  );

test("jornadas comuns de 8h e compensação de 8h24 conservam seus limites", () => {
  const common: Model = {
    ...model,
    nome: "12x36 no nome não muda o regime",
    tipo: "5x2",
    padrao: Object.fromEntries(
      [1, 2, 3, 4, 5].map((day) => [
        String(day),
        [
          { start: "08:00", end: "12:00" },
          { start: "13:00", end: "17:00" },
        ],
      ]),
    ),
  };
  const eight = evaluate(
    generate(common),
    rules,
    { ...company, limite_diario_minutos: 480 },
    "2026-10",
    common,
  );
  assert.ok(!eight.alerts.some((alert) => alert.code === "diario"));
  common.padrao["1"][1].end = "17:24";
  assert.ok(
    !evaluate(generate(common), rules, company, "2026-10", common).alerts.some(
      (alert) => alert.code === "diario",
    ),
  );
  assert.ok(
    evaluate(
      generate(common),
      rules,
      { ...company, limite_diario_minutos: 480 },
      "2026-10",
      common,
    ).alerts.some((alert) => alert.code === "diario"),
  );
  assert.equal(eight.cycles.length, 0);
});

test("12h de plantão com 1h de intervalo são 11h efetivas, sem falso teto diário ou semanal", () => {
  const report = evaluate(generate(), rules, company, "2026-10", model);
  assert.equal(
    report.alerts.filter((alert) => alert.severity === "erro").length,
    0,
  );
  assert.ok(report.cycles.length > 0);
  assert.equal(report.cycles[0].average, 2310);
  assert.equal(report.cycles[0].worked, 4620);
  assert.equal(report.weeks[0].limit, undefined);
  assert.equal(
    computeDay(
      generate().find((day) => day.data === "2026-10-01")!,
      rules,
    ).worked,
    660,
  );
  assert.ok(report.weeks.some((week) => week.total === 2640));
});

test("plantão noturno conta 12h de relógio, pausa após meia-noite e 36h de descanso", () => {
  const night: Model = {
    ...model,
    turno: [
      { start: "19:00", end: "00:00", endDay: 1 },
      { start: "01:00", end: "07:00", startDay: 1, endDay: 1 },
    ],
  };
  const report = evaluate(generate(night), rules, company, "2026-10", night);
  assert.equal(
    report.alerts.filter((alert) => alert.severity === "erro").length,
    0,
  );
  assert.ok(report.alerts.some((alert) => alert.code === "noturno"));
  assert.ok(report.weeks.every((week) => week.rests >= 2));
  assert.ok(report.total > report.clockTotal);
});

test("descanso real inferior a 36h e deslocamento da alternância são detectados", () => {
  const days = generate();
  const day = days.find((entry) => entry.data === "2026-10-03")!;
  day.intervalos = [
    { start: "06:00", end: "11:00" },
    { start: "12:00", end: "18:00" },
  ];
  const result = errors(days);
  assert.ok(
    result.some(
      (alert) => alert.code === "interjornada_12x36" && alert.date === day.data,
    ),
  );
  assert.ok(
    result.some(
      (alert) => alert.code === "alternancia_12x36" && alert.date === day.data,
    ),
  );
  assert.ok(!result.some((alert) => alert.code === "diario"));
});

test("duração do plantão inclui o intervalo e não apenas o trabalho efetivo", () => {
  const days = generate();
  days.find((day) => day.data === "2026-10-01")!.intervalos = [
    { start: "07:00", end: "12:00" },
    { start: "14:00", end: "20:00" },
  ];
  const result = errors(days);
  const excessive = result.find(
    (alert) => alert.code === "plantao_12x36" && alert.date === "2026-10-01",
  );
  assert.match(excessive!.message, /13h00.*11h00/);
});

test("pausas pequenas não somam intervalo contínuo e sobreposições continuam impeditivas", () => {
  const days = generate();
  days.find((day) => day.data === "2026-10-01")!.intervalos = [
    { start: "07:00", end: "11:00" },
    { start: "11:30", end: "15:00" },
    { start: "15:30", end: "19:00" },
  ];
  assert.ok(errors(days).some((alert) => alert.code === "intrajornada"));
  days.find((day) => day.data === "2026-10-01")!.intervalos[1].start = "10:30";
  assert.ok(errors(days).some((alert) => alert.code === "sobreposicao"));
});

test("fundamento individual comprovado não exige CCT e dados demonstrativos não comprovam", () => {
  const valid = evaluate(
    generate(),
    rules,
    { ...company, cct: "" },
    "2026-10",
    model,
  );
  assert.ok(
    !valid.alerts.some((alert) => alert.code === "sem_fundamento_12x36"),
  );
  const pendingValues: LegalRule["valor"][] = [
    { comprovado: false },
    { fundamento_tipo: "", fundamento_referencia: "" },
    { fundamento_referencia: "CCT demonstrativa, sem validade real" },
  ];
  for (const value of pendingValues) {
    const changed = [
      ...baseRules,
      { ...special, valor: { ...special.valor, ...value } },
    ];
    const result = evaluate(generate(), changed, company, "2026-10", model);
    assert.ok(
      result.alerts.some((alert) => alert.code === "sem_fundamento_12x36"),
    );
    assert.ok(
      !result.alerts.some(
        (alert) => alert.code === "diario" || alert.code === "semanal",
      ),
    );
  }
});

test("ausência de regra específica gera pendência sem deixar de detectar plantão excessivo", () => {
  const days = generate();
  days.find((day) => day.data === "2026-10-01")!.intervalos = [
    { start: "07:00", end: "20:00" },
  ];
  const report = evaluate(days, baseRules, company, "2026-10", model);
  assert.ok(report.alerts.some((alert) => alert.code === "sem_regime_12x36"));
  assert.ok(report.alerts.some((alert) => alert.code === "plantao_12x36"));
  assert.ok(!report.alerts.some((alert) => alert.code === "diario"));
});

test("intervalo indenizado depende de fundamento comprovado e não preenche a pausa", () => {
  const full: Model = { ...model, turno: [{ start: "07:00", end: "19:00" }] };
  const indemnified = {
    ...special,
    valor: { ...special.valor, intervalo_tratamento: "indenizado" },
  };
  const report = evaluate(
    generate(full),
    [...baseRules, indemnified],
    company,
    "2026-10",
    full,
  );
  assert.ok(!report.alerts.some((alert) => alert.code === "intrajornada"));
  assert.equal(report.cycles[0].average, 2520);
  const missing = evaluate(
    generate(full),
    [...baseRules, { ...indemnified, confirmado: false }],
    company,
    "2026-10",
    full,
  );
  assert.ok(
    missing.alerts.some((alert) => alert.code === "sem_intervalo_12x36"),
  );
});

test("continuidade entre meses mantém âncora e feriado suprimido não desloca o próximo plantão", () => {
  const anchored = { ...model, ciclo_inicio: "2026-12-31" };
  const january = generate(anchored, "2027-01");
  assert.equal(january.find((day) => day.data === "2027-01-01")?.folga, true);
  assert.equal(january.find((day) => day.data === "2027-01-02")?.folga, false);
  const december = generate(anchored, "2026-12");
  const copied = duplicateDays(
    december,
    "2027-01",
    anchored,
    company,
    [],
    false,
  );
  assert.deepEqual(copied, january);
  const october = generate();
  october.find((day) => day.data === "2026-10-03")!.intervalos = [];
  assert.ok(
    !errors(october).some((alert) => alert.code === "alternancia_12x36"),
  );
});

test("véspera real modificada é considerada e falta de contexto não é presumida como folga", () => {
  const days = generate();
  const prior = days.find((day) => day.data === "2026-09-29")!;
  prior.intervalos = [{ start: "19:00", end: "07:00", endDay: 1 }];
  assert.ok(
    errors(days).some(
      (alert) =>
        alert.code === "interjornada_12x36" && alert.date === "2026-10-01",
    ),
  );
  const report = evaluate(
    days.filter((day) => day.data.startsWith("2026-10")),
    rules,
    company,
    "2026-10",
    "12x36",
  );
  assert.ok(report.alerts.some((alert) => alert.code === "sem_contexto_12x36"));
});

test("regras 12x36 e comuns são selecionadas separadamente por vigência", () => {
  const next = {
    ...special,
    id: "futuro",
    inicio_vigencia: "2026-10-16",
    valor: { ...special.valor, plantao_maximo_minutos: 660 },
  };
  assert.equal(
    activeRule([...rules, next], "regime", "2026-10-15", "12x36")?.id,
    special.id,
  );
  assert.equal(
    activeRule([...rules, next], "regime", "2026-10-16", "12x36")?.id,
    next.id,
  );
  assert.notEqual(
    activeRule([...rules, next], "regime", "2026-10-16")?.id,
    next.id,
  );
  const report = evaluate(
    generate(),
    [...rules, next],
    company,
    "2026-10",
    model,
  );
  assert.ok(
    !report.alerts.some(
      (alert) => alert.code === "plantao_12x36" && alert.date < "2026-10-16",
    ),
  );
  assert.ok(
    report.alerts.some(
      (alert) => alert.code === "plantao_12x36" && alert.date >= "2026-10-16",
    ),
  );
  assert.notEqual(
    regimeKey(special),
    regimeKey(baseRules.find((rule) => rule.chave === "regime")!),
  );
});

test("EC141 exige adequação por vigência e ciclo integral de 12h não ganha imunidade a 40h", () => {
  const full: Model = { ...model, turno: [{ start: "07:00", end: "19:00" }] };
  const indemnified = {
    ...special,
    valor: { ...special.valor, intervalo_tratamento: "indenizado" },
  };
  const rs = [...baseRules, indemnified];
  const december = evaluate(
    generate(full, "2026-12"),
    rs,
    company,
    "2026-12",
    full,
  );
  assert.ok(
    !december.alerts.some(
      (alert) =>
        alert.code === "sem_adequacao_12x36" && alert.date < "2026-12-16",
    ),
  );
  assert.ok(
    december.alerts.some(
      (alert) =>
        alert.code === "sem_adequacao_12x36" && alert.date === "2026-12-16",
    ),
  );
  assert.ok(!december.alerts.some((alert) => alert.code === "ciclo_12x36"));
  const later = evaluate(
    generate(full, "2028-01"),
    rs,
    company,
    "2028-01",
    full,
  );
  assert.ok(later.alerts.some((alert) => alert.code === "ciclo_12x36"));
  const eleven = evaluate(
    generate(model, "2028-01"),
    rs,
    company,
    "2028-01",
    model,
  );
  assert.ok(!eleven.alerts.some((alert) => alert.code === "ciclo_12x36"));
  assert.ok(eleven.weeks.every((week) => week.rests >= 2));
});

test("contrato diário continua válido, contrato semanal é conferido no ciclo", () => {
  const employee = {
    ...data.employees[0],
    empresa_id: company.id,
    carga_diaria_minutos: 660,
    carga_semanal_minutos: 2310,
    dias_descanso: [],
  };
  const report = evaluate(
    generate(),
    rules,
    company,
    "2026-10",
    model,
    employee,
  );
  assert.ok(
    !report.alerts.some((alert) =>
      ["contrato_diario", "contrato_semanal", "contrato_ciclo_12x36"].includes(
        alert.code,
      ),
    ),
  );
  const short = evaluate(generate(), rules, company, "2026-10", model, {
    ...employee,
    carga_diaria_minutos: 480,
    carga_semanal_minutos: 2100,
  });
  assert.ok(short.alerts.some((alert) => alert.code === "contrato_diario"));
  assert.ok(
    short.alerts.some((alert) => alert.code === "contrato_ciclo_12x36"),
  );
});

test("transição não aplica teto novo retroativamente ao ciclo anterior", () => {
  const full: Model = {
    ...model,
    turno: [{ start: "07:00", end: "19:00" }],
  };
  const old: LegalRule = {
    ...special,
    valor: { ...special.valor, intervalo_tratamento: "indenizado" },
  };
  const next: LegalRule = {
    ...special,
    id: "fase-quarenta",
    inicio_vigencia: "2027-12-16",
    valor: {
      ...special.valor,
      limite_media_semanal_minutos: 2400,
      descansos_semanais: 2,
    },
  };
  const days = generate(full, "2027-12").map((day) =>
    day.data >= next.inicio_vigencia && day.intervalos.length
      ? { ...day, intervalos: structuredClone(model.turno!) }
      : day,
  );
  const report = evaluate(
    days,
    [...baseRules, old, next],
    company,
    "2027-12",
    full,
  );
  assert.ok(
    report.alerts.some((alert) => alert.code === "sem_transicao_12x36"),
  );
  assert.ok(!report.alerts.some((alert) => alert.code === "ciclo_12x36"));
  assert.ok(
    !report.alerts.some((alert) => alert.code === "interjornada_12x36"),
  );
  const unchanged = evaluate(generate(), rules, company, "2026-10", {
    ...model,
    ciclo_inicio: "2026-10-02",
  });
  assert.ok(
    unchanged.alerts.some((alert) => alert.code === "sem_ancora_12x36"),
  );
  assert.ok(
    !unchanged.alerts.some((alert) => alert.code === "alternancia_12x36"),
  );
});

test("mudança de parâmetro dentro da janela gera pendência de transição, sem teto retroativo", () => {
  const next = {
    ...special,
    id: "revisao",
    inicio_vigencia: "2026-10-16",
    valor: { ...special.valor, limite_media_semanal_minutos: 2100 },
  };
  const report = evaluate(
    generate(),
    [...rules, next],
    company,
    "2026-10",
    model,
  );
  assert.ok(
    report.alerts.some((alert) => alert.code === "sem_transicao_12x36"),
  );
  assert.ok(
    !report.alerts.some(
      (alert) => alert.code === "ciclo_12x36" && alert.date < "2026-10-29",
    ),
  );
  assert.ok(
    report.alerts.some(
      (alert) => alert.code === "ciclo_12x36" && alert.date >= "2026-10-29",
    ),
  );
});

test("seleção da tela não altera regime de escala salva e modelo renomeado não muda tipo", () => {
  const saved: Schedule = {
    id: "s",
    empresa_id: company.id,
    funcionario_id: "f",
    modelo_id: model.id,
    modelo_tipo: "12x36",
    mes: "2026-10",
    dias: [],
  };
  const renamed = { ...model, nome: "Novo nome" };
  assert.equal(scheduleRegime(saved, [renamed]), renamed);
  assert.equal(scheduleRegime(saved, [{ ...model, tipo: "5x2" }]), "12x36");
  assert.equal(scheduleRegime(saved, [{ ...model, id: "outro" }]), "12x36");
});

test("validação de parâmetros impede reduzir descanso, ampliar plantão ou omitir limites comuns", () => {
  assert.doesNotThrow(() => validateRegimeValues(default12x36Values));
  assert.throws(() =>
    validateRegimeValues({
      ...default12x36Values,
      descanso_minimo_minutos: 660,
    }),
  );
  assert.throws(() =>
    validateRegimeValues({
      ...default12x36Values,
      plantao_maximo_minutos: 780,
    }),
  );
  assert.throws(() => validateRegimeValues({ tipo_regime: "comum" }));
});
