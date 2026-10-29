import assert from "node:assert/strict";
import { test } from "node:test";
import { demoData } from "../src/lib/demo";
import {
  computeDay,
  duplicateDays,
  evaluate,
  generateDays,
} from "../src/lib/engine";
import { initialRules } from "../src/lib/presets";
import type { Day, LegalRule, Model } from "../src/lib/types";

const data = demoData();
const company = { ...data.companies[0], limite_diario_minutos: 480 };
const rules: LegalRule[] = initialRules.map((rule, index) => ({
  ...rule,
  id: `reference-${index}`,
  confirmado: true,
}));
const pattern = (end = "17:00"): Model => ({
  id: "common-reference",
  empresa_id: company.id,
  nome: "Administrativo",
  tipo: "5x2",
  padrao: Object.fromEntries(
    [1, 2, 3, 4, 5].map((day) => [
      day,
      [
        { start: "08:00", end: "12:00" },
        { start: "13:00", end },
      ],
    ]),
  ),
});
const generate = (model: Model, month = "2026-10") =>
  generateDays(month, model, company, [], false);
const documented = (entries = rules, type = "cct", period = "ano") =>
  entries.map((rule) =>
    rule.chave !== "regime" || rule.valor.tipo_regime === "12x36"
      ? rule
      : {
          ...rule,
          valor: {
            ...rule.valor,
            fundamento_tipo: type,
            fundamento_referencia:
              "Instrumento RH-527, cláusula de compensação",
            periodo_compensacao: period,
            comprovado: true,
          },
        },
  );

const transitionRules: LegalRule[] = [
  ...rules.filter((rule) => rule.chave !== "regime"),
  ...[
    ["1988-10-05", 2640, 1],
    ["2026-12-16", 2520, 2],
    ["2027-12-16", 2400, 2],
  ].map(([date, weekly, rests], index) => ({
    id: `common-phase-${index}`,
    chave: "regime",
    nome: `Referência da vigência ${date}`,
    inicio_vigencia: String(date),
    valor: {
      limite_semanal_minutos: Number(weekly),
      limite_diario_minutos: 480,
      descansos_semanais: Number(rests),
      permite_limite_empresa: true,
    },
    fonte: "CF art. 7, EC 141/2026 e instrumento RH-527",
    confirmado: true,
    observacao: "Conferido para esta validação matemática",
  })),
];

test("limites legais e contratuais usam relógio, sem somar redução noturna", () => {
  const model: Model = {
    ...pattern(),
    padrao: Object.fromEntries(
      [1, 2, 3, 4, 5].map((day) => [
        day,
        [
          { start: "20:00", end: "00:00", endDay: 1 },
          { start: "01:00", end: "05:00", startDay: 1, endDay: 1 },
        ],
      ]),
    ),
  };
  const employee = {
    ...data.employees[0],
    carga_diaria_minutos: 480,
    carga_semanal_minutos: 2400,
    dias_descanso: [],
  };
  const result = evaluate(
    generate(model),
    rules,
    company,
    "2026-10",
    model,
    employee,
  );
  assert.ok(result.total > result.clockTotal);
  assert.equal(
    result.weeks.find((week) => week.start === "2026-10-05")?.total,
    2400,
  );
  assert.ok(result.weeks.some((week) => week.computedTotal > week.total));
  assert.ok(
    !result.alerts.some((alert) =>
      ["diario", "semanal", "contrato_diario", "contrato_semanal"].includes(
        alert.code,
      ),
    ),
  );
});

test("repousos de uma escala 5x2 noturna continuam sendo unidades completas de 24h", () => {
  const model: Model = {
    ...pattern(),
    padrao: Object.fromEntries(
      [1, 2, 3, 4, 5].map((day) => [
        day,
        [{ start: "22:00", end: "05:00", endDay: 1 }],
      ]),
    ),
  };
  const result = evaluate(
    generate(model, "2027-01"),
    transitionRules,
    company,
    "2027-01",
    model,
  );
  assert.ok(result.weeks.every((week) => week.rests >= 2));
  assert.ok(!result.alerts.some((alert) => alert.code === "descanso"));
});

