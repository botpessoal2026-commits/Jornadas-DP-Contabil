import { test } from "node:test";
import assert from "node:assert/strict";
import { demoData } from "../src/lib/demo";
import type { Data } from "../src/lib/store";
import type { Schedule, SpecialDate } from "../src/lib/types";
import {
  buildScheduleSnapshot,
  type ScheduleVersion,
} from "../src/lib/schedule-governance";
import { resolvePublishedContext } from "../src/lib/published-context";
import {
  consolidatedCSV,
  resolvedReportEntries,
} from "../src/lib/report-bundle";
import { projectData } from "../src/lib/special-dates";

function publication(
  data: Data,
  schedule: Schedule,
  version = 1,
): ScheduleVersion {
  return {
    id: `version-${schedule.id}-${version}`,
    escala_id: schedule.id,
    empresa_id: schedule.empresa_id,
    revisao: schedule.revisao!,
    versao: version,
    publicado_em: "2026-10-28T12:00:00Z",
    publicado_por: "demo-user",
    justificativa: "",
    snapshot: buildScheduleSnapshot(data, schedule),
  };
}
function publishedFixture() {
  const data = demoData();
  const schedule: Schedule = {
    ...data.schedules[0],
    status: "publicada",
    revisao: 4,
  };
  data.schedules = data.schedules.map((item) =>
    item.id === schedule.id ? schedule : item,
  );
  const version = publication(data, schedule);
  data.scheduleVersions = [version];
  return { data, schedule, version };
}

test("publicação conserva empresa, CPF, cargo, regras e dias após alterações posteriores", async () => {
  const { data, schedule } = publishedFixture();
  const company = data.companies.find((c) => c.id === schedule.empresa_id)!;
  const employee = data.employees.find(
    (e) => e.id === schedule.funcionario_id,
  )!;
  const originalName = company.nome,
    originalJob = employee.cargo;
  const originalRules = JSON.stringify(data.rules);
  const event: SpecialDate = {
    id: "after-publication",
    empresa_id: company.id,
    estabelecimento_id: null,
    nome: "Recesso posterior",
    data_inicio: "2026-12-03",
    data_fim: null,
    categoria: "sem_expediente",
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
  };
  company.nome = "Empresa alterada depois";
  employee.cargo = "Cargo novo";
  employee.cpf = "12345678901";
  data.rules = data.rules.map((rule) => ({
    ...rule,
    valor: { ...rule.valor, limite_diario_minutos: 1 },
  }));
  data.specialDates = [event];
  const current = projectData(data).schedules.find(
    (item) => item.id === schedule.id,
  )!;
  assert.equal(
    current.dias.find((day) => day.data === "2026-12-03")!.intervalos.length,
    0,
  );
  const entry = await resolvePublishedContext(data, current);
  assert.equal(entry.company.nome, originalName);
  assert.equal(entry.employee.cargo, originalJob);
  assert.notEqual(entry.employee.cpf, employee.cpf);
  assert.equal(JSON.stringify(entry.data.rules), originalRules);
  assert.ok(
    entry.schedule.dias.find((day) => day.data === "2026-12-03")!.intervalos
      .length > 0,
  );
  assert.equal(entry.schedule.revisao, 4);
  assert.equal(entry.schedule.status, "publicada");
  assert.equal(company.nome, "Empresa alterada depois");
});

test("fechamento usa a última publicação aplicável, não versão futura nem outra escala", async () => {
  const { data, schedule, version } = publishedFixture();
  data.scheduleVersions = [
    { ...version, id: "wrong-company", empresa_id: "foreign", versao: 99 },
    { ...version, id: "future", versao: 3, revisao: 9 },
    version,
  ];
  const closed = { ...schedule, status: "fechada" as const, revisao: 5 };
  const context = await resolvePublishedContext(data, closed);
  assert.equal(context.version!.id, version.id);
  assert.equal(context.schedule.revisao, 4);
  assert.equal(context.schedule.status, "publicada");
  const nested = await resolvePublishedContext(context.data, context.schedule);
  assert.equal(nested.version!.id, version.id);
  assert.equal(nested.schedule.revisao, 4);
});

