import test from "node:test";
import assert from "node:assert/strict";
import { demoData } from "../src/lib/demo";
import {
  applyDemoTransition,
  buildScheduleSnapshot,
  isScheduleLocked,
  scheduleStatus,
  transitionEligibility,
} from "../src/lib/schedule-governance";
import { readAllPages, scheduleMonthWindow } from "../src/lib/store";

const clear = { violations: 0, pendingSources: 0 };
test("fluxo distingue salvar, revisar, aprovar, publicar e fechar sem pular etapas", () => {
  const data = demoData(),
    schedule = data.schedules[0];
  assert.equal(scheduleStatus(schedule), "rascunho");
  assert.equal(isScheduleLocked(schedule), false);
  assert.match(transitionEligibility(schedule, "publicada", clear)!, /ordem/);
  let next = applyDemoTransition(
    data,
    schedule,
    "em_revisao",
    "",
    "demo-user",
    clear,
  );
  next = applyDemoTransition(
    next,
    next.schedules[0],
    "aprovada",
    "Conferência concluída",
    "demo-user",
    clear,
  );
  assert.equal(isScheduleLocked(next.schedules[0]), true);
  assert.equal(next.schedules[0].conferido_por, "demo-user");
  next = applyDemoTransition(
    next,
    next.schedules[0],
    "publicada",
    "Versão de dezembro",
    "demo-user",
    clear,
  );
  assert.equal(next.scheduleVersions?.length, 1);
  assert.equal(next.scheduleVersions?.[0].versao, 1);
  assert.equal(schedule.status, undefined);
  next = applyDemoTransition(
    next,
    next.schedules[0],
    "fechada",
    "Conferência final",
    "demo-user",
    clear,
  );
  assert.equal(scheduleStatus(next.schedules[0]), "fechada");
  assert.equal(next.logs[0].campos?.includes("status"), true);
});
test("impedimentos e fontes pendentes continuam bloqueando aprovação e publicação", () => {
  const data = demoData();
  const schedule = { ...data.schedules[0], status: "em_revisao" as const };
  assert.match(
    transitionEligibility(schedule, "aprovada", { ...clear, violations: 1 })!,
    /impedimentos/,
  );
  assert.match(
    transitionEligibility(schedule, "aprovada", {
      ...clear,
      pendingSources: 1,
    })!,
    /fontes/,
  );
  assert.equal(transitionEligibility(schedule, "aprovada", clear), null);
});
test("reabrir exige justificativa e preserva versões anteriores e dados originais", () => {
  const data = demoData();
  data.schedules[0] = {
    ...data.schedules[0],
    status: "publicada",
    revisao: 12,
  };
  const schedule = data.schedules[0];
  assert.match(
    transitionEligibility(schedule, "rascunho", clear, "Ajuste")!,
    /10 caracteres/,
  );
  const next = applyDemoTransition(
    data,
    schedule,
    "rascunho",
    "Revisão de uma alteração autorizada",
    "demo-user",
    clear,
  );
  assert.equal(next.schedules[0].revisao, 13);
  assert.equal(next.schedules[0].conferido_por, null);
  assert.deepEqual(next.schedules[0].dias, schedule.dias);
  assert.equal(schedule.status, "publicada");
});
test("demonstração também detecta revisão concorrente e contexto de empresa", () => {
  const data = demoData(),
    schedule = data.schedules[0];
  assert.throws(
    () =>
      applyDemoTransition(data, { ...schedule, revisao: 9 }, "em_revisao", ""),
    /outra sessão/,
  );
  assert.throws(
    () =>
      applyDemoTransition(
        data,
        { ...schedule, empresa_id: "outra" },
        "em_revisao",
        "",
      ),
    /indisponível/,
  );
});
test("snapshot congela identificação, regras, eventos e horas sem misturar empresas", () => {
  const data = demoData(),
    schedule = data.schedules[0];
  const snapshot = buildScheduleSnapshot(data, schedule);
  const original = JSON.stringify(snapshot);
  data.companies[0].nome = "Nome futuro";
  data.employees[0].nome = "Pessoa futura";
  data.schedules[0].dias[0].observacao = "Alteração posterior";
  assert.equal(JSON.stringify(snapshot), original);
  assert.equal(snapshot.data.companies.length, 1);
  assert.equal(snapshot.data.employees.length, 1);
  assert.ok(
    snapshot.data.schedules.every(
      (entry) => entry.empresa_id === schedule.empresa_id,
    ),
  );
  assert.equal(snapshot.data.scheduleVersions, undefined);
});
test("paginação respeita limite efetivo menor da API e total exato", async () => {
  const all = Array.from({ length: 1101 }, (_, id) => ({ id }));
  const ranges: number[] = [];
  const actual = await readAllPages(async (from) => {
    ranges.push(from);
    return {
      data: all.slice(from, from + 250),
      error: null,
      count: all.length,
    };
  });
  assert.deepEqual(actual, all);
  assert.deepEqual(ranges, [0, 250, 500, 750, 1000]);
  await assert.rejects(
    readAllPages(async () => ({ data: [], error: null, count: 12 })),
    /interrompida/,
  );
  await assert.rejects(
    readAllPages(async () => ({
      data: null,
      error: { message: "Sem acesso", code: "42501" },
    })),
    /Sem acesso/,
  );
});
test("janela opcional conserva competências vizinhas em virada de ano", () => {
  assert.deepEqual(scheduleMonthWindow("2026-12"), {
    from: "2026-11-01",
    to: "2027-01-01",
  });
  assert.deepEqual(scheduleMonthWindow("2027-01"), {
    from: "2026-12-01",
    to: "2027-02-01",
  });
  assert.throws(() => scheduleMonthWindow("2026-13"), /inválida/);
});
