import type { Table } from "jspdf-autotable";
import type { Company, Employee, Schedule } from "./types";
import { formatCpf } from "./cpf";
import {
  buildTimesheet,
  type TimesheetData,
  type TimesheetOptions,
} from "./timesheet";

const weekdayOrder = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function weekdayLabel(days: Set<string>) {
  const indexes = weekdayOrder.flatMap((day, index) =>
    days.has(day) ? [index] : [],
  );
  const labels: string[] = [];
  for (let i = 0; i < indexes.length; i++) {
    const first = indexes[i];
    let last = first;
    while (indexes[i + 1] === last + 1) last = indexes[++i];
    labels.push(
      last - first >= 2
        ? `${weekdayOrder[first]}–${weekdayOrder[last]}`
        : first === last
          ? weekdayOrder[first]
          : `${weekdayOrder[first]} e ${weekdayOrder[last]}`,
    );
  }
  return labels.join(", ");
}

function datesLabel(dates: string[]) {
  const labels: string[] = [];
  for (let i = 0; i < dates.length; i++) {
    const first = dates[i];
    let last = first;
    while (
      dates[i + 1] &&
      Number(dates[i + 1].slice(-2)) === Number(last.slice(-2)) + 1
    )
      last = dates[++i];
    labels.push(
      first === last ? first.slice(-2) : `${first.slice(-2)}–${last.slice(-2)}`,
    );
  }
  return `${labels.join(", ")}/${dates[0].slice(5, 7)}`;
}

/** Presentation only: summarize the same hours previously shown in the table. */
function workHoursLabel(data: TimesheetData) {
  const groups = new Map<string, { weekdays: Set<string>; dates: string[] }>();
  const weekdayPatterns = new Map<string, Set<string>>();
  for (const row of data.rows) {
    const periods = row.planned.filter((period) => /^\d{2}:\d{2}/.test(period));
    if (row.rest || !periods.length) continue;
    const hours = periods
      .map((period) => period.replace(/–/g, " às "))
      .join(" | ");
    const group = groups.get(hours) ?? {
      weekdays: new Set<string>(),
      dates: [],
    };
    group.weekdays.add(row.weekday);
    group.dates.push(row.date);
    groups.set(hours, group);
    const patterns = weekdayPatterns.get(row.weekday) ?? new Set<string>();
    patterns.add(hours);
    weekdayPatterns.set(row.weekday, patterns);
  }
  if (!groups.size)
    return (
      data.employee.horario_contratual?.trim() ||
      "Sem jornada registrada nesta competência"
    );
  if (groups.size === 1) return groups.keys().next().value!;
  const variesWithinWeekday = Array.from(weekdayPatterns.values()).some(
    (patterns) => patterns.size > 1,
  );
  return Array.from(
    groups,
    ([hours, group]) =>
      `${variesWithinWeekday ? datesLabel(group.dates) : weekdayLabel(group.weekdays)}: ${hours}`,
  ).join("; ");
}

function dateLabel(date: string) {
  const [year, month, day] = date.slice(0, 10).split("-");
  return day && month && year ? `${day}/${month}/${year}` : date;
}
function cnpjLabel(value: string) {
  return /^\d{14}$/.test(value)
    ? value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : value || "Não informado";
}

