import type { Company, Employee, LegalRule, Schedule } from "./types";
import { computeDay, evaluate, formatMinutes, span } from "./engine";
import { rulesForCompany } from "./company-resources";
import { dayPresentation, specialDateTotals } from "./special-dates";
import { scheduleStatusLabels } from "./schedule-governance";
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
        "Situação da escala":
          scheduleStatusLabels[schedule.status ?? "rascunho"],
        "Revisão da escala":
          schedule.revisao === undefined
            ? "Não versionada"
            : String(schedule.revisao),
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
/** Keep files distinguishable across clients without putting CPF in the name. */
export function reportFilename(
  kind: string,
  schedule: Pick<
    Schedule,
    "mes" | "empresa_id" | "funcionario_id" | "nome_funcionario"
  >,
  extension: string,
  company?: Pick<Company, "nome">,
  employee?: Pick<Employee, "nome" | "matricula">,
) {
  const slug = (value: string, fallback: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || fallback;
  return (
    [
      slug(kind, "relatorio"),
      slug(company?.nome ?? schedule.empresa_id, "empresa"),
      slug(
        employee?.nome ?? schedule.nome_funcionario ?? schedule.funcionario_id,
        "funcionario",
      ),
      schedule.mes.slice(0, 7),
    ].join("-") +
    "." +
    extension.replace(/[^a-z0-9]/gi, "").toLowerCase()
  );
}
export function downloadReport(blob: Blob, name: string) {
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
  downloadReport(
    new Blob([csvText(exportRows(s, rules, employee, company))], {
      type: "text/csv;charset=utf-8",
    }),
    reportFilename("escala", s, "csv", company, employee),
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
  downloadReport(
    new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    reportFilename("escala", s, "xlsx", company, employee),
  );
}
export async function pdfDocument(
  s: Schedule,
  rules: LegalRule[],
  company: Company,
  employee?: Employee,
  options: { compact?: boolean; preview?: boolean } = {},
) {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF();
  doc.setProperties({
    title: `Escala - ${company.nome} - ${employee?.nome ?? s.nome_funcionario ?? ""} - ${s.mes.slice(0, 7)}`,
    creator: "Cont Contábil · Gerador de Jornadas",
  });
  const result = evaluate(
    s.dias,
    rules,
    company,
    s.mes,
    s.modelo_tipo,
    employee,
  );
  if (options.compact) {
    doc.setFontSize(15);
    doc.text("Escala de trabalho · Cont Contábil", 14, 16);
    doc.setFontSize(9);
    const heading = doc.splitTextToSize(
      `${company.nome} | ${company.cnpj}\n${employee?.nome ?? s.nome_funcionario ?? "Funcionário"} | ${employee?.cargo ?? ""} | ${s.mes.slice(0, 7)}`,
      182,
    ) as string[];
    doc.text(heading, 14, 23);
    const startY = 23 + heading.length * 4.2 + 3;
    const rows = exportRows(s, rules, employee, company);
    autoTable(doc, {
      startY,
      margin: { left: 14, right: 14, bottom: 23 },
      head: [["Dia", "Horário programado", "Horas", "Evento / observação"]],
      body: rows.map((row) => [
        row.Data.slice(8),
        row.Horário,
        row["Horas relógio"],
        [row.Evento || row.Feriado, row.Observação].filter(Boolean).join(" · "),
      ]),
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 1.6, overflow: "linebreak" },
      headStyles: { fillColor: [10, 57, 116] },
      columnStyles: {
        0: { cellWidth: 12 },
        1: { cellWidth: 68 },
        2: { cellWidth: 20 },
      },
    });
    const finalY =
      (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable
        ?.finalY ?? startY;
    if (finalY > 252) doc.addPage();
    const summaryY = finalY > 252 ? 18 : finalY + 7;
    doc.setFontSize(8);
    doc.text(
      `Horas programadas: ${formatMinutes(result.clockTotal)} | Computadas: ${formatMinutes(result.total)}`,
      14,
      summaryY,
    );
    const note = result.alerts.length
      ? `${result.alerts.length} alerta(s) na conferência. Consulte o relatório completo antes de aprovar.`
      : "Sem alertas nos parâmetros cadastrados. Consulte a conferência completa.";
    doc.text(doc.splitTextToSize(note, 182), 14, summaryY + 5);
    for (let page = 1; page <= doc.getNumberOfPages(); page++) {
      doc.setPage(page);
      doc.setFontSize(7);
      doc.text(
        `Cont Contábil · ${options.preview ? "Prévia não salva" : scheduleStatusLabels[s.status ?? "rascunho"]}${s.revisao === undefined ? "" : ` · Revisão ${s.revisao}`} · Página ${page}/${doc.getNumberOfPages()}`,
        14,
        288,
      );
    }
    return doc;
  }
  doc.setFontSize(18);
  doc.text("Gerador de Jornadas", 14, 18);
  doc.setFontSize(10);
  const identification = doc.splitTextToSize(
    `${company.nome} | CNPJ ${company.cnpj}\n${employee?.nome ?? s.nome_funcionario ?? ""} | ${employee?.cargo ?? ""} | ${s.mes.slice(0, 7)}`,
    182,
  ) as string[];
  doc.text(identification, 14, 26);
  const rows = exportRows(s, rules, employee, company);
  autoTable(doc, {
    startY: 29 + identification.length * 4.2,
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
      `Cont Contábil · ${options.preview ? "Prévia não salva" : scheduleStatusLabels[s.status ?? "rascunho"]}${s.revisao === undefined ? "" : ` · Revisão ${s.revisao}`} | ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} | Página ${i}/${doc.getNumberOfPages()}`,
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
  options: { compact?: boolean; preview?: boolean } = {},
) {
  (await pdfDocument(s, rules, company, employee, options)).save(
    reportFilename(
      options.compact ? "escala-compacta" : "escala",
      s,
      "pdf",
      company,
      employee,
    ),
  );
}

export async function exportTimesheetPDF(
  schedule: Schedule,
  company: Company,
  employee: Employee,
  options: import("./timesheet").TimesheetOptions = {},
) {
  const { timesheetDocument } = await import("./timesheet-pdf");
  (await timesheetDocument(schedule, company, employee, options)).save(
    reportFilename("folha-de-ponto", schedule, "pdf", company, employee),
  );
}
