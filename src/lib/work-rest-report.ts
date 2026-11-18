import type { Data } from "./store";
import type { Company, Employee } from "./types";
import type { ReportEntry } from "./report-bundle";
import { resolvedReportEntries } from "./report-bundle";
import { computeDay, formatMinutes, minutes, monthDates } from "./engine";
import { dayPresentation, projectData } from "./special-dates";
import { csvText } from "./exports";
import { scheduleStatusLabels } from "./schedule-governance";

export type WorkRestDay = {
  date: string;
  state: "work" | "rest" | "other" | "missing" | "invalid";
  label: string;
  shift: string;
  minutes: number;
  starts: boolean;
  description: string;
};
export type WorkRestRow = {
  companyId: string;
  employeeId: string;
  company: string;
  employee: string;
  month: string;
  status: string;
  revision: string;
  model: string;
  days: WorkRestDay[];
};

export const workRestReportNote =
  "Planejamento das escalas salvas; não comprova frequência. Dias com trabalho incluem a continuação noturna por data civil. Plantões contam os inícios registrados. Confira a CCT e os parâmetros legais aplicáveis.";

export function workRestCandidates(
  data: Data,
  companyId: string | null,
  employeeIds?: string[],
): { company: Company; employee: Employee }[] {
  const companies = new Map(
    data.companies
      .filter((company) => !companyId || company.id === companyId)
      .map((company) => [company.id, company]),
  );
  if (companyId && !companies.has(companyId))
    throw new Error("Empresa indisponível para o relatório.");
  const selected = employeeIds ? new Set(employeeIds) : null;
  const candidates = data.employees
    .filter(
      (employee) =>
        companies.has(employee.empresa_id) &&
        (!selected || selected.has(employee.id)),
    )
    .map((employee) => ({
      company: companies.get(employee.empresa_id)!,
      employee,
    }));
  if (selected && candidates.length !== selected.size)
    throw new Error("A seleção contém um funcionário fora deste contexto.");
  return candidates.sort(
    (a, b) =>
      a.company.nome.localeCompare(b.company.nome, "pt-BR") ||
      a.employee.nome.localeCompare(b.employee.nome, "pt-BR"),
  );
}

