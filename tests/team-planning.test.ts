import test from "node:test";
import assert from "node:assert/strict";
import {
  teamPlanningSelection,
  automaticTeamRotation,
  teamGenerationPayload,
  applyTeamGenerationLocally,
} from "../src/lib/team-planning";
import { applyBulkDayChanges } from "../src/lib/schedule-bulk";
import { companyCoverage } from "../src/lib/company-coverage";
import { rotationData } from "../src/lib/rest-rotation";
import {
  teamFixture,
  teamIds as ids,
  selectedTeam,
  normalTeamSchedule,
} from "./fixtures/team-data";

test("seleção da equipe exige pessoas ativas, modelos, empresa e competência corretos", () => {
  const data = teamFixture();
  assert.equal(
    teamPlanningSelection(data, ids.company, selectedTeam, "2027-01").length,
    3,
  );
  for (const idsToTry of [
    [],
    [ids.employee, ids.employee],
    [ids.foreign],
    [ids.inactive],
  ])
    assert.throws(() =>
      teamPlanningSelection(data, ids.company, idsToTry, "2027-01"),
    );
  assert.throws(
    () => teamPlanningSelection(data, ids.company, selectedTeam, "2027-13"),
    /competência/,
  );
  data.models = [];
  assert.throws(
    () => teamPlanningSelection(data, ids.company, selectedTeam, "2027-01"),
    /modelo/,
  );
});
test("distribuição automática alterna apenas o 12×36 e mantém o modelo dos demais regimes", () => {
  const data = teamFixture(),
    before = JSON.stringify(data);
  const plan = automaticTeamRotation(
    data,
    ids.company,
    "2027-01",
    [...selectedTeam].reverse(),
    "2027-01-01",
  );
  assert.equal(plan.assignments.length, 2);
  assert.deepEqual(
    plan.assignments.map((item) => item.group),
    ["A", "B"],
  );
  assert.ok(!plan.assignments.some((item) => item.employeeId === ids.normal));
  assert.equal(JSON.stringify(data), before);
  assert.throws(
    () =>
      automaticTeamRotation(
        data,
        ids.company,
        "2027-01",
        [ids.employee, ids.normal],
        "2027-01-01",
      ),
    /pelo menos dois/,
  );
});
test("lote misto persiste todos juntos e mantém o revezamento para o próximo mês", () => {
  const data = teamFixture(),
    plan = automaticTeamRotation(
      data,
      ids.company,
      "2027-01",
      selectedTeam,
      "2027-01-01",
    ),
    schedules = [...plan.schedules, normalTeamSchedule(data)];
  const saved = applyTeamGenerationLocally(data, schedules, plan);
  assert.equal(saved.schedules.length, 3);
  assert.equal(saved.models.length, 4);
  assert.equal(
    saved.employees.find((item) => item.id === ids.normal)!.modelo_padrao_id,
    ids.normalModel,
  );
  const next = automaticTeamRotation(
    saved,
    ids.company,
    "2027-02",
    selectedTeam,
    "2027-01-01",
  );
  assert.equal(
    next.schedules
      .find((item) => item.funcionario_id === ids.employee)!
      .dias.find((day) => day.data === "2027-02-01")!.folga,
    true,
  );
  assert.equal(data.schedules.length, 0);
});
test("distribuição equilibra cada turno em vez de concentrar dia e noite em fases opostas", () => {
  const data = teamFixture(),
    nightId = "81000000-0000-4000-8000-000000000013";
  data.models.push({
    ...data.models[0],
    id: nightId,
    nome: "Noturno",
    turno: [
      { start: "19:00", end: "00:00", endDay: 1 },
      { start: "01:00", end: "07:00", startDay: 1, endDay: 1 },
    ],
  });
  data.employees.push(
    {
      ...data.employees[0],
      id: "81000000-0000-4000-8000-000000000014",
      nome: "Bia",
      modelo_padrao_id: nightId,
    },
    {
      ...data.employees[0],
      id: "81000000-0000-4000-8000-000000000015",
      nome: "Camila",
      modelo_padrao_id: nightId,
    },
  );
  const plan = automaticTeamRotation(
    data,
    ids.company,
    "2027-01",
    [
      ids.employee,
      ids.colleague,
      ...data.employees.slice(-2).map((employee) => employee.id),
    ],
    "2027-01-01",
  );
  assert.deepEqual(
    plan.assignments
      .filter((item) => item.sourceId === ids.model)
      .map((item) => item.group),
    ["A", "B"],
  );
  assert.deepEqual(
    plan.assignments
      .filter((item) => item.sourceId === nightId)
      .map((item) => item.group),
    ["A", "B"],
  );
});
test("alteração em lote chega ao payload final do revezamento sem recuperar dias antigos", () => {
  const data = teamFixture(),
    plan = automaticTeamRotation(
      data,
      ids.company,
      "2027-01",
      selectedTeam,
      "2027-01-01",
    );
  const changed = applyBulkDayChanges(
    plan.schedules[0],
    ["2027-01-01"],
    null,
    "Folga individual revisada",
  );
  const payload = teamGenerationPayload(
    [changed, plan.schedules[1], normalTeamSchedule(data)],
    plan,
  );
  assert.equal(payload.itens.length, 3);
  assert.equal(payload.p_revezamento.vinculos.length, 2);
  assert.equal(
    payload.itens[0].dias.find((day) => day.data === "2027-01-01")!.calendario!
      .excecao!.observacao,
    "Folga individual revisada",
  );
  assert.ok(payload.itens.every((item) => item.revisao_esperada === null));
  assert.ok(!("status" in payload.itens[0]));
  assert.ok(!JSON.stringify(payload).includes("cpf"));
});
test("falha em uma escala bloqueada impede qualquer alteração local do lote", () => {
  const data = teamFixture(),
    plan = automaticTeamRotation(
      data,
      ids.company,
      "2027-01",
      selectedTeam,
      "2027-01-01",
    ),
    normal = normalTeamSchedule(data);
  data.schedules.push({
    ...normal,
    id: "locked",
    revisao: 2,
    status: "publicada",
  });
  const before = JSON.stringify(data);
  assert.throws(
    () => applyTeamGenerationLocally(data, [...plan.schedules, normal], plan),
    /bloqueada/,
  );
  assert.equal(JSON.stringify(data), before);
});
test("a cobertura usa a equipe mista, mantendo os intervalos e a folga do outro grupo", () => {
  const data = teamFixture(),
    plan = automaticTeamRotation(
      data,
      ids.company,
      "2027-01",
      selectedTeam,
      "2027-01-01",
    ),
    schedules = [...plan.schedules, normalTeamSchedule(data)];
  const report = companyCoverage(
    rotationData(data, plan),
    ids.company,
    "2027-01",
    schedules,
  );
  assert.ok(report.days.every((day) => !day.gaps.length));
  assert.ok(
    report.days
      .find((day) => day.date === "2027-01-04")!
      .periods.some(
        (period) =>
          period.employees.includes("Bruna") &&
          period.employees.includes("Carla"),
      ),
  );
});
test("payload rejeita revezamento incompleto, modelo trocado e outra competência", () => {
  const data = teamFixture(),
    plan = automaticTeamRotation(
      data,
      ids.company,
      "2027-01",
      selectedTeam,
      "2027-01-01",
    );
  assert.throws(
    () => teamGenerationPayload(plan.schedules.slice(0, 1), plan),
    /grupos/,
  );
  assert.throws(
    () =>
      teamGenerationPayload(
        [{ ...plan.schedules[0], modelo_id: ids.model }, plan.schedules[1]],
        plan,
      ),
    /grupos/,
  );
  assert.throws(
    () =>
      teamGenerationPayload(
        [...plan.schedules, { ...normalTeamSchedule(data), mes: "2027-02-01" }],
        plan,
      ),
    /mesma empresa e competência/,
  );
});
test("duplicação mantém o modelo histórico sem exigir modelo individual atual", () => {
  const data = teamFixture();
  data.schedules.push(normalTeamSchedule(data));
  data.employees.find((item) => item.id === ids.normal)!.modelo_padrao_id =
    null;
  assert.equal(
    teamPlanningSelection(
      data,
      ids.company,
      [ids.normal],
      "2027-02",
      "2027-01",
    )[0].model.id,
    ids.normalModel,
  );
  assert.throws(
    () =>
      teamPlanningSelection(
        data,
        ids.company,
        [ids.normal],
        "2027-02",
        "2026-12",
      ),
    /origem/,
  );
});