export async function timesheetDocument(
  schedule: Schedule,
  company: Company,
  employee: Employee,
  options: TimesheetOptions = {},
) {
  const data = buildTimesheet(schedule, company, employee, options);
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ format: "a4", orientation: "portrait" });
  doc.setProperties({
    title: `Folha de ponto individual - ${employee.nome} - ${data.month}`,
    subject: "Formulário para marcações reais, baseado na escala do calendário",
    author: company.nome,
    creator: "Cont Contábil · Gerador de Jornadas",
  });
  doc.setLineHeightFactor(1);
  const margin = 10;
  const width = 190;
  const location = [company.cidade, company.uf].filter(Boolean).join(" / ");
  const identification = [
    `Empresa: ${company.nome}`,
    `CNPJ: ${cnpjLabel(company.cnpj)}${location ? ` | Localidade: ${location}` : ""}`,
    ...(company.endereco ? [`Endereço: ${company.endereco}`] : []),
    `Funcionário: ${employee.matricula ? `${employee.matricula} - ` : ""}${employee.nome}`,
    `CPF: ${formatCpf(employee.cpf)}`,
    `Cargo: ${employee.cargo || "Não informado"}${employee.setor ? ` | Setor: ${employee.setor}` : ""}`,
    `Admissão: ${employee.admissao ? dateLabel(employee.admissao) : "Não informada"} | Base: ${data.preview ? "prévia não salva" : "escala do calendário"}`,
    `Horário de trabalho: ${workHoursLabel(data)}`,
  ];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const identificationLines = identification.flatMap(
    (line) => doc.splitTextToSize(line, width) as string[],
  );
  const notice = data.rows.some((row) => row.planned.length > 2)
    ? "Registre períodos adicionais nas observações; eles não são classificados automaticamente como extras."
    : "";
  doc.setFontSize(7);
  const noticeLines = notice
    ? (doc.splitTextToSize(notice, width) as string[])
    : [];
  const tableStart =
    22 + identificationLines.length * 3.6 + noticeLines.length * 3.2 + 3;
  const drawHeader = () => {
    doc.setTextColor(18, 40, 62);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Folha de ponto individual", margin, 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      `Período: ${dateLabel(data.start)} a ${dateLabel(data.end)}`,
      margin + width,
      13,
      { align: "right" },
    );
    doc.setDrawColor(72, 87, 102);
    doc.setLineWidth(0.25);
    doc.line(margin, 17, margin + width, 17);
    doc.text(identificationLines, margin, 22, { lineHeightFactor: 1.275 });
    if (noticeLines.length) {
      doc.setFontSize(7);
      doc.setTextColor(58, 70, 82);
      doc.text(noticeLines, margin, 22 + identificationLines.length * 3.6 + 1, {
        lineHeightFactor: 1.1,
      });
    }
  };
  const body = data.rows.map((row) => [
    row.day,
    row.weekday,
    "",
    "",
    "",
    "",
    "",
    "",
    row.observation,
  ]);
  const sourceRows = new Map<unknown, (typeof data.rows)[number]>(
    body.map((row, index) => [row, data.rows[index]]),
  );

  autoTable(doc, {
    startY: tableStart,
    margin: { top: tableStart, left: margin, right: margin, bottom: 40 },
    tableWidth: width,
    theme: "grid",
    rowPageBreak: "avoid",
    showHead: "everyPage",
    head: [
      [
        { content: "Dia", colSpan: 2, rowSpan: 2 },
        { content: "Entrada", rowSpan: 2 },
        { content: "Intervalo", colSpan: 2 },
        { content: "Saída", rowSpan: 2 },
        { content: "Horas extras", colSpan: 2 },
        { content: "Assinatura ou observações", rowSpan: 2 },
      ],
      ["Saída", "Entrada", "Início", "Término"],
    ],
    body,
    styles: {
      font: "helvetica",
      fontSize: 7,
      textColor: [25, 37, 49],
      lineColor: [91, 104, 117],
      lineWidth: 0.15,
      cellPadding: { top: 0.4, bottom: 0.4, left: 0.9, right: 0.9 },
      minCellHeight: 5.8,
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [231, 236, 241],
      textColor: [18, 40, 62],
      fontStyle: "bold",
      halign: "center",
      fontSize: 7,
      minCellHeight: 4.3,
    },
    bodyStyles: { fillColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 9, halign: "center", fontSize: 6.5 },
      2: { cellWidth: 22 },
      3: { cellWidth: 22 },
      4: { cellWidth: 22 },
      5: { cellWidth: 22 },
      6: { cellWidth: 21 },
      7: { cellWidth: 21 },
      8: { cellWidth: 43, fontSize: 6.7 },
    },
    willDrawPage: drawHeader,
    didParseCell: ({ section, row, cell }) => {
      if (section === "body" && sourceRows.get(row.raw)?.shaded) {
        cell.styles.fillColor = [210, 216, 222];
        cell.styles.lineColor = [70, 82, 94];
        cell.styles.lineWidth = 0.2;
      }
    },
    didDrawCell: ({ section, row, cell, column }) => {
      if (
        section === "body" &&
        sourceRows.get(row.raw)?.crossed &&
        column.index >= 2 &&
        column.index <= 7
      ) {
        doc.setDrawColor(55, 67, 79);
        doc.setLineWidth(0.3);
        doc.line(
          cell.x + 1,
          cell.y + cell.height / 2,
          cell.x + cell.width - 1,
          cell.y + cell.height / 2,
        );
      }
    },
  });

  const table = (doc as typeof doc & { lastAutoTable: Table }).lastAutoTable;
  let signatureY = (table.finalY ?? tableStart) + 13;
  if (signatureY + 4 > 285) {
    doc.addPage();
    drawHeader();
    signatureY = tableStart + 18;
  }
  doc.setDrawColor(60, 72, 84);
  doc.setLineWidth(0.2);
  const center = doc.internal.pageSize.getWidth() / 2;
  doc.line(center - 45, signatureY, center + 45, signatureY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(25, 37, 49);
  doc.text("Assinatura do funcionário", center, signatureY + 4, {
    align: "center",
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(7);
    doc.setTextColor(75, 87, 99);
    doc.text("Cont Contábil · Gerador de Jornadas", 10, 291);
    doc.text(`Página ${page}/${pages}`, 200, 291, { align: "right" });
  }
  return doc;
}
