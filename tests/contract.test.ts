import { test } from "node:test";
import assert from "node:assert/strict";
import { contractMinutesFromHours } from "../src/lib/contract";
import { demoData } from "../src/lib/demo";
import { evaluate, generateDays } from "../src/lib/engine";
import { excelBuffer, exportRows, pdfDocument } from "../src/lib/exports";
import ExcelJS from "exceljs";

test("carga explícita: horas decimais, ausência, limites e precisão de minuto", () => {
  assert.equal(contractMinutesFromHours("30"), 1800);
  assert.equal(contractMinutesFromHours("30,5"), 1830);
  assert.equal(contractMinutesFromHours("30.5"), 1830);
  assert.equal(contractMinutesFromHours(""), null);
  assert.equal(contractMinutesFromHours("168"), 10080);
  for (const input of [
    "0",
    "-1",
    "169",
    "NaN",
    "Infinity",
    "30h",
    "0.001",
    "30.001",
  ])
    assert.throws(() => contractMinutesFromHours(input), /carga semanal/);
});

test("contrato de 30h identifica excesso mesmo sob teto parametrizado de 42h", () => {
  const d = demoData();
  const employee = { ...d.employees[0], carga_semanal_minutos: 1800 };
  const days = generateDays("2026-12", d.models[0], d.companies[0], []);
  const result = evaluate(
    days,
    d.rules,
    d.companies[0],
    "2026-12",
    "5x2",
    employee,
  );
  const alert = result.alerts.find(
    (a) => a.code === "contrato_semanal" && a.message.includes("2026-12-21"),
  );
  assert.equal(alert?.severity, "erro");
  assert.match(alert!.message, /Mariana Costa.*42h00.*30h00/);
  assert.ok(alert?.source);
  assert.ok(
    !evaluate(
      days,
      d.rules,
      d.companies[0],
      "2026-12",
      "5x2",
      d.employees[0],
    ).alerts.some((a) => a.code === "contrato_semanal"),
  );
});

test("texto de cadastro não é usado para presumir carga; legado exige revisão", () => {
  const d = demoData();
  for (const value of [undefined, null, 0, NaN, 1800.1]) {
    const employee = {
      ...d.employees[0],
      carga_semanal_minutos: value,
      horario_contratual: "30 h/semana",
    };
    const result = evaluate(
      d.schedules[0].dias,
      d.rules,
      d.companies[0],
      "2026-12",
      "5x2",
      employee,
    );
    assert.ok(result.alerts.some((a) => a.code === "contrato_pendente"));
    assert.ok(!result.alerts.some((a) => a.code === "contrato_semanal"));
  }
});

test("contrato usa relógio na virada de domingo, com horas noturnas computadas separadas", () => {
  const d = demoData();
  const days = generateDays(
    "2026-12",
    { ...d.models[0], padrao: {} },
    d.companies[0],
    [],
  );
  days.find((day) => day.data === "2026-12-06")!.intervalos = [
    { start: "22:00", end: "06:00" },
  ];
  const employee = { ...d.employees[0], carga_semanal_minutos: 400 };
  const result = evaluate(
    days,
    d.rules,
    d.companies[0],
    "2026-12",
    "turnos",
    employee,
  );
  // Segunda contém 360 minutos de relógio; o computado noturno é 402,857.
  const week = result.weeks.find((entry) => entry.start === "2026-12-07")!;
  assert.equal(week.total, 360);
  assert.ok(week.computedTotal > 400);
  assert.ok(
    !result.alerts.some(
      (a) => a.code === "contrato_semanal" && a.message.includes("2026-12-07"),
    ),
  );
  assert.ok(
    evaluate(days, d.rules, d.companies[0], "2026-12", "turnos", {
      ...employee,
      carga_semanal_minutos: 350,
    }).alerts.some(
      (a) => a.code === "contrato_semanal" && a.message.includes("2026-12-07"),
    ),
  );
});

test("PDF e Excel também incluem o alerta contratual da conferência", async () => {
  const d = demoData();
  const employee = { ...d.employees[0], carga_semanal_minutos: 1800 };
  const bytes = await excelBuffer(
    d.schedules[0],
    d.rules,
    d.companies[0],
    employee,
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const contents = JSON.stringify(
    book.getWorksheet("Resumo e alertas")!.getSheetValues(),
  );
  assert.match(contents, /30h00/);
  assert.match(contents, /supera a carga contratual/);
  const doc = await pdfDocument(
    d.schedules[0],
    d.rules,
    d.companies[0],
    employee,
  );
  assert.match(doc.output(), /30h00/);
});

test("importação real não cadastra hipóteses legais usadas na demonstração", async () => {
  const { initialRules, demonstrationRules } =
    await import("../src/lib/presets");
  assert.ok(initialRules.length >= 5);
  assert.ok(initialRules.every((r) => !r.nome.startsWith("Proposta")));
  assert.ok(initialRules.every((r) => r.confirmado === false));
  assert.equal(demonstrationRules.length, 2);
});

test("CSV usa a mesma carga estruturada da tela", () => {
  const d = demoData();
  const rows = exportRows(d.schedules[0], d.rules, {
    ...d.employees[0],
    carga_semanal_minutos: 1830,
  });
  assert.equal(rows.length, 31);
  assert.ok(rows.every((r) => r["Carga contratual semanal"] === "30h30"));
});

test("conferência respeita carga diária e descanso específicos do vínculo", () => {
  const d = demoData();
  const employee = {
    ...d.employees[0],
    carga_diaria_minutos: 360,
    dias_descanso: [0, 2, 6],
  };
  const report = evaluate(
    d.schedules[0].dias,
    d.rules,
    d.companies[0],
    "2026-12",
    "5x2",
    employee,
  );
  assert.ok(
    report.alerts.some(
      (alert) =>
        alert.code === "contrato_diario" &&
        alert.date === "2026-12-01" &&
        alert.severity === "erro",
    ),
  );
  assert.ok(
    report.alerts.some(
      (alert) =>
        alert.code === "descanso_contratual" && alert.date === "2026-12-01",
    ),
  );
  assert.ok(
    !report.alerts.some(
      (alert) =>
        alert.code === "descanso_contratual" && alert.date === "2026-12-02",
    ),
  );
});
