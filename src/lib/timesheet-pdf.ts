import type { Table } from "jspdf-autotable";
import type { Company, Employee, Schedule } from "./types";
import { buildTimesheet, type TimesheetOptions } from "./timesheet";

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
    `Cargo: ${employee.cargo || "Não informado"}${employee.setor ? ` | Setor: ${employee.setor}` : ""}`,
    `Admissão: ${employee.admissao ? dateLabel(employee.admissao) : "Não informada"} | Base: ${data.preview ? "prévia não salva" : "escala do calendário"}`,
  ];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const identificationLines = identification.flatMap(
    (line) => doc.splitTextToSize(line, width) as string[],
  );
  const notice =
    "Horário previsto é referência. Preencha as marcações efetivamente realizadas nos campos em branco." +
    (data.rows.some((row) => row.planned.length > 2)
      ? " Registre períodos adicionais nas observações; eles não são classificados automaticamente como extras."
      : "");
  doc.setFontSize(7);
  const noticeLines = doc.splitTextToSize(notice, width) as string[];
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
    doc.setFontSize(7);
    doc.setTextColor(58, 70, 82);
    doc.text(noticeLines, margin, 22 + identificationLines.length * 3.6 + 1, {
      lineHeightFactor: 1.1,
    });
  };
  const body = data.rows.map((row) => [
    row.day,
    row.weekday,
    row.planned.join("\n"),
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
        { content: "Horário previsto", rowSpan: 2 },
        { content: "Entrada", rowSpan: 2 },
        { content: "Intervalo", colSpan: 2 },
        { content: "Saída", rowSpan: 2 },
        { content: "Extra", colSpan: 2 },
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
      2: { cellWidth: 36, fontSize: 7 },
      3: { cellWidth: 17 },
      4: { cellWidth: 17 },
      5: { cellWidth: 17 },
      6: { cellWidth: 17 },
      7: { cellWidth: 15 },
      8: { cellWidth: 15 },
      9: { cellWidth: 39, fontSize: 6.7 },
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
        column.index >= 3 &&
        column.index <= 8
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
  if (signatureY + 16 > 285) {
    doc.addPage();
    drawHeader();
    signatureY = tableStart + 18;
  }
  doc.setDrawColor(60, 72, 84);
  doc.setLineWidth(0.2);
  doc.line(20, signatureY, 94, signatureY);
  doc.line(116, signatureY, 190, signatureY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(25, 37, 49);
  doc.text("Assinatura do funcionário", 57, signatureY + 4, {
    align: "center",
  });
  doc.text("Responsável pela empresa", 153, signatureY + 4, {
    align: "center",
  });
  doc.setFontSize(6.8);
  doc.text(
    doc.splitTextToSize(
      "Linhas escuras e riscadas: folga ou feriado sem trabalho previsto. Feriado com trabalho: destaque e marcações disponíveis.",
      width,
    ),
    10,
    signatureY + 11,
  );
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
