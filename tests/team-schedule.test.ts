import test from "node:test";
import assert from "node:assert/strict";
import { demoData } from "../src/lib/demo";
import { teamScheduleRows } from "../src/lib/team-schedule";

test("grade consolida somente vínculos conhecidos e respeita empresa e mês", () => {
  const data = demoData();
  const all = teamScheduleRows(data, "2026-12", null);
  assert.equal(all.length, 2);
  assert.equal(all[0].employee.nome, "Mariana Costa");
  assert.equal(all[1].employee.nome, "Rafael Lima");
  assert.equal(teamScheduleRows(data, "2026-12", "unknown").length, 0);
  const own = teamScheduleRows(data, "2026-12", data.companies[1].id);
  assert.equal(own.length, 1);
  assert.equal(own[0].company.id, data.companies[1].id);
  assert.equal(own[0].employee.id, data.employees[1].id);
  assert.equal(own[0].days[0].hours, "6h00");
  assert.ok(
    teamScheduleRows(data, "2027-01", null).every((row) => !row.schedule),
  );
  data.employees.push({
    ...data.employees[0],
    id: "orphan",
    empresa_id: "foreign",
  });
  data.schedules.unshift({
    ...data.schedules[1],
    funcionario_id: data.employees[0].id,
  });
  assert.equal(teamScheduleRows(data, "2026-12", null).length, 2);
  assert.equal(
    teamScheduleRows(data, "2026-12", data.companies[0].id)[0].schedule?.id,
    "demo-schedule",
  );
});

test("grade distingue ausência de escala e descanso registrado sem modificar dados", () => {
  const data = demoData();
  data.companies[0].situacao = "arquivada";
  data.schedules[0].dias = data.schedules[0].dias.filter(
    (day) => day.data !== "2026-12-02",
  );
  data.schedules = [data.schedules[0]];
  const snapshot = structuredClone(data);
  const rows = teamScheduleRows(data, "2026-12", null);
  assert.equal(
    rows[0].days.find((day) => day.date === "2026-12-02")?.state,
    "missing",
  );
  assert.equal(
    rows[0].days.find((day) => day.date === "2026-12-06")?.state,
    "rest",
  );
  assert.equal(rows[0].days[0].state, "work");
  assert.ok(rows[1].days.every((day) => day.state === "missing"));
  assert.deepEqual(data, snapshot);
});

test("grade reutiliza alertas e prioriza impedimento sem contaminar outra empresa", () => {
  const data = demoData();
  const day = data.schedules[0].dias.find(
    (entry) => entry.data === "2026-12-01",
  )!;
  day.intervalos[1].end = "23:00";
  const rows = teamScheduleRows(data, "2026-12", null);
  assert.equal(rows[0].days[0].problem, "violation");
  assert.notEqual(rows[1].days[0].problem, "violation");
  day.intervalos[0].start = "abc";
  const invalid = teamScheduleRows(data, "2026-12", data.companies[0].id)[0];
  assert.equal(invalid.reviewIncomplete, true);
  assert.equal(invalid.days[0].state, "invalid");
  assert.equal(invalid.days[0].problem, "attention");
});

test("grade reconhece continuação noturna salva mesmo sem entrada na data seguinte", () => {
  const data = demoData();
  data.rules = [];
  data.schedules[0].dias = [
    {
      data: "2026-12-01",
      intervalos: [{ start: "22:00", end: "06:00", endDay: 1 }],
      folga: false,
      feriado: null,
      observacao: "",
    },
    {
      data: "2026-12-02",
      intervalos: [],
      folga: true,
      feriado: null,
      observacao: "",
    },
  ];
  const row = teamScheduleRows(data, "2026-12", data.companies[0].id)[0];
  assert.equal(row.days[0].state, "work");
  assert.equal(row.days[1].state, "work");
  assert.equal(row.days[1].hours, "6h00");
  assert.equal(row.days[1].shifts.length, 0);
});
