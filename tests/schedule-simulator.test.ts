import test from "node:test";
import assert from "node:assert/strict";
import { minutes, span } from "../src/lib/engine";
import {
  simulateWeeklyPattern,
  type WeeklySimulationInput,
} from "../src/lib/schedule-simulator";
import { shiftEditorText, validateShiftText } from "../src/lib/shift-editor";

const input: WeeklySimulationInput = {
  weeklyMinutes: 2520,
  workdays: [1, 2, 3, 4, 5],
  start: "08:00",
  breakAfterMinutes: 240,
  breakMinutes: 60,
};

test("simulador gera 44h, 42h e 40h exatas em cinco dias sem contar o intervalo", () => {
  for (const [weeklyMinutes, expectedEnd] of [
    [2640, "17:48"],
    [2520, "17:24"],
    [2400, "17:00"],
  ] as const) {
    const result = simulateWeeklyPattern({ ...input, weeklyMinutes });
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.totalMinutes, weeklyMinutes);
    assert.equal(
      Object.values(result.pattern).reduce((sum, day) => sum + minutes(day), 0),
      weeklyMinutes,
    );
    assert.deepEqual(result.pattern["1"], [
      { start: "08:00", end: "12:00", startDay: 0, endDay: 0 },
      { start: "13:00", end: expectedEnd, startDay: 0, endDay: 0 },
    ]);
    assert.deepEqual(result.pattern["0"], []);
    assert.equal(result.restDays, 2);
  }
});

test("minutos residuais são distribuídos deterministicamente seg→dom sem arredondar carga", () => {
  const args = { ...input, weeklyMinutes: 2522, workdays: [5, 3, 1, 4, 2] };
  const original = structuredClone(args);
  const result = simulateWeeklyPattern(args);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.days.map((day) => day.workedMinutes),
    [505, 505, 504, 504, 504],
  );
  assert.equal(result.totalMinutes, 2522);
  assert.deepEqual(
    simulateWeeklyPattern({ ...args, workdays: [1, 2, 3, 4, 5] }),
    result,
  );
  assert.deepEqual(args, original);
});

test("turno noturno com pausa após a meia-noite conserva os offsets e horas de relógio", () => {
  const result = simulateWeeklyPattern({
    ...input,
    start: "22:00",
    breakAfterMinutes: 180,
    weeklyMinutes: 2400,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.pattern["1"], [
    { start: "22:00", end: "01:00", startDay: 0, endDay: 1 },
    { start: "02:00", end: "07:00", startDay: 1, endDay: 1 },
  ]);
  assert.equal(minutes(result.pattern["1"]), 480);
  assert.equal(
    validateShiftText(shiftEditorText(result.pattern["1"])).worked,
    480,
  );
  assert.equal(span(result.pattern["1"][1])[1], 1860);
});

test("plantão terminando exatamente à meia-noite usa dia seguinte", () => {
  const result = simulateWeeklyPattern({
    ...input,
    start: "16:00",
    weeklyMinutes: 2400,
    breakMinutes: 0,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.pattern["1"], [
    { start: "16:00", end: "00:00", startDay: 0, endDay: 1 },
  ]);
});

test("seleção dos sete dias é proposta com aviso de repouso, nunca aprovação jurídica", () => {
  const result = simulateWeeklyPattern({
    ...input,
    workdays: [0, 1, 2, 3, 4, 5, 6],
    weeklyMinutes: 2520,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.restDays, 0);
  assert.match(result.warnings.join(" "), /dois dias/);
  assert.match(result.warnings[0], /conferida.*vigências/);
});

test("carga de um minuto pode ser distribuída em um dia sem pausa", () => {
  const result = simulateWeeklyPattern({
    ...input,
    weeklyMinutes: 1,
    workdays: [1],
    breakMinutes: 0,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.totalMinutes, 1);
});

test("carga insuficiente, dias repetidos e entrada inválida impedem proposta", () => {
  for (const patch of [
    { weeklyMinutes: 4, breakMinutes: 0 },
    { workdays: [] },
    { workdays: [1, 1] },
    { workdays: [7] },
    { weeklyMinutes: 42.1 },
    { weeklyMinutes: Infinity },
    { start: "24:00" },
    { breakMinutes: -1 },
    { breakAfterMinutes: 2.5 },
    { minimumRestMinutes: NaN },
  ])
    assert.equal(
      simulateWeeklyPattern({ ...input, ...patch }).ok,
      false,
      JSON.stringify(patch),
    );
});

test("intervalo que elimina trabalho antes/depois ou envelope acima de 24h gera conflito", () => {
  for (const patch of [
    { breakAfterMinutes: 0 },
    { breakAfterMinutes: 504 },
    { weeklyMinutes: 10080, workdays: [1] },
    { weeklyMinutes: 1440, workdays: [1], breakMinutes: 1 },
  ])
    assert.equal(simulateWeeklyPattern({ ...input, ...patch }).ok, false);
});

test("restrições explícitas de duração, descanso e indisponibilidade são respeitadas", () => {
  const valid = simulateWeeklyPattern({
    ...input,
    maxWorkedMinutesPerDay: 504,
    maxShiftMinutes: 564,
    minimumRestMinutes: 876,
  });
  assert.equal(valid.ok, true);
  for (const patch of [
    { maxWorkedMinutesPerDay: 503 },
    { maxShiftMinutes: 563 },
    { minimumRestMinutes: 877 },
    { unavailableDays: [2] },
  ])
    assert.equal(simulateWeeklyPattern({ ...input, ...patch }).ok, false);
});

test("descanso mínimo também considera a passagem domingo→segunda da repetição", () => {
  const result = simulateWeeklyPattern({
    ...input,
    workdays: [0, 1],
    weeklyMinutes: 960,
    minimumRestMinutes: 1000,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(" "), /domingo.*repetição/);
});

test("turno noturno não pode invadir indisponibilidade no dia seguinte", () => {
  const result = simulateWeeklyPattern({
    ...input,
    start: "22:00",
    workdays: [5],
    weeklyMinutes: 480,
    unavailableDays: [6],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(" "), /dia seguinte/);
});

test("comparação distingue carga, dias trabalhados e folgas sem mudar modelo anterior", () => {
  const prior = {
    "1": [{ start: "08:00", end: "12:00" }],
    "2": [{ start: "08:00", end: "12:00" }],
  };
  const saved = structuredClone(prior);
  const result = simulateWeeklyPattern(input, prior);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.comparison, {
    before: { minutes: 480, workdays: 2, restDays: 5 },
    after: { minutes: 2520, workdays: 5, restDays: 2 },
    minutesDifference: 2040,
  });
  assert.deepEqual(prior, saved);
});

test("modelo anterior inválido não contamina proposta nem apresenta comparação falsa", () => {
  const result = simulateWeeklyPattern(input, {
    "1": [{ start: "25:00", end: "12:00" }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.comparison, null);
  assert.match(result.warnings.join(" "), /anterior.*inválidos/);
});
