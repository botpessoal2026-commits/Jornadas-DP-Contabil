import { test } from "node:test";
import assert from "node:assert/strict";
import { demoData } from "../src/lib/demo";
import {
  applicableHolidayDates,
  calendarWeek,
  shiftMonth,
  recentSchedules,
} from "../src/lib/workspace-improvements";
import { draftKey, validDraft, type DraftRecord } from "../src/lib/draft-vault";
import type { SpecialDate } from "../src/lib/types";

test("indicador conta datas efetivas, recorrência e coincidências sem contaminar empresa", () => {
  const data = demoData(),
    company = data.companies[0],
    person = data.employees.find((e) => e.empresa_id === company.id)!;
  const event: SpecialDate = {
    id: "new",
    empresa_id: company.id,
    nome: "Feriado anual",
    categoria: "feriado_especifico",
    estabelecimento_id: null,
    data_inicio: "2025-12-10",
    data_fim: null,
    alcance: "funcionario",
    funcionario_ids: [person.id],
    recorrencia: "anual",
    expediente: "normal",
    intervalos: [],
    observacoes: "",
    ativo: true,
    data_movel: false,
    uf: null,
    cidade: null,
  };
  const original = applicableHolidayDates(data, company, "2026-12");
  data.specialDates = [
    event,
    { ...event, id: "same" },
    { ...event, id: "other", empresa_id: "outra", data_inicio: "2025-12-11" },
  ];
  const actual = applicableHolidayDates(data, company, "2026-12");
  assert.equal(actual.filter((d) => d === "2026-12-10").length, 1);
  assert.ok(!actual.includes("2026-12-11"));
  assert.equal(actual.length, new Set([...original, "2026-12-10"]).size);
});
test("navegação da competência e semana respeita ano e data civil", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2027-01", -1), "2026-12");
  assert.deepEqual(calendarWeek("2027-01-01"), {
    start: "2026-12-28",
    end: "2027-01-03",
  });
});
test("últimas escalas seguem atualização e não posição do array", () => {
  const data = demoData(),
    base = data.schedules[0];
  data.schedules = [
    { ...base, id: "new", updated_at: "2026-10-28T10:00:00Z" },
    { ...base, id: "old", updated_at: "2026-10-26T10:00:00Z" },
  ];
  assert.equal(recentSchedules(data)[0].id, "new");
  assert.equal(data.schedules[1].id, "old");
});
test("recuperação exige a mesma conta, empresa, pessoa e competência e expira", () => {
  const schedule = demoData().schedules[0],
    now = Date.now(),
    owner = "owner";
  const record: DraftRecord = {
    key: draftKey(
      owner,
      schedule.empresa_id,
      schedule.funcionario_id,
      schedule.mes,
    ),
    owner,
    company: schedule.empresa_id,
    employee: schedule.funcionario_id,
    month: schedule.mes.slice(0, 7),
    savedAt: now,
    schedule,
  };
  assert.ok(
    validDraft(
      record,
      owner,
      record.company,
      record.employee,
      record.month,
      now,
    ),
  );
  assert.equal(
    validDraft(
      record,
      "other",
      record.company,
      record.employee,
      record.month,
      now,
    ),
    false,
  );
  assert.equal(
    validDraft(record, owner, "other", record.employee, record.month, now),
    false,
  );
  assert.equal(
    validDraft(record, owner, record.company, "other", record.month, now),
    false,
  );
  assert.equal(
    validDraft(record, owner, record.company, record.employee, "2027-01", now),
    false,
  );
  assert.equal(
    validDraft(
      record,
      owner,
      record.company,
      record.employee,
      record.month,
      now + 8 * 86400000,
    ),
    false,
  );
});
