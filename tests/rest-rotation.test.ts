import test from "node:test";
import assert from "node:assert/strict";
import { generateCalendarDays } from "../src/lib/special-dates";
import { resolveEmployeeModelWithOrigin } from "../src/lib/company-context";
import { reviewBulkSchedules } from "../src/lib/schedule-bulk";
import {
  prepareRestRotation,
  rotationCoverage,
  rotationData,
  rotationPayload,
  rotationPhase,
  applyRotationLocally,
} from "../src/lib/rest-rotation";
import {
  rotationFixture,
  rotationIds as ids,
  rotationSelection as selection,
} from "./fixtures/rotation-data";
const prepare = (
  data = rotationFixture(),
  month = "2027-01",
  reference = "2027-01-01",
) => prepareRestRotation(data, ids.company, month, reference, selection);

test("grupos A/B alternam diariamente, inclusive na segunda, com os mesmos horários e pausas", () => {
  const data = rotationFixture(),
    before = JSON.stringify(data),
    plan = prepare(data),
    days = rotationCoverage(plan);
  assert.equal(days.length, 31);
  assert.ok(
    days.every((day) => day.work.length === 1 && day.rest.length === 1),
  );
  assert.deepEqual(days.find((day) => day.date === "2027-01-04")!.work, [
    "Bruna",
  ]);
  assert.deepEqual(days.find((day) => day.date === "2027-01-04")!.rest, [
    "Ana",
  ]);
  assert.equal(plan.models[1].model.ciclo_inicio, "2027-01-02");
  assert.deepEqual(plan.models[1].model.turno, data.models[0].turno);
  assert.equal(JSON.stringify(data), before);
});
test("vínculo individual mantém fase após salvar e gerar fevereiro, sem reiniciar paridade no dia 1", () => {
  const data = rotationFixture(),
    saved = applyRotationLocally(data, prepare(data));
  for (const employee of saved.employees.slice(0, 2)) {
    const model = resolveEmployeeModelWithOrigin(
      employee,
      saved.companies[0],
      saved.models,
    ).model!;
    const days = generateCalendarDays(
      "2027-02",
      model,
      saved.companies[0],
      [],
      false,
      false,
    );
    assert.equal(days[0].folga, employee.id === ids.employee);
  }
  const next = prepare(saved, "2027-02");
  assert.equal(next.models.length, 2);
  assert.ok(
    next.models.every((item) =>
      saved.models.some((model) => model.id === item.model.id),
    ),
  );
  assert.equal(saved.models.length, 3);
  assert.equal(
    saved.logs.filter((item) => item.tabela === "escalas").length,
    2,
  );
  assert.equal(data.models.length, 1);
  assert.deepEqual(saved.rules, data.rules);
});
test("ano bissexto e referência anterior preservam a alternância contínua", () => {
  const plan = prepare(rotationFixture(), "2028-02", "2028-01-31");
  const days = rotationCoverage(plan);
  assert.equal(days.length, 29);
  assert.deepEqual(days[0].work, ["Bruna"]);
  assert.equal(rotationPhase("2027-01-02", "2027-01-01"), "B");
});
test("prévia confere usando os modelos novos e mantém pendências legais existentes", () => {
  const data = rotationFixture(),
    plan = prepare(data);
  const review = reviewBulkSchedules(rotationData(data, plan), plan.schedules);
  assert.equal(review.length, 2);
  assert.ok(review.every((row) => !row.error));
  assert.ok(review.some((row) => row.pending > 0));
});
test("seleção inválida, empresa cruzada, vínculo inativo e regime comum são rejeitados", () => {
  const data = rotationFixture();
  assert.throws(
    () =>
      prepareRestRotation(
        data,
        ids.company,
        "2027-01",
        "2027-02-01",
        selection,
      ),
    /referência/,
  );
  assert.throws(
    () =>
      prepareRestRotation(
        data,
        ids.company,
        "2027-13",
        "2027-01-01",
        selection,
      ),
    /competência/,
  );
  assert.throws(
    () =>
      prepareRestRotation(
        data,
        ids.company,
        "2027-01",
        "2027-01-01",
        selection.map((item) => ({ ...item, group: "A" })),
      ),
    /grupos A e B/,
  );
  assert.throws(
    () =>
      prepareRestRotation(data, ids.company, "2027-01", "2027-01-01", [
        selection[0],
        { employeeId: ids.foreign, group: "B" },
      ]),
    /vínculo ativo/,
  );
  data.employees[1].situacao = "inativo";
  assert.throws(() => prepare(data), /vínculo ativo/);
  data.employees[1].situacao = "ativo";
  data.models[0].tipo = "5x2";
  assert.throws(() => prepare(data), /modelo 12×36/);
});
test("escala publicada não é substituída e exceção individual de rascunho é preservada", () => {
  const data = rotationFixture(),
    previous = prepare(data).schedules[0];
  const day = previous.dias.find((item) => item.data === "2027-01-05")!;
  day.calendario = {
    base: {
      intervalos: structuredClone(day.intervalos),
      folga: false,
      feriado: null,
      observacao: "",
    },
    excecao: {
      categoria: "folga",
      nome: "",
      expediente: "sem_expediente",
      intervalos: [],
      observacao: "Folga individual",
    },
  };
  day.intervalos = [];
  day.folga = true;
  previous.id = "schedule";
  previous.revisao = 3;
  data.schedules.push(previous);
  const next = prepare(data).schedules[0];
  assert.equal(next.revisao, 3);
  assert.equal(
    next.dias.find((item) => item.data === day.data)!.calendario!.excecao!
      .observacao,
    "Folga individual",
  );
  previous.status = "publicada";
  assert.throws(() => prepare(data), /reabra a escala/);
});
test("feriados usam a política da empresa e não viram garantia automática de cobertura", () => {
  const data = rotationFixture();
  data.holidays.push({
    id: "holiday",
    empresa_id: ids.company,
    nome: "Feriado de teste",
    data: "2027-01-02",
    abrangencia: "nacional",
    uf: null,
    cidade: null,
  });
  assert.equal(rotationCoverage(prepare(data))[1].work.length, 1);
  data.companies[0].folgar_feriados = true;
  assert.equal(rotationCoverage(prepare(data))[1].work.length, 0);
});
test("payload envia a revisão esperada e somente modelos, vínculos e escalas deste contexto", () => {
  const data = rotationFixture(),
    plan = prepare(data),
    payload = rotationPayload(plan);
  assert.equal(payload.p_empresa, ids.company);
  assert.equal(payload.p_vinculos.length, 2);
  assert.ok(payload.itens.every((item) => item.revisao_esperada === null));
  assert.ok(
    payload.p_modelos.every(
      (item) =>
        item.destino.empresa_id === ids.company && item.origem.id === ids.model,
    ),
  );
  assert.ok(!JSON.stringify(payload).includes("cpf"));
});
