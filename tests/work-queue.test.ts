import { test } from "node:test";
import assert from "node:assert/strict";
import { demoData } from "../src/lib/demo";
import { projectData } from "../src/lib/special-dates";
import { buildWorkQueue, filterWorkQueue } from "../src/lib/work-queue";
import { buildAlertSummary } from "../src/lib/alerts";
import { evaluate } from "../src/lib/engine";
import { rulesForCompany } from "../src/lib/company-resources";
import { scheduleRegime } from "../src/lib/work-regime";

test("fila respeita empresa/vínculo ativos e competência, sem aproveitar referências cruzadas", () => {
  const data = projectData(demoData());
  const person = data.employees[0];
  data.employees.push(
    { ...person, id: "new", nome: "Sem escala" },
    { ...person, id: "inactive", situacao: "inativo" },
    { ...person, id: "unknown", empresa_id: "unknown-company" },
  );
  data.schedules.push(
    {
      ...data.schedules[0],
      id: "next-month",
      funcionario_id: "new",
      mes: "2027-01-01",
    },
    {
      ...data.schedules[0],
      id: "cross-company",
      empresa_id: data.companies[1].id,
      funcionario_id: "new",
    },
  );
  const entries = buildWorkQueue(data, "2026-12");
  assert.equal(
    entries.filter(
      (item) => item.employee.id === "new" && item.kind === "sem_escala",
    ).length,
    1,
  );
  assert.ok(
    entries.every(
      (item) => !["inactive", "unknown"].includes(item.employee.id),
    ),
  );
  data.companies[0].situacao = "inativa";
  assert.ok(
    buildWorkQueue(data, "2026-12").every(
      (item) => item.company.id !== person.empresa_id,
    ),
  );
  assert.deepEqual(buildWorkQueue(data, "2026-13"), []);
});

test("folga registrada não é ausência de escala; contrato pendente abre cadastro", () => {
  const data = projectData(demoData());
  data.schedules[0] = {
    ...data.schedules[0],
    dias: data.schedules[0].dias.map((day) => ({
      ...day,
      intervalos: [],
      folga: true,
      calendario: null,
    })),
  };
  data.employees[0].carga_semanal_minutos = null;
  const entries = buildWorkQueue(data, "2026-12").filter(
    (item) => item.employee.id === data.employees[0].id,
  );
  assert.equal(
    entries.some((item) => item.kind === "sem_escala"),
    false,
  );
  assert.equal(
    entries.find((item) => item.kind === "contrato")?.action,
    "employee",
  );
});

test("fila usa o calendário efetivo recebido e o mesmo validador, preservando fronteiras e dados", () => {
  const data = projectData(demoData());
  const schedule = data.schedules[0];
  const person = data.employees.find(
    (item) => item.id === schedule.funcionario_id,
  )!;
  const company = data.companies.find(
    (item) => item.id === schedule.empresa_id,
  )!;
  const first = schedule.dias.find((day) => day.data === "2026-12-01")!;
  first.intervalos = [{ start: "06:00", end: "20:00" }];
  first.folga = false;
  // An already-resolved boundary must not be replaced by a different saved month.
  data.schedules.push({
    ...schedule,
    id: "previous",
    mes: "2026-11-01",
    dias: [
      {
        ...first,
        data: "2026-11-30",
        intervalos: [{ start: "22:00", end: "06:00", endDay: 1 }],
      },
    ],
  });
  const before = JSON.stringify(data);
  const expected = buildAlertSummary(
    evaluate(
      schedule.dias,
      rulesForCompany(data.rules, company.id),
      company,
      schedule.mes,
      scheduleRegime(schedule, data.models),
      person,
    ).alerts,
    {
      companyId: company.id,
      companyName: company.nome,
      employeeId: person.id,
      month: "2026-12",
    },
  );
  const entries = buildWorkQueue(data, "2026-12").filter(
    (item) => item.employee.id === person.id,
  );
  assert.ok(expected.counts.violations > 0);
  assert.equal(
    entries.find((item) => item.kind === "impedimento")?.count,
    expected.counts.violations,
  );
  assert.equal(
    entries.find((item) => item.kind === "fontes")?.count,
    expected.counts.pendingSources,
  );
  assert.equal(entries.find((item) => item.kind === "fontes")?.action, "rules");
  assert.equal(JSON.stringify(data), before);
});

test("horário legado inválido vira conferência indisponível, sem derrubar a fila", () => {
  const data = projectData(demoData());
  data.schedules[0].dias[0].intervalos = [{ start: "99:00", end: "17:00" }];
  const entries = buildWorkQueue(data, "2026-12");
  const issue = entries.find(
    (item) =>
      item.employee.id === data.employees[0].id && item.kind === "conferencia",
  );
  assert.equal(issue?.action, "schedule");
  assert.ok(entries.some((item) => item.company.id === data.companies[1].id));
});

test("filtros de busca, empresa e tipo preservam o destino da pendência", () => {
  const data = projectData(demoData());
  data.employees[0].nome = "Érica Cardoso";
  data.employees[0].carga_semanal_minutos = null;
  const entries = buildWorkQueue(data, "2026-12");
  const filtered = filterWorkQueue(entries, {
    query: "erica",
    companyId: data.companies[0].id,
    kind: "contrato",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].employee.id, data.employees[0].id);
  assert.equal(filtered[0].action, "employee");
  assert.deepEqual(filterWorkQueue(entries, { companyId: "unknown" }), []);
  assert.deepEqual(filterWorkQueue(entries, { kind: "unknown" }), []);
});
