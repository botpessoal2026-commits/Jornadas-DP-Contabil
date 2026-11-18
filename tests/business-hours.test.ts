import test from "node:test";
import assert from "node:assert/strict";
import {
  validateBusinessHours,
  businessHoursFromForm,
} from "../src/lib/business-hours";
import {
  companyCoverage,
  resolveCompanyCoverage,
} from "../src/lib/company-coverage";
import {
  applyRotationLocally,
  prepareRestRotation,
} from "../src/lib/rest-rotation";
import { buildScheduleSnapshot } from "../src/lib/schedule-governance";
import {
  rotationFixture,
  rotationIds as ids,
  rotationSelection,
} from "./fixtures/rotation-data";
import type { BusinessHours } from "../src/lib/types";

const hours = (split = true): BusinessHours => ({
  semana: Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [
      String(day),
      split
        ? [
            { start: "07:00", end: "12:00" },
            { start: "13:00", end: "19:00" },
          ]
        : [{ start: "07:00", end: "19:00" }],
    ]),
  ),
  minimo_funcionarios: 1,
  feriados: "seguir_semana",
});
function planned() {
  const data = rotationFixture();
  data.companies[0].horario_funcionamento = hours();
  return applyRotationLocally(
    data,
    prepareRestRotation(
      data,
      ids.company,
      "2027-01",
      "2027-01-01",
      rotationSelection,
    ),
  );
}