/** Missing days are never counted as rest. Night work follows the team's civil dates. */
export function workRestRows(
  month: string,
  candidates: ReturnType<typeof workRestCandidates>,
  entries: ReportEntry[],
): WorkRestRow[] {
  if (!/^(19\d\d|20\d\d|21\d\d|2200)-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Selecione uma competência válida para o relatório.");
  const dates = monthDates(month);
  return candidates.map(({ company, employee }) => {
    const entry = entries.find(
      (item) =>
        item.schedule.empresa_id === company.id &&
        item.schedule.funcionario_id === employee.id &&
        item.schedule.mes.slice(0, 7) === month,
    );
    const seen = new Set<string>();
    for (const day of entry?.schedule.dias ?? []) {
      if (seen.has(day.data))
        throw new Error(
          "A escala contém datas duplicadas. Confira os dias antes de emitir o relatório.",
        );
      seen.add(day.data);
    }
    const days = dates.map((date): WorkRestDay => {
      const day = entry?.schedule.dias.find((item) => item.data === date);
      const base = {
        date,
        shift: "",
        minutes: 0,
        starts: false,
        description: "",
      };
      if (!entry || !day)
        return { ...base, state: "missing", label: "Sem escala" };
      try {
        const hours = computeDay(day, entry.rules, entry.schedule.dias);
        const nature = dayPresentation(day, entry.schedule.dias);
        const rest =
          nature.kind === "folga" ||
          (day.calendario?.base.folga && !day.calendario.excecao);
        return {
          ...base,
          state: hours.worked > 0 ? "work" : rest ? "rest" : "other",
          label:
            hours.worked > 0 ? nature.label : rest ? "Folga" : nature.label,
          shift:
            day.intervalos
              .map(
                (shift) =>
                  `${shift.start}${shift.startDay ? " (+1)" : ""}–${shift.end}${shift.endDay || shift.end < shift.start ? " (+1)" : ""}`,
              )
              .join(" / ") ||
            (hours.worked > 0 ? "Continuação do turno anterior" : "—"),
          minutes: hours.worked,
          starts: minutes(day.intervalos) > 0,
          description: [nature.description, day.observacao]
            .filter(Boolean)
            .join(" · "),
        };
      } catch {
        return { ...base, state: "invalid", label: "Horários a conferir" };
      }
    });
    return {
      companyId: company.id,
      employeeId: employee.id,
      company: entry?.company.nome ?? company.nome,
      employee: entry?.employee.nome ?? employee.nome,
      month,
      status: entry
        ? scheduleStatusLabels[entry.schedule.status ?? "rascunho"]
        : "Sem escala",
      revision:
        entry?.schedule.revisao === undefined
          ? "—"
          : String(entry.schedule.revisao),
      model: entry?.schedule.modelo_nome ?? "—",
      days,
    };
  });
}

export async function buildWorkRestReport(
  data: Data,
  month: string,
  companyId: string | null,
  employeeIds?: string[],
) {
  const candidates = workRestCandidates(data, companyId, employeeIds);
  if (!candidates.length) throw new Error("Selecione ao menos um funcionário.");
  if (candidates.length > 200)
    throw new Error("Selecione até 200 funcionários por relatório.");
  const schedules = projectData(data).schedules.filter(
    (schedule) =>
      schedule.mes.slice(0, 7) === month &&
      candidates.some(
        ({ company, employee }) =>
          company.id === schedule.empresa_id &&
          employee.id === schedule.funcionario_id,
      ),
  );
  const entries = schedules.length
    ? await resolvedReportEntries(data, schedules)
    : [];
  return workRestRows(month, candidates, entries);
}

export const workRestDate = (date: string) =>
  date.split("-").reverse().join("/");
export function workRestTotals(row: WorkRestRow) {
  const dates = (state: WorkRestDay["state"]) =>
    row.days.filter((day) => day.state === state).map((day) => day.date);
  return {
    work: dates("work"),
    rest: dates("rest"),
    other: dates("other"),
    missing: dates("missing"),
    invalid: dates("invalid"),
    starts: row.days.filter((day) => day.starts).length,
    hours: row.days.some((day) => day.state === "invalid")
      ? "Incompleto"
      : formatMinutes(row.days.reduce((total, day) => total + day.minutes, 0)),
  };
}
export function workRestSummary(row: WorkRestRow) {
  const totals = workRestTotals(row);
  const list = (dates: string[]) => dates.map(workRestDate).join(", ");
  return {
    Empresa: row.company,
    Funcionário: row.employee,
    Competência: row.month,
    "Situação da escala": row.status,
    Revisão: row.revision,
    Modelo: row.model,
    "Dias com trabalho": String(totals.work.length),
    "Folgas programadas": String(totals.rest.length),
    "Outros dias sem expediente": String(totals.other.length),
    "Dias sem escala": String(totals.missing.length),
    "Dias a conferir": String(totals.invalid.length),
    "Inícios de jornada/plantão": String(totals.starts),
    "Horas de relógio": totals.hours,
    "Datas com trabalho": list(totals.work),
    "Datas de folga": list(totals.rest),
    "Datas de outros dias sem expediente": list(totals.other),
    "Datas sem escala": list(totals.missing),
    "Datas a conferir": list(totals.invalid),
  };
}
export function workRestDetails(rows: WorkRestRow[]) {
  return rows.flatMap((row) =>
    row.days.map((day) => ({
      Empresa: row.company,
      Funcionário: row.employee,
      Competência: row.month,
      "Situação da escala": row.status,
      Revisão: row.revision,
      Data: workRestDate(day.date),
      "Tipo do dia": day.label,
      Horário: day.shift,
      "Horas de relógio":
        day.state === "invalid" || day.state === "missing"
          ? "—"
          : formatMinutes(day.minutes),
      "Início de jornada/plantão": day.starts ? "Sim" : "Não",
      Observação: day.description,
    })),
  );
}
export const workRestCSV = (rows: WorkRestRow[]) =>
  csvText(rows.map(workRestSummary));
export async function workRestExcel(rows: WorkRestRow[]) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "Cont Contábil · Gerador de Jornadas";
  for (const [name, values] of [
    ["Resumo", rows.map(workRestSummary)],
    ["Dias e horários", workRestDetails(rows)],
  ] as const) {
    const sheet = book.addWorksheet(name);
    sheet.columns = Object.keys(values[0] ?? {}).map((key) => ({
      header: key,
      key,
      width: key.startsWith("Datas") ? 65 : 26,
    }));
    sheet.addRows(values);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columnCount },
    };
  }
  book.addWorksheet("Orientações").addRow([workRestReportNote]);
  return new Uint8Array(await book.xlsx.writeBuffer());
}
export async function workRestPDF(rows: WorkRestRow[]) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF();
  rows.forEach((row, index) => {
    if (index) doc.addPage();
    const totals = workRestTotals(row);
    doc.setFontSize(14);
    doc.text("Dias trabalhados e folgas", 14, 16);
    doc.setFontSize(10);
    const header = doc.splitTextToSize(
      `${row.company} · ${row.employee}\nCompetência: ${row.month} · ${row.status} · Revisão: ${row.revision}\n${totals.work.length} dias com trabalho · ${totals.rest.length} folgas · ${totals.starts} inícios de plantão\n${totals.other.length} outros sem expediente · ${totals.missing.length} sem escala · ${totals.invalid.length} a conferir · Horas: ${totals.hours}`,
      180,
    );
    doc.text(header, 14, 23);
    autoTable(doc, {
      startY: 25 + header.length * 4.3,
      head: [
        ["Data", "Tipo do dia", "Horário", "Horas", "Evento / observação"],
      ],
      body: workRestDetails([row]).map((day) => [
        day.Data,
        day["Tipo do dia"],
        day.Horário,
        day["Horas de relógio"],
        day.Observação,
      ]),
      styles: { fontSize: 8, overflow: "linebreak", cellPadding: 1.8 },
      headStyles: { fillColor: [15, 55, 102] },
      margin: { top: 16, bottom: 23 },
      didDrawPage: () => {
        doc.setFontSize(7);
        doc.text(doc.splitTextToSize(workRestReportNote, 180), 14, 280);
      },
    });
  });
  return doc.output("blob");
}