test("permissão 6x1 não dispensa o segundo repouso da vigência constitucional", () => {
  const model = { ...pattern("16:00"), tipo: "6x1" as const };
  model.padrao["6"] = structuredClone(model.padrao["1"]);
  const result = evaluate(
    generate(model, "2027-01"),
    transitionRules,
    { ...company, permite_6x1: true },
    "2027-01",
    model,
  );
  assert.ok(result.alerts.some((alert) => alert.code === "descanso"));
  assert.ok(!result.alerts.some((alert) => alert.code === "6x1"));
});

test("regras antigas não ampliam automaticamente o teto constitucional novo", () => {
  const old = rules.filter(
    (rule) => rule.chave !== "regime" || rule.inicio_vigencia === "1988-10-05",
  );
  const model = pattern("17:24");
  const result = evaluate(
    generate(model, "2028-01"),
    old,
    { ...company, limite_diario_minutos: 504 },
    "2028-01",
    model,
  );
  assert.ok(
    result.alerts.some((alert) => alert.code === "sem_adequacao_regime"),
  );
  assert.ok(result.alerts.some((alert) => alert.code === "semanal"));
});

test("8h24 não é falso excesso, mas exige comprovação da compensação", () => {
  const model = pattern("17:24");
  const result = evaluate(
    generate(model),
    rules,
    { ...company, limite_diario_minutos: 504 },
    "2026-10",
    model,
  );
  assert.ok(!result.alerts.some((alert) => alert.code === "diario"));
  assert.ok(
    result.alerts.some((alert) => alert.code === "sem_compensacao_diaria"),
  );
  const valid = evaluate(
    generate(model),
    documented(),
    { ...company, limite_diario_minutos: 504 },
    "2026-10",
    model,
  );
  assert.ok(
    !valid.alerts.some((alert) => alert.code === "sem_compensacao_diaria"),
  );
});

test("ampliar o parâmetro da regra também exige fundamento, não só o da empresa", () => {
  const model = pattern("17:24");
  const changed = rules.map((rule) =>
    rule.chave === "regime" && rule.valor.tipo_regime !== "12x36"
      ? { ...rule, valor: { ...rule.valor, limite_diario_minutos: 504 } }
      : rule,
  );
  const result = evaluate(
    generate(model),
    changed,
    { ...company, limite_diario_minutos: null },
    "2026-10",
    model,
  );
  assert.ok(
    result.alerts.some((alert) => alert.code === "sem_compensacao_diaria"),
  );
});

test("acordo individual/tácito mensal não substitui coletivo na transição das 42h", () => {
  const model = pattern("17:24");
  const enlarged = { ...company, limite_diario_minutos: 504 };
  for (const kind of ["acordo_individual", "acordo_tacito_mensal"]) {
    const historical = evaluate(
      generate(model),
      documented(rules, kind, "mes"),
      enlarged,
      "2026-10",
      model,
    );
    assert.ok(
      !historical.alerts.some(
        (alert) => alert.code === "sem_compensacao_diaria",
      ),
    );
    const transitional = evaluate(
      generate(model, "2027-01"),
      documented(transitionRules, kind, "mes"),
      enlarged,
      "2027-01",
      model,
    );
    assert.ok(
      transitional.alerts.some(
        (alert) => alert.code === "sem_compensacao_diaria",
      ),
    );
  }
  const collective = evaluate(
    generate(model, "2027-01"),
    documented(transitionRules),
    enlarged,
    "2027-01",
    model,
  );
  assert.ok(
    !collective.alerts.some((alert) => alert.code === "sem_compensacao_diaria"),
  );
});

test("semana da mudança de vigência não aplica teto novo retroativamente", () => {
  const model = pattern("17:48");
  const result = evaluate(
    generate(model, "2026-12"),
    documented(transitionRules),
    { ...company, limite_diario_minutos: 528 },
    "2026-12",
    model,
  );
  const reference = result.weeks.find((week) => week.start === "2026-12-14")!;
  assert.equal(reference.total, 2640);
  assert.equal(reference.limit, 2640);
  assert.ok(
    result.alerts.some(
      (alert) =>
        alert.code === "transicao" && alert.period?.start === reference.start,
    ),
  );
  assert.ok(
    !result.alerts.some(
      (alert) =>
        alert.code === "semanal" && alert.period?.start === reference.start,
    ),
  );
  const excessive = pattern("18:00");
  assert.ok(
    evaluate(
      generate(excessive, "2026-12"),
      documented(transitionRules),
      { ...company, limite_diario_minutos: 540 },
      "2026-12",
      excessive,
    ).alerts.some(
      (alert) =>
        alert.code === "semanal" && alert.period?.start === reference.start,
    ),
  );
});