test("lote conserva contextos diferentes da mesma empresa sem fundir nomes ou regras", async () => {
  const { data, schedule, version } = publishedFixture();
  const employee = {
    ...data.employees[0],
    id: "demo-second-person",
    nome: "Segunda pessoa",
    cargo: "Segundo cargo",
  };
  const next: Schedule = {
    ...structuredClone(schedule),
    id: "demo-second-schedule",
    funcionario_id: employee.id,
    nome_funcionario: employee.nome,
    revisao: 3,
  };
  data.employees.push(employee);
  data.schedules.push(next);
  data.companies[0].nome = "Nome na segunda publicação";
  const secondVersion = publication(data, next);
  data.scheduleVersions = [version, secondVersion];
  data.companies[0].nome = "Nome atual";
  const entries = await resolvedReportEntries(data, [schedule, next]);
  assert.equal(entries[0].company.nome, "Aurora Contabilidade");
  assert.equal(entries[1].company.nome, "Nome na segunda publicação");
  const csv = consolidatedCSV(entries);
  assert.ok(csv.includes("Aurora Contabilidade"));
  assert.ok(csv.includes("Nome na segunda publicação"));
  assert.ok(!csv.includes("Nome atual"));
});

test("rascunhos e revisão usam programação exibida; demo sem versão falha antes da rede", async () => {
  const { data, schedule } = publishedFixture();
  const draft = { ...schedule, status: "rascunho" as const };
  data.companies[0].nome = "Nome atual";
  const current = await resolvePublishedContext(data, draft);
  assert.equal(current.company.nome, "Nome atual");
  assert.equal(current.schedule, draft);
  let called = false;
  await assert.rejects(
    () =>
      resolvePublishedContext(
        { ...data, scheduleVersions: [] },
        schedule,
        async () => {
          called = true;
          return [];
        },
      ),
    /demonstração/,
  );
  assert.equal(called, false);
});

test("snapshot com pessoa, empresa ou revisão cruzada é recusado sem fallback dinâmico", async () => {
  const { data, schedule, version } = publishedFixture();
  const invalid = structuredClone(version);
  invalid.snapshot.data.employees[0].empresa_id = "foreign";
  await assert.rejects(
    () =>
      resolvePublishedContext(
        { ...data, scheduleVersions: [invalid] },
        schedule,
      ),
    /contexto/,
  );
  const mismatched = structuredClone(version);
  mismatched.snapshot.data.schedules.find(
    (item) => item.id === schedule.id,
  )!.revisao = 100;
  await assert.rejects(
    () =>
      resolvePublishedContext(
        { ...data, scheduleVersions: [mismatched] },
        schedule,
      ),
    /revisão incompatível/,
  );
});

test("republicação remota não reutiliza cache de versão anterior; fechamento reconsulta versões", async () => {
  const fixture = publishedFixture();
  const companyId = "11111111-1111-4111-8111-111111111111",
    scheduleId = "22222222-2222-4222-8222-222222222222";
  const originalCompany = fixture.schedule.empresa_id,
    originalSchedule = fixture.schedule.id;
  const { data, schedule, version } = JSON.parse(
    JSON.stringify(fixture, (_key, value) =>
      value === originalCompany
        ? companyId
        : value === originalSchedule
          ? scheduleId
          : value,
    ),
  ) as ReturnType<typeof publishedFixture>;
  const newer = structuredClone(version);
  newer.id = "new-publication";
  newer.versao = 2;
  newer.revisao = 7;
  newer.snapshot.data.schedules.find(
    (item) => item.id === scheduleId,
  )!.revisao = 7;
  newer.snapshot.data.employees[0].cargo = "Cargo na republicação";
  let calls = 0;
  const load = async (company: string, id: string) => {
    assert.equal(company, companyId);
    assert.equal(id, scheduleId);
    calls++;
    return [newer, version];
  };
  const result = await resolvePublishedContext(
    data,
    { ...schedule, revisao: 7 },
    load,
  );
  assert.equal(calls, 1);
  assert.equal(result.version!.id, newer.id);
  assert.equal(result.employee.cargo, "Cargo na republicação");
  data.scheduleVersions = [newer];
  await resolvePublishedContext(
    data,
    { ...schedule, status: "fechada", revisao: 8 },
    load,
  );
  assert.equal(calls, 2);
});
