import type { Company, Employee, LegalRule, Schedule } from "./types";
import { computeDay, evaluate, formatMinutes, span } from "./engine";
import { rulesForCompany } from "./company-resources";
import { dayPresentation, specialDateTotals } from "./special-dates";
export function exportRows(
  schedule: Schedule,
  rules: LegalRule[],
  employee?: Employee,
  company?: Company,
) {
  rules = rulesForCompany(rules, schedule.empresa_id);
  return schedule.dias
    .filter((d) => d.data.startsWith(schedule.mes.slice(0, 7)))
    .map((d) => {
      const presentation = dayPresentation(d, schedule.dias);
      const hours = computeDay(d, rules, schedule.dias);
      return {
        Data: d.data,
        "Carga contratual semanal": employee?.carga_semanal_minutos
          ? formatMinutes(employee.carga_semanal_minutos)
          : "Pendente de revisão",
        Horário:
          d.intervalos
            .map(
              (s) =>
                `${s.start}–${s.end}${span(s)[1] >= 1440 ? " (+1 dia)" : ""}`,
            )
            .join(" / ") ||
          (hours.worked > 0
            ? "Continuação do turno anterior"
            : !d.eventos?.length && !d.calendario?.excecao
              ? "Folga"
              : presentation.kind === "folga"
                ? "Folga"
                : "Sem expediente"),
        Feriado: d.feriado ?? "",
        "Horas relógio": formatMinutes(hours.worked),
        "Horas computadas": formatMinutes(hours.computed),
        Observação: d.observacao,
        Empresa: company?.nome ?? schedule.empresa_id,
        Funcionário:
          employee?.nome ?? schedule.nome_funcionario ?? "Não informado",
        "Tipo do dia": presentation.label,
        Evento: presentation.names.length ? presentation.description : "",
        "Situação do expediente": presentation.status,
        "Horas programadas": formatMinutes(hours.worked),
        "Horas programadas em feriados": formatMinutes(
          presentation.isHoliday ? hours.worked : 0,
        ),
      };
    });
}
function calendarSummary(schedule: Schedule, rules: LegalRule[]) {
  const totals = specialDateTotals(schedule, rules);
  return [
    ["Dias de trabalho", String(totals.workDays)],
    ["Dias de folga/sem jornada", String(totals.restDays)],
    ["Feriados", String(totals.holidays)],
    ["Feriados trabalhados", String(totals.workingHolidays)],
    ["Horas programadas em feriados", formatMinutes(totals.holidayMinutes)],
    ["Pontos facultativos", String(totals.optionalDays)],
    ["Dias de recesso", String(totals.recessDays)],
    ["Outros dias sem expediente", String(totals.noWorkDays)],
  ];
}
function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function csvText(rows: Record<string, string>[]) {
  const encode = (s: string) =>
    `"${(/^(?:\s*[=+@-]|[\t\r\n])/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"`;
  return (
    "\uFEFF" +
    [Object.keys(rows[0] ?? {}), ...rows.map(Object.values)]
      .map((row) => row.map(encode).join(";"))
      .join("\r\n")
  );
}
export function exportCSV(
  s: Schedule,
  rules: LegalRule[],
  employee?: Employee,
  company?: Company,
) {
  download(
    new Blob([csvText(exportRows(s, rules, employee, company))], {
      type: "text/csv;charset=utf-8",
    }),
    `escala-${s.mes.slice(0, 7)}.csv`,
  );
}
export async function excelBuffer(
  s: Schedule,
  rules: LegalRule[],
  company: Company,
  employee?: Employee,
) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "Cont Contábil · Gerador de Jornadas";
  const sheet = book.addWorksheet("Escala");
  const rows = exportRows(s, rules, employee, company);
  sheet.columns = Object.keys(rows[0] ?? {}).map((key) => ({
    header: key,
    key,
    width: key === "Horário" ? 42 : 24,
  }));
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const summary = book.addWorksheet("Resumo e alertas");
  const result = evaluate(
    s.dias,
    rules,
    company,
    s.mes,
    s.modelo_tipo,
    employee,
  );
  summary.addRow(["Empresa", company.nome]);
  summary.addRow(["Funcionário", s.nome_funcionario ?? ""]);
  summary.addRow([
    "Carga contratual semanal",
    employee?.carga_semanal_minutos
      ? formatMinutes(employee.carga_semanal_minutos)
      : "Pendente de revisão",
  ]);
  summary.addRow(["Mês", s.mes.slice(0, 7)]);
  summary.addRow(["Horas computadas", formatMinutes(result.total)]);
  summary.addRow(["Horas de relógio", formatMinutes(result.clockTotal)]);
  calendarSummary(s, rules).forEach((row) => summary.addRow(row));
  summary.addRow(["Período", "Regime", "Divisor", "Fonte"]);
  for (const p of result.periods)
    summary.addRow([
      `${p.start} a ${p.end}`,
      p.rule?.nome ?? "Ausente",
      p.divisor ?? "Ausente",
      p.rule?.fonte ?? "",
    ]);
  summary.addRow(["Data", "Alerta", "Regra", "Fonte"]);
  result.alerts.forEach((a) =>
    summary.addRow([a.date, a.message, a.rule, a.source]),
  );
  summary.columns.forEach((c) => (c.width = 40));
  return book.xlsx.writeBuffer();
}
export async function exportExcel(
  s: Schedule,
  rules: LegalRule[],
  company: Company,
  employee?: Employee,
) {
  const buffer = await excelBuffer(s, rules, company, employee);
  download(
    new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `escala-${s.mes.slice(0, 7)}.xlsx`,
  );
}
export async function pdfDocument(
  s: Schedule,
  rules: LegalRule[],
  company: Company,
  employee?: Employee,
) {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF();
  const result = evaluate(
    s.dias,
    rules,
    company,
    s.mes,
    s.modelo_tipo,
    employee,
  );
  doc.setFontSize(18);
  doc.text("Gerador de Jornadas", 14, 18);
  doc.setFontSize(10);
  doc.text(`${company.nome} | CNPJ ${company.cnpj}`, 14, 26);
  doc.text(
    `${employee?.nome ?? s.nome_funcionario ?? ""} | ${employee?.cargo ?? ""} | ${s.mes.slice(0, 7)}`,
    14,
    32,
  );
  const rows = exportRows(s, rules, employee, company);
  autoTable(doc, {
    startY: 38,
    head: [["Data", "Horário", "Horas", "Feriado / evento"]],
    body: rows.map((r) => [
      r.Data,
      `${r.Horário}\n${r["Tipo do dia"]} · ${r["Situação do expediente"]}`,
      r["Horas computadas"],
      r.Evento || r.Feriado,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [10, 57, 116] },
  });
  doc.addPage();
  doc.text(
    `Total computado: ${formatMinutes(result.total)} | Relógio: ${formatMinutes(result.clockTotal)}`,
    14,
    18,
  );
  autoTable(doc, {
    startY: 25,
    head: [["Calendário programado", "Quantidade / horas de relógio"]],
    body: calendarSummary(s, rules),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [10, 57, 116] },
  });
  const calendarTable = (
    doc as typeof doc & {
      lastAutoTable?: { finalY: number };
    }
  ).lastAutoTable;
  autoTable(doc, {
    startY: (calendarTable?.finalY ?? 85) + 6,
    head: [["Vigência", "Regime / divisor", "Fonte"]],
    body: result.periods.map((p) => [
      `${p.start} a ${p.end}`,
      `${p.rule?.nome ?? "Sem regra"} / ${p.divisor ?? "—"}`,
      p.rule?.fonte ?? "Ausente",
    ]),
    styles: { fontSize: 8 },
  });
  doc.addPage();
  doc.text("Conferência de regras e alertas", 14, 18);
  autoTable(doc, {
    startY: 25,
    head: [["Data", "Alerta", "Regra e fonte"]],
    body: result.alerts.length
      ? result.alerts.map((a) => [a.date, a.message, `${a.rule} — ${a.source}`])
      : [["", "Sem alertas nos parâmetros cadastrados", ""]],
    styles: { fontSize: 7 },
  });
  doc.addPage();
  doc.text("Conferência e assinaturas", 14, 22);
  doc.text(
    "A escala depende da conferência dos parâmetros legais e do instrumento aplicável.",
    14,
    34,
  );
  doc.text(
    "_____________________________________    ____/____/________",
    14,
    65,
  );
  doc.text("Responsável pela empresa", 14, 72);
  doc.text(
    "_____________________________________    ____/____/________",
    14,
    105,
  );
  doc.text("Funcionário(a)", 14, 112);
  for (let i = 1; i <= doc.getNumberOfPages(); i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(
      `Gerado em ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} | Página ${i}/${doc.getNumberOfPages()}`,
      14,
      288,
    );
  }
  return doc;
}
export async function exportPDF(
  s: Schedule,
  rules: LegalRule[],
  company: Company,
  employee?: Employee,
) {
  (await pdfDocument(s, rules, company, employee)).save(
    `escala-${s.mes.slice(0, 7)}.pdf`,
  );
}

export async function exportTimesheetPDF(
  schedule: Schedule,
  company: Company,
  employee: Employee,
  options: import("./timesheet").TimesheetOptions = {},
) {
  const { timesheetDocument } = await import("./timesheet-pdf");
  const employeeName =
    employee.nome
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "funcionario";
  (await timesheetDocument(schedule, company, employee, options)).save(
    `folha-de-ponto-${schedule.mes.slice(0, 7)}-${employeeName}.pdf`,
  );
}
