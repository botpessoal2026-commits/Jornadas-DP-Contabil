import test from "node:test";
import assert from "node:assert/strict";
import { demoData } from "../src/lib/demo";
import { filterTeamRows, teamScheduleRows } from "../src/lib/team-schedule";
import {
  applyBulkDayChanges,
  reviewBulkSchedules,
} from "../src/lib/schedule-bulk";

test("filtros da equipe combinam busca sem acentos, setor e estabelecimento sem mudar contexto", () => {
  const data = demoData();
  data.employees[0].nome = "Márcia Costa";
  data.employees[0].setor = "Operações";
  data.employees[0].estabelecimento_id = "unit-a";
  data.employees[0].matricula = "DP-018";
  const rows = teamScheduleRows(data, "2026-12", null);
  assert.deepEqual(
    filterTeamRows(rows, {
      query: "marcia",
      sector: "Operações",
      establishmentId: "unit-a",
    }).map((row) => row.employee.id),
    [data.employees[0].id],
  );
  assert.equal(filterTeamRows(rows, { query: "dp-018" }).length, 1);
  assert.equal(
    filterTeamRows(rows, { query: "marcia", establishmentId: "__main" }).length,
    0,
  );
  assert.equal(filterTeamRows(rows, { establishmentId: "__main" }).length, 1);
  assert.equal(filterTeamRows(rows, { query: "outra empresa" }).length, 0);
  assert.equal(rows.length, 2);
});

test("filtros distinguem sem escala, descanso salvo, impedimento e vínculo inativo", () => {
  const data = demoData();
  data.employees[1].situacao = "inativo";
  data.schedules[0].dias.find((day) => day.data === "2026-12-01")!.intervalos =
    [{ start: "06:00", end: "23:00" }];
  const rows = teamScheduleRows(data, "2026-12", null);
  assert.equal(filterTeamRows(rows, { schedule: "missing" }).length, 0);
  assert.equal(
    filterTeamRows(rows, { schedule: "violation", status: "active" })[0]
      .employee.id,
    data.employees[0].id,
  );
  assert.equal(
    filterTeamRows(rows, { status: "inactive" })[0].employee.id,
    data.employees[1].id,
  );
  const next = teamScheduleRows(data, "2027-01", null);
  assert.equal(filterTeamRows(next, { schedule: "missing" }).length, 2);
  assert.equal(filterTeamRows(next, { schedule: "violation" }).length, 0);
});

test("filtro de regime respeita o tipo salvo mesmo depois de mudar o modelo cadastrado", () => {
  const data = demoData();
  data.schedules[0].modelo_tipo = "12x36";
  const model = data.models.find(
    (entry) => entry.id === data.schedules[0].modelo_id,
  )!;
  model.tipo = "5x2";
  const rows = teamScheduleRows(data, "2026-12", null);
  assert.equal(
    filterTeamRows(rows, { regime: "12x36" }, data.models)[0].employee.id,
    data.employees[0].id,
  );
  assert.equal(filterTeamRows(rows, { regime: "5x2" }, data.models).length, 1);
});

test("edição de vários dias mantém base, feriado e exceção explícita sem mutar horários originais", () => {
  const data = demoData();
  const original = data.schedules[0];
  const holiday = original.dias.find((day) => day.data === "2026-12-25")!;
  const snapshot = structuredClone(original);
  const shifts = [{ start: "08:00", end: "12:00" }];
  const changed = applyBulkDayChanges(
    original,
    ["2026-12-24", "2026-12-25"],
    shifts,
  );
  const changedHoliday = changed.dias.find((day) => day.data === "2026-12-25")!;
  assert.equal(changedHoliday.feriado, holiday.feriado);
  assert.equal(changedHoliday.calendario?.excecao?.categoria, "trabalho");
  assert.deepEqual(
    changedHoliday.calendario?.base.intervalos,
    holiday.intervalos,
  );
  assert.equal(changedHoliday.folga, false);
  assert.deepEqual(original, snapshot);
  shifts[0].end = "13:00";
  assert.equal(changedHoliday.intervalos[0].end, "12:00");
  const restored = applyBulkDayChanges(changed, ["2026-12-25"], null);
  assert.equal(
    restored.dias.find((day) => day.data === "2026-12-25")?.calendario?.base
      .feriado,
    holiday.feriado,
  );
  assert.equal(
    restored.dias.find((day) => day.data === "2026-12-25")?.calendario?.excecao
      ?.categoria,
    "folga",
  );
});

test("edição em lote rejeita dias de outra competência e não admite horas inválidas", () => {
  const schedule = demoData().schedules[0];
  assert.throws(() => applyBulkDayChanges(schedule, [], null), /Selecione/);
  assert.throws(
    () => applyBulkDayChanges(schedule, ["2027-01-01"], null),
    /fora/,
  );
  assert.throws(
    () => applyBulkDayChanges(schedule, ["2026-12-01"], []),
    /períodos/,
  );
  assert.throws(
    () =>
      applyBulkDayChanges(
        schedule,
        ["2026-12-01"],
        [{ start: "abc", end: "12:00" }],
      ),
    /inválido/,
  );
});

test("revisão de lote mantém excessos e confere separadamente cada empresa e funcionário", () => {
  const data = demoData();
  const first = applyBulkDayChanges(
    data.schedules[0],
    ["2026-12-01"],
    [{ start: "06:00", end: "23:00" }],
  );
  const result = reviewBulkSchedules(data, [first, data.schedules[1]]);
  assert.ok(result[0].violations > 0);
  assert.equal(result[1].violations, 0);
  assert.ok(result[0].clockTotal > result[1].clockTotal);
  assert.equal(result[1].employeeName, data.employees[1].nome);
  assert.equal(result[0].error, undefined);
  assert.throws(() => reviewBulkSchedules(data, [first, first]), /repetida/);
});

test("revisão de lote bloqueia vínculo cruzado e empresa inativa sem inventar ausência de alerta", () => {
  const data = demoData();
  const mismatch = { ...data.schedules[0], empresa_id: data.companies[1].id };
  assert.match(reviewBulkSchedules(data, [mismatch])[0].error!, /Vínculo/);
  data.companies[0].situacao = "arquivada";
  assert.match(
    reviewBulkSchedules(data, [data.schedules[0]])[0].error!,
    /inativo/,
  );
});

test("edição em lote preserva uma continuação noturna e revalida descanso após a mudança", () => {
  const data = demoData();
  const modified = applyBulkDayChanges(
    data.schedules[0],
    ["2026-12-01"],
    [{ start: "22:00", end: "06:00", endDay: 1 }],
  );
  const result = reviewBulkSchedules(data, [modified])[0];
  assert.equal(result.error, undefined);
  assert.ok(
    result.violations > 0,
    "o próximo início às 08h não pode esconder o descanso insuficiente após o plantão",
  );
  assert.equal(
    result.schedule.dias.find((day) => day.data === "2026-12-01")?.intervalos[0]
      .endDay,
    1,
  );
});
