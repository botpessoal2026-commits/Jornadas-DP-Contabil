import test from "node:test";
import assert from "node:assert/strict";
import { demoData } from "../src/lib/demo";
import { buildTimesheet } from "../src/lib/timesheet";

test("folha usa a escala exibida, incluindo edição, folga alterada e feriado do próprio calendário", () => {
  const data = demoData();
  const schedule = data.schedules[0];
  schedule.dias.find((day) => day.data === "2026-12-01")!.intervalos[1].end =
    "18:10";
  const friday = schedule.dias.find((day) => day.data === "2026-12-04")!;
  friday.intervalos = [];
  friday.folga = true;
  const sunday = schedule.dias.find((day) => day.data === "2026-12-06")!;
  sunday.intervalos = [{ start: "09:00", end: "12:00" }];
  sunday.folga = false;
  const snapshot = structuredClone(schedule);
  const result = buildTimesheet(
    schedule,
    data.companies[0],
    data.employees[0],
    { preview: true },
  );
  assert.equal(result.rows.length, 31);
  assert.equal(result.start, "2026-12-01");
  assert.equal(result.end, "2026-12-31");
  assert.equal(result.preview, true);
  assert.ok(result.rows[0].planned.includes("13:00–18:10"));
  assert.equal(result.rows[3].crossed, true);
  assert.equal(result.rows[3].shaded, true);
  assert.equal(result.rows[5].rest, false);
  assert.equal(result.rows[5].crossed, false);
  const christmas = result.rows[24];
  assert.equal(christmas.holiday, "Natal");
  assert.equal(christmas.shaded, true);
  assert.equal(christmas.crossed, true);
  assert.deepEqual(schedule, snapshot);
});

test("feriado com trabalho mantém o planejamento, destaque e campos abertos", () => {
  const data = demoData();
  const day = data.schedules[0].dias.find(
    (entry) => entry.data === "2026-12-25",
  )!;
  day.intervalos = [{ start: "10:00", end: "14:00" }];
  day.folga = false;
  const args = [
    data.schedules[0],
    data.companies[0],
    data.employees[0],
  ] as const;
  const result = buildTimesheet(...args).rows[24];
  assert.equal(result.workingHoliday, true);
  assert.equal(result.shaded, true);
  assert.equal(result.crossed, false);
  assert.match(result.observation, /trabalho previsto/);
  assert.deepEqual(result.planned, ["10:00–14:00"]);
});

test("continuação noturna e pausas após meia-noite não viram folga nem intervalos sobrepostos", () => {
  const data = demoData();
  data.schedules[0].dias = [
    {
      data: "2026-11-30",
      intervalos: [
        { start: "22:00", end: "02:00", endDay: 1 },
        { start: "03:00", end: "05:00", startDay: 1, endDay: 1 },
      ],
      folga: false,
      feriado: null,
      observacao: "",
    },
    {
      data: "2026-12-01",
      intervalos: [],
      folga: true,
      feriado: null,
      observacao: "",
    },
  ];
  const result = buildTimesheet(
    data.schedules[0],
    data.companies[0],
    data.employees[0],
  );
  assert.equal(result.rows[0].rest, false);
  assert.equal(result.rows[0].crossed, false);
  assert.deepEqual(result.rows[0].planned, [
    "00:00–02:00 (continuação)",
    "03:00–05:00 (continuação)",
  ]);
  assert.equal(result.rows[1].missing, true);
  assert.equal(result.rows[1].rest, false);
  assert.equal(result.rows[1].crossed, false);
  data.schedules[0].dias.pop();
  const incomplete = buildTimesheet(
    data.schedules[0],
    data.companies[0],
    data.employees[0],
  ).rows[0];
  assert.equal(incomplete.missing, true);
  assert.equal(incomplete.crossed, false);
  assert.deepEqual(incomplete.planned, [
    "00:00–02:00 (continuação)",
    "03:00–05:00 (continuação)",
    "Sem registro do dia",
  ]);
  assert.match(incomplete.observation, /Registro do dia ausente/);
});

test("folha inclui a quantidade real de dias da competência e rejeita referência cruzada ou horários inválidos", () => {
  const data = demoData();
  const schedule = structuredClone(data.schedules[0]);
  for (const [month, days] of [
    ["2027-02", 28],
    ["2028-02", 29],
    ["2026-04", 30],
  ] as const) {
    schedule.mes = `${month}-01`;
    schedule.dias = [];
    assert.equal(
      buildTimesheet(schedule, data.companies[0], data.employees[0]).rows
        .length,
      days,
    );
  }
  assert.throws(
    () =>
      buildTimesheet(data.schedules[0], data.companies[1], data.employees[0]),
    /devem corresponder/,
  );
  assert.throws(
    () =>
      buildTimesheet(data.schedules[0], data.companies[0], data.employees[1]),
    /devem corresponder/,
  );
  const bad = structuredClone(data.schedules[0]);
  bad.dias.push(structuredClone(bad.dias[0]));
  assert.throws(
    () => buildTimesheet(bad, data.companies[0], data.employees[0]),
    /duplicadas/,
  );
  bad.dias.pop();
  bad.dias[0].intervalos = [
    { start: "08:00", end: "12:00" },
    { start: "11:00", end: "15:00" },
  ];
  assert.throws(
    () => buildTimesheet(bad, data.companies[0], data.employees[0]),
    /Confira os horários/,
  );
});