test("sete dias consecutivos são detectados na virada da semana e do mês", () => {
  const model: Model = { ...pattern(), padrao: {} };
  const days = generate(model, "2026-12");
  for (const day of days) {
    if (day.data >= "2026-11-25" && day.data <= "2026-12-01") {
      day.intervalos = [{ start: "08:00", end: "12:00" }];
      day.folga = false;
    }
  }
  const result = evaluate(days, transitionRules, company, "2026-12", model);
  assert.ok(
    result.alerts.some(
      (alert) =>
        alert.code === "descanso_consecutivo" && alert.date === "2026-12-01",
    ),
  );
});

test("dias vizinhos ausentes geram pendência em vez de presumir folgas", () => {
  const model = pattern();
  const days = generateDays("2026-12", model, company, [], false, false);
  const result = evaluate(days, transitionRules, company, "2026-12", model);
  assert.ok(
    result.alerts.some((alert) => alert.code === "sem_contexto_descanso"),
  );
});

test("duplicação usa a ocorrência do mês de origem e ignora contexto adjacente", () => {
  const model = pattern();
  const source = generate(model, "2026-12");
  const firstTuesday = source.find((day) => day.data === "2026-12-01")!;
  firstTuesday.intervalos = [{ start: "09:00", end: "12:00" }];
  const target = duplicateDays(source, "2027-01", model, company, [], false);
  assert.deepEqual(
    target.find((day) => day.data === "2027-01-05")?.intervalos,
    firstTuesday.intervalos,
  );
  const sourceWithMoreContext: Day[] = [
    ...generate(model, "2026-11"),
    ...source.filter((day) => day.data.startsWith("2026-12")),
  ];
  const explicit = duplicateDays(
    sourceWithMoreContext,
    "2027-01",
    model,
    company,
    [],
    false,
    "2026-12",
  );
  assert.deepEqual(
    explicit.find((day) => day.data === "2027-01-05")?.intervalos,
    firstTuesday.intervalos,
  );
});

test("referência noturna preserva os minutos reduzidos separados dos efetivos", () => {
  const day: Day = {
    data: "2026-10-01",
    intervalos: [{ start: "22:00", end: "05:00", endDay: 1 }],
    folga: false,
    feriado: null,
    observacao: "",
  };
  const result = computeDay(day, rules);
  assert.equal(result.worked, 420);
  assert.equal(result.reducedNight, 480);
});

test("CCT comprovada não amplia jornada comum para 12h por parâmetro numérico", () => {
  const model = pattern("20:00");
  const result = evaluate(
    generate(model),
    documented(),
    { ...company, limite_diario_minutos: 720 },
    "2026-10",
    model,
  );
  assert.ok(
    result.alerts.some((alert) => alert.code === "sem_enquadramento_comum"),
  );
  assert.ok(
    result.alerts.some(
      (alert) => alert.code === "diario" && alert.message.includes("10h00"),
    ),
  );
  assert.equal(result.cycles.length, 0);
});

test("compensação coletiva exige período expresso, não somente CCT marcada", () => {
  const model = pattern("17:24");
  for (const period of ["", "indefinido", "dois_anos"]) {
    const result = evaluate(
      generate(model),
      documented(rules, "cct", period),
      { ...company, limite_diario_minutos: 504 },
      "2026-10",
      model,
    );
    assert.ok(
      result.alerts.some((alert) => alert.code === "sem_compensacao_diaria"),
    );
  }
  for (const period of ["mes", "seis_meses", "ano"]) {
    const result = evaluate(
      generate(model),
      documented(rules, "cct", period),
      { ...company, limite_diario_minutos: 504 },
      "2026-10",
      model,
    );
    assert.ok(
      !result.alerts.some((alert) => alert.code === "sem_compensacao_diaria"),
    );
  }
});