test("funcionamento é opcional e valida sete dias, 24 horas, pausas e virada de dia", () => {
  assert.equal(validateBusinessHours(null), null);
  assert.deepEqual(validateBusinessHours(hours()), hours());
  const continuous = hours();
  continuous.semana = Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [
      String(day),
      [{ start: "00:00", end: "00:00", endDay: 1 }],
    ]),
  );
  assert.equal(validateBusinessHours(continuous)!.semana["0"][0].endDay, 1);
  assert.equal(
    businessHoursFromForm(JSON.stringify(hours()))!.minimo_funcionarios,
    1,
  );
  assert.throws(() => businessHoursFromForm("{inválido}"), /ler o horário/);
});
test("validação rejeita horários, sobreposição entre dias/semana, duração maior que 24h e cobertura fracionada", () => {
  for (const patch of [
    { minimo_funcionarios: 0 },
    { minimo_funcionarios: 1.5 },
    { feriados: "incerto" },
    { campo: true },
  ])
    assert.throws(() => validateBusinessHours({ ...hours(), ...patch }));
  const bad = hours();
  bad.semana["1"] = [{ start: "25:00", end: "19:00" }];
  assert.throws(() => validateBusinessHours(bad));
  bad.semana["1"] = [{ start: "08:00", end: "19:00", endDay: 1 }];
  assert.throws(() => validateBusinessHours(bad));
  bad.semana = Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [String(day), []]),
  );
  bad.semana["6"] = [{ start: "22:00", end: "06:00", endDay: 1 }];
  bad.semana["0"] = [{ start: "05:00", end: "10:00" }];
  assert.throws(() => validateBusinessHours(bad), /sobrepostos/);
  delete bad.semana["2"];
  assert.throws(() => validateBusinessHours(bad), /sete dias/);
});
test("grupos A/B cobrem o funcionamento com pausa da empresa, preservando folga alternada", () => {
  const report = companyCoverage(planned(), ids.company, "2027-01");
  assert.equal(report.days.length, 31);
  assert.ok(
    report.days.every((day) => day.status === "coberto" && !day.gaps.length),
  );
  assert.deepEqual(
    report.days.find((day) => day.date === "2027-01-04")!.periods[0].employees,
    ["Bruna"],
  );
});
test("intervalo intrajornada deixa lacuna se a empresa continua aberta e outro funcionário pode cobri-la", () => {
  const data = planned();
  data.companies[0].horario_funcionamento = hours(false);
  const first = companyCoverage(data, ids.company, "2027-01").days[0];
  assert.deepEqual(
    first.gaps.map((period) => [period.start, period.end, period.actual]),
    [[720, 780, 0]],
  );
  const colleague = data.schedules[1].dias.find(
    (day) => day.data === "2027-01-01",
  )!;
  colleague.intervalos = [{ start: "12:00", end: "13:00" }];
  colleague.folga = false;
  assert.equal(
    companyCoverage(data, ids.company, "2027-01").days[0].gaps.length,
    0,
  );
});
test("funcionário não é contado duas vezes em horários sobrepostos e meta de 2 continua pendente", () => {
  const data = planned();
  data.companies[0].horario_funcionamento!.minimo_funcionarios = 2;
  data.schedules[0].dias
    .find((day) => day.data === "2027-01-01")!
    .intervalos.push({ start: "08:00", end: "10:00" });
  const day = companyCoverage(data, ids.company, "2027-01").days[0];
  assert.ok(day.periods.every((period) => period.actual === 1));
  assert.equal(day.status, "descoberto");
});
test("dias ausentes ficam incompletos e trabalho antes/depois do funcionamento é identificado", () => {
  const data = planned();
  data.companies[0].horario_funcionamento!.semana["5"] = [
    { start: "08:00", end: "18:00" },
  ];
  const day = companyCoverage(data, ids.company, "2027-01").days[0];
  assert.deepEqual(
    day.outside.map((period) => [period.start, period.end]),
    [
      [420, 480],
      [1080, 1140],
    ],
  );
  data.schedules = data.schedules.slice(0, 1);
  assert.equal(
    companyCoverage(data, ids.company, "2027-01").days[0].status,
    "incompleto",
  );
});
test("feriado fechado e recesso empresarial são considerados sem transformar a política em regra legal", () => {
  const data = planned();
  data.companies[0].horario_funcionamento!.feriados = "fechado";
  data.holidays.push({
    id: "holiday",
    empresa_id: ids.company,
    nome: "Feriado",
    data: "2027-01-01",
    abrangencia: "nacional",
    uf: null,
    cidade: null,
  });
  let day = companyCoverage(data, ids.company, "2027-01").days[0];
  assert.equal(day.status, "fechado");
  assert.ok(day.outside.length);
  data.specialDates = [
    {
      id: "recess",
      empresa_id: ids.company,
      estabelecimento_id: null,
      nome: "Recesso",
      categoria: "recesso",
      data_inicio: "2027-01-01",
      data_fim: null,
      alcance: "empresa",
      funcionario_ids: [],
      recorrencia: "unica",
      expediente: "sem_expediente",
      intervalos: [],
      observacoes: "",
      ativo: true,
      data_movel: false,
      uf: null,
      cidade: null,
    },
  ];
  day = companyCoverage(data, ids.company, "2027-01").days[0];
  assert.equal(day.outside.length, 0);
});
test("prévia substitui somente os funcionários selecionados e usa escalas salvas dos demais", () => {
  const data = planned(),
    preview = structuredClone(data.schedules[0]);
  preview.dias.find((day) => day.data === "2027-01-01")!.intervalos = [];
  preview.dias.find((day) => day.data === "2027-01-01")!.folga = true;
  const before = JSON.stringify(data);
  assert.equal(
    companyCoverage(data, ids.company, "2027-01", [preview]).days[0].gaps
      .length,
    2,
  );
  assert.equal(JSON.stringify(data), before);
  assert.throws(
    () =>
      companyCoverage(data, ids.company, "2027-01", [
        { ...preview, funcionario_id: ids.foreign },
      ]),
    /outra empresa/,
  );
  assert.throws(
    () => companyCoverage(data, ids.company, "2027-01", [preview, preview]),
    /repetidas/,
  );
});
test("continuação noturna usa a escala real do mês anterior e não trata projeção como registro salvo", () => {
  const data = rotationFixture();
  data.models[0].turno = [
    { start: "19:00", end: "00:00", endDay: 1 },
    { start: "01:00", end: "07:00", startDay: 1, endDay: 1 },
  ];
  data.companies[0].horario_funcionamento = {
    ...hours(),
    semana: Object.fromEntries(
      Array.from({ length: 7 }, (_, day) => [
        String(day),
        [{ start: "00:00", end: "00:00", endDay: 1 }],
      ]),
    ),
  };
  const january = applyRotationLocally(
    data,
    prepareRestRotation(
      data,
      ids.company,
      "2027-01",
      "2027-01-01",
      rotationSelection,
    ),
  );
  const february = applyRotationLocally(
    january,
    prepareRestRotation(
      january,
      ids.company,
      "2027-02",
      "2027-01-01",
      rotationSelection,
    ),
  );
  const first = companyCoverage(february, ids.company, "2027-02").days[0];
  assert.ok(
    first.periods.some(
      (period) =>
        period.start === 60 &&
        period.end === 420 &&
        period.employees.includes("Ana"),
    ),
  );
  february.schedules = february.schedules.filter((schedule) =>
    schedule.mes.startsWith("2027-02"),
  );
  const incomplete = companyCoverage(february, ids.company, "2027-02").days[0];
  assert.ok(incomplete.issues.some((issue) => issue.includes("mês anterior")));
  assert.ok(
    incomplete.periods
      .filter((period) => period.end <= 420)
      .every((period) => period.actual === 0),
  );
});
test("publicações preservam dias congelados na análise e cadastro sem horários não presume cobertura", async () => {
  const data = planned(),
    schedule = data.schedules[0];
  schedule.status = "publicada";
  data.scheduleVersions = [
    {
      id: "snapshot",
      escala_id: schedule.id,
      empresa_id: schedule.empresa_id,
      revisao: schedule.revisao!,
      versao: 1,
      publicado_em: "2027-01-01T00:00:00Z",
      publicado_por: "owner",
      justificativa: "",
      snapshot: buildScheduleSnapshot(data, structuredClone(schedule)),
    },
  ];
  schedule.dias = [];
  assert.equal(
    (await resolveCompanyCoverage(data, ids.company, "2027-01")).days[0]
      .periods[0].actual,
    1,
  );
  delete data.companies[0].horario_funcionamento;
  assert.equal(companyCoverage(data, ids.company, "2027-01").configured, false);
});
