import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeRule,
  computeDay,
  evaluate,
  generateDays,
  minutes,
  span,
  dominioText,
  duplicateDays,
} from "../src/lib/engine";
import { demoData } from "../src/lib/demo";
const data = demoData(),
  company = data.companies[0],
  model = data.models[0],
  rules = data.rules;
test("08–12 e 13–17:24 equivale a 42h semanais e divisor 210", () => {
  const days = generateDays("2026-12", model, company, []);
  const report = evaluate(days, rules, company, "2026-12");
  assert.equal(report.weeks.find((w) => w.start === "2026-12-21")?.total, 2520);
  assert.equal(report.periods[1].divisor, 210);
  assert.equal(minutes(model.padrao["1"]), 504);
});
test("dezembro apresenta dois regimes conforme corte, inclusive dentro da mesma semana", () => {
  const result = evaluate(
    generateDays("2026-12", model, company, []),
    rules,
    company,
    "2026-12",
  );
  assert.deepEqual(
    result.periods.map((p) => [p.start, p.end, p.divisor]),
    [
      ["2026-12-01", "2026-12-14", 220],
      ["2026-12-15", "2026-12-31", 210],
    ],
  );
  assert.ok(result.alerts.some((a) => a.code === "transicao"));
});
test("editar vigência para dia 16 altera cálculo sem alterar motor", () => {
  const changed = rules.map((r) =>
    r.chave === "regime" && r.inicio_vigencia === "2026-12-15"
      ? { ...r, inicio_vigencia: "2026-12-16" }
      : r,
  );
  assert.equal(
    activeRule(changed, "regime", "2026-12-15")?.valor.limite_semanal_minutos,
    2640,
  );
  assert.equal(
    activeRule(changed, "regime", "2026-12-16")?.valor.limite_semanal_minutos,
    2520,
  );
});
test("escala 6x1 alerta em empresa sem permissão e cita fonte", () => {
  const m = data.models[2];
  const r = evaluate(
    generateDays("2026-12", m, company, []),
    rules,
    company,
    "2026-12",
    m.tipo,
  );
  assert.ok(r.alerts.some((a) => a.code === "6x1" && a.rule && a.source));
  const allowed = evaluate(
    generateDays("2026-12", m, company, []),
    rules,
    { ...company, permite_6x1: true },
    "2026-12",
    m.tipo,
  );
  assert.ok(!allowed.alerts.some((a) => a.code === "6x1"));
});
test("limites diários e semanais não ficam fixos no código", () => {
  const changed = rules.map((r) =>
    r.chave === "regime"
      ? {
          ...r,
          valor: {
            ...r.valor,
            limite_diario_minutos: 420,
            limite_semanal_minutos: 2100,
          },
        }
      : r,
  );
  const r = evaluate(
    generateDays("2026-12", model, company, []),
    changed,
    { ...company, limite_diario_minutos: null },
    "2026-12",
  );
  assert.ok(r.alerts.some((a) => a.code === "diario"));
  assert.ok(r.alerts.some((a) => a.code === "semanal"));
});
test("intervalo intrajornada exige maior pausa contínua, não soma duas pequenas", () => {
  const days = generateDays("2026-12", model, company, []);
  const d = days.find((d) => d.data === "2026-12-01")!;
  d.intervalos = [
    { start: "08:00", end: "12:00" },
    { start: "12:30", end: "15:00" },
    { start: "15:30", end: "17:00" },
  ];
  assert.ok(
    evaluate(days, rules, company, "2026-12").alerts.some(
      (a) => a.code === "intrajornada" && a.date === d.data,
    ),
  );
});
test("jornada de 4h exatas sem intervalo não alerta, 5h exige 15 minutos", () => {
  const days = generateDays("2026-12", model, company, []);
  const d = days.find((d) => d.data === "2026-12-01")!;
  d.intervalos = [{ start: "08:00", end: "12:00" }];
  assert.ok(
    !evaluate(days, rules, company, "2026-12").alerts.some(
      (a) => a.code === "intrajornada" && a.date === d.data,
    ),
  );
  d.intervalos = [{ start: "08:00", end: "13:00" }];
  assert.ok(
    evaluate(days, rules, company, "2026-12").alerts.some(
      (a) => a.code === "intrajornada" && a.date === d.data,
    ),
  );
});
test("interjornada detecta turno noturno seguido de início prematuro", () => {
  const days = generateDays("2026-12", model, company, []);
  days.find((d) => d.data === "2026-12-01")!.intervalos = [
    { start: "22:00", end: "05:00", endDay: 1 },
  ];
  days.find((d) => d.data === "2026-12-02")!.intervalos = [
    { start: "10:00", end: "14:00" },
  ];
  assert.ok(
    evaluate(days, rules, company, "2026-12").alerts.some(
      (a) => a.code === "interjornada" && a.date === "2026-12-02",
    ),
  );
});
test("hora noturna: 7h de relógio correspondem a 8h reduzidas", () => {
  const d = {
    data: "2026-12-01",
    intervalos: [{ start: "22:00", end: "05:00", endDay: 1 }],
    folga: false,
    feriado: null,
    observacao: "",
  };
  const r = computeDay(d, rules);
  assert.equal(r.worked, 420);
  assert.equal(r.night, 420);
  assert.equal(r.reducedNight, 480);
  assert.equal(r.premiumPercent, 20);
});
test("feriado municipal considera cidade e UF sem afetar outras cidades", () => {
  const hs = [
    {
      id: "h",
      nome: "Local",
      data: "2026-12-01",
      abrangencia: "municipal" as const,
      cidade: "Recife",
      uf: "PE",
    },
  ];
  assert.equal(
    generateDays("2026-12", model, company, hs).find(
      (d) => d.data === "2026-12-01",
    )?.folga,
    true,
  );
  assert.equal(
    generateDays("2026-12", model, { ...company, cidade: "Olinda" }, hs).find(
      (d) => d.data === "2026-12-01",
    )?.folga,
    false,
  );
});
test("12x36 preserva âncora entre meses", () => {
  const m = {
    ...model,
    tipo: "12x36" as const,
    ciclo_inicio: "2026-12-31",
    turno: [
      { start: "07:00", end: "12:00" },
      { start: "13:00", end: "19:00" },
    ],
  };
  assert.equal(
    generateDays("2027-01", m, company, []).find((d) => d.data === "2027-01-01")
      ?.folga,
    true,
  );
  assert.equal(
    generateDays("2027-01", m, company, []).find((d) => d.data === "2027-01-02")
      ?.folga,
    false,
  );
});
test("dados sem regras nunca aparentam conformidade", () => {
  const result = evaluate(
    generateDays("2026-12", model, company, []),
    [],
    company,
    "2026-12",
  );
  assert.ok(result.alerts.some((a) => a.code === "sem_regime"));
  assert.equal(result.periods[0].divisor, undefined);
});
test("semanas de mês parcial incluem dias vizinhos na validação", () => {
  const full = generateDays("2026-12", model, company, []);
  assert.ok(full.some((d) => d.data === "2026-11-30"));
  assert.ok(full.some((d) => d.data === "2027-01-03"));
  assert.equal(evaluate(full, rules, company, "2026-12").weeks[0].total, 2520);
});
test("horários inválidos e dias sobrepostos não passam silenciosamente", () => {
  assert.throws(() => span({ start: "25:00", end: "12:00" }));
  const days = generateDays("2026-12", model, company, []);
  days.find((d) => d.data === "2026-12-01")!.intervalos = [
    { start: "08:00", end: "12:00" },
    { start: "11:00", end: "17:00" },
  ];
  assert.ok(
    evaluate(days, rules, company, "2026-12").alerts.some(
      (a) => a.code === "sobreposicao",
    ),
  );
});
test("texto Domínio contém horários e descansos", () => {
  const text = dominioText(model);
  assert.ok(text.includes("08:00 às 12:00 e 13:00 às 17:24"));
  assert.ok(text.includes("descanso: sáb e dom"));
});
test("teto diário absoluto da fase 40h não é ampliado pelo cadastro da empresa", () => {
  const r = evaluate(
    generateDays("2027-12", model, company, []),
    rules,
    { ...company, limite_diario_minutos: 600 },
    "2027-12",
  );
  assert.ok(r.alerts.some((a) => a.code === "diario"));
});
test("turno noturno atravessando corte aplica regra de cada data civil", () => {
  const days = [
    {
      data: "2026-12-14",
      intervalos: [{ start: "22:00", end: "05:00", endDay: 1 }],
      folga: false,
      feriado: null,
      observacao: "",
    },
    {
      data: "2026-12-15",
      intervalos: [],
      folga: true,
      feriado: null,
      observacao: "",
    },
  ];
  const changed = rules.map((r) =>
    r.chave === "noturno" ? { ...r, inicio_vigencia: "2026-12-15" } : r,
  );
  assert.equal(computeDay(days[0], changed, days).computed, 120);
  assert.ok(
    Math.abs(computeDay(days[1], changed, days).computed - (300 * 8) / 7) <
      0.001,
  );
});
test("turnos com pausa após meia-noite preservam a pausa e as horas por data", () => {
  const shiftDay = {
    data: "2026-12-01",
    intervalos: [
      { start: "22:00", end: "02:00", endDay: 1 },
      { start: "03:00", end: "05:00", startDay: 1, endDay: 1 },
    ],
    folga: false,
    feriado: null,
    observacao: "",
  };
  const next = {
    data: "2026-12-02",
    intervalos: [],
    folga: true,
    feriado: null,
    observacao: "",
  };
  const ds = [shiftDay, next];
  assert.equal(minutes(shiftDay.intervalos), 360);
  assert.equal(computeDay(shiftDay, rules, ds).worked, 120);
  assert.equal(computeDay(next, rules, ds).worked, 240);
});
test("jornada de 12h atravessando meia-noite não escapa ao teto diário", () => {
  const days = generateDays("2026-12", model, company, []);
  days.find((d) => d.data === "2026-12-01")!.intervalos = [
    { start: "20:00", end: "08:00", endDay: 1 },
  ];
  assert.ok(
    evaluate(
      days,
      rules,
      { ...company, limite_diario_minutos: 480 },
      "2026-12",
    ).alerts.some((a) => a.code === "diario" && a.date === "2026-12-01"),
  );
});

test("duplicação preserva edição da primeira terça e recalcula feriados", () => {
  const original = generateDays("2026-12", model, company, [], true, false);
  original[0].intervalos = [{ start: "09:00", end: "12:00" }];
  original.find((d) => d.data === "2026-12-25")!.intervalos = [];
  original.find((d) => d.data === "2026-12-25")!.feriado = "Natal";
  const copied = duplicateDays(original, "2027-01", model, company, []);
  assert.deepEqual(copied.find((d) => d.data === "2027-01-05")!.intervalos, [
    { start: "09:00", end: "12:00" },
  ]);
  assert.ok(copied.find((d) => d.data === "2027-01-22")!.intervalos.length > 0);
});
