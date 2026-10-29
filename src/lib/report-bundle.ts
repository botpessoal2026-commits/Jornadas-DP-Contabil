import type { Data } from "./store";
import type { Company, Employee, LegalRule, Schedule } from "./types";
import { addDays, span } from "./engine";
import { rulesForCompany } from "./company-resources";
import { csvText, exportRows, pdfDocument, reportFilename } from "./exports";
import { employeeLocation } from "./special-dates";
import { resolvePublishedContext } from "./published-context";

export type ReportEntry = {
  schedule: Schedule;
  company: Company;
  employee: Employee;
  rules: LegalRule[];
};

/** References are always resolved against the authorized, loaded directory. */
export function reportEntries(
  data: Data,
  schedules: Schedule[],
): ReportEntry[] {
  if (!schedules.length) throw new Error("Selecione ao menos uma escala.");
  if (schedules.length > 200)
    throw new Error("Gere no máximo 200 escalas por lote.");
  const seen = new Set<string>();
  return schedules.map((schedule) => {
    const key = `${schedule.empresa_id}/${schedule.funcionario_id}/${schedule.mes.slice(0, 7)}`;
    if (seen.has(key)) throw new Error("Há uma escala repetida na seleção.");
    seen.add(key);
    const company = data.companies.find(
      (item) => item.id === schedule.empresa_id,
    );
    const employee = data.employees.find(
      (item) =>
        item.id === schedule.funcionario_id &&
        item.empresa_id === schedule.empresa_id,
    );
    if (!company || !employee)
      throw new Error(
        "A escala não corresponde a uma empresa e funcionário disponíveis.",
      );
    if (!/^\d{4}-(0[1-9]|1[0-2])(?:-01)?$/.test(schedule.mes))
      throw new Error("A competência da escala é inválida.");
    return {
      schedule,
      company: employeeLocation(company, employee, data.establishments ?? []),
      employee,
      rules: rulesForCompany(data.rules, company.id),
    };
  });
}

/** Resolve every publication separately: equal company IDs can have different historical names/rules. */
export async function resolvedReportEntries(
  data: Data,
  schedules: Schedule[],
): Promise<ReportEntry[]> {
  reportEntries(data, schedules);
  return Promise.all(
    schedules.map((schedule) => resolvePublishedContext(data, schedule)),
  );
}

export const reportColumnNames = [
  "Data",
  "Empresa",
  "Funcionário",
  "Horário",
  "Carga contratual semanal",
  "Feriado",
  "Horas relógio",
  "Horas computadas",
  "Observação",
  "Tipo do dia",
  "Evento",
  "Situação do expediente",
  "Horas programadas",
  "Horas programadas em feriados",
  "Situação da escala",
  "Revisão da escala",
];
const requiredColumns = ["Data", "Empresa", "Funcionário", "Horário"];
export function consolidatedRows(entries: ReportEntry[], columns?: string[]) {
  const rows = entries.flatMap(({ schedule, company, employee, rules }) =>
    exportRows(schedule, rules, employee, company),
  );
  if (!columns) return rows;
  const keys = reportColumnNames.filter(
    (key) => requiredColumns.includes(key) || columns.includes(key),
  );
  return rows.map((row) =>
    Object.fromEntries(
      keys.map((key) => [key, row[key as keyof typeof row] ?? ""]),
    ),
  );
}

export function consolidatedCSV(entries: ReportEntry[], columns?: string[]) {
  return csvText(consolidatedRows(entries, columns));
}

export async function consolidatedExcel(
  entries: ReportEntry[],
  columns?: string[],
) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "Cont Contábil · Gerador de Jornadas";
  const sheet = book.addWorksheet("Escalas selecionadas");
  const rows = consolidatedRows(entries, columns);
  const headers = Object.keys(rows[0] ?? {});
  sheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: header === "Horário" || header === "Evento" ? 45 : 25,
  }));
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Math.max(1, headers.length) },
  };
  const cover = book.addWorksheet("Identificação do lote");
  cover.addRow([
    "Cont Contábil",
    "Planejamento; não contém marcações de ponto reais.",
  ]);
  cover.addRow(["Empresa", "Funcionário", "Competência"]);
  entries.forEach(({ company, employee, schedule }) =>
    cover.addRow([company.nome, employee.nome, schedule.mes.slice(0, 7)]),
  );
  cover.columns.forEach((column) => {
    column.width = 40;
  });
  return new Uint8Array(await book.xlsx.writeBuffer());
}

const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

/** Standard ZIP (STORE), no dependency, path traversal or silent duplicate names. */
export function zipFiles(files: { name: string; bytes: Uint8Array }[]) {
  if (!files.length || files.length > 200)
    throw new Error("Selecione entre 1 e 200 arquivos.");
  if (
    files.reduce((sum, file) => sum + file.bytes.byteLength, 0) >
    100 * 1024 * 1024
  )
    throw new Error("O lote excede 100 MB. Divida a seleção.");
  const used = new Set<string>();
  const local: Uint8Array[] = [],
    directory: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    if (
      !file.name ||
      /[\x00-\x1f\\/]/.test(file.name) ||
      file.name === "." ||
      file.name === ".."
    )
      throw new Error("Nome de arquivo inválido.");
    let name = file.name;
    for (let index = 2; used.has(name); index++)
      name = file.name.replace(/(\.[^.]+)?$/, `-${index}$1`);
    used.add(name);
    const filename = encoder.encode(name);
    if (filename.length > 4096) throw new Error("Nome de arquivo muito longo.");
    const crc = crc32(file.bytes);
    const record = new Uint8Array(30 + filename.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(12, 33, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.bytes.length, true);
    view.setUint32(22, file.bytes.length, true);
    view.setUint16(26, filename.length, true);
    record.set(filename, 30);
    local.push(record, file.bytes);
    const central = new Uint8Array(46 + filename.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(14, 33, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.bytes.length, true);
    centralView.setUint32(24, file.bytes.length, true);
    centralView.setUint16(28, filename.length, true);
    centralView.setUint32(42, offset, true);
    central.set(filename, 46);
    directory.push(central);
    offset += record.length + file.bytes.length;
  }
  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  const output = new Uint8Array(offset + directorySize + end.length);
  let cursor = 0;
  for (const part of [...local, ...directory, end]) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

export async function pdfZip(
  entries: ReportEntry[],
  kind: "escala" | "folha",
  compact = true,
) {
  const files: { name: string; bytes: Uint8Array }[] = [];
  for (const { schedule, company, employee, rules } of entries) {
    const doc =
      kind === "folha"
        ? await (
            await import("./timesheet-pdf")
          ).timesheetDocument(schedule, company, employee)
        : await pdfDocument(schedule, rules, company, employee, { compact });
    files.push({
      name: reportFilename(
        kind === "folha"
          ? "folha-de-ponto"
          : compact
            ? "escala-compacta"
            : "escala",
        schedule,
        "pdf",
        company,
        employee,
      ),
      bytes: new Uint8Array(doc.output("arraybuffer")),
    });
  }
  return zipFiles(files);
}

const icsEscape = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
function foldLine(line: string) {
  const lines: string[] = [];
  let current = "",
    size = 0;
  for (const character of line) {
    const count = encoder.encode(character).length;
    if (size + count > 73) {
      lines.push(current);
      current = " " + character;
      size = count + 1;
    } else {
      current += character;
      size += count;
    }
  }
  lines.push(current);
  return lines.join("\r\n");
}

/** Floating local times: the imported calendar must use the employee's locality. */
export function scheduleICS(entries: ReportEntry[], now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const dateTime = (date: string, minute: number) =>
    `${addDays(date, Math.floor(minute / 1440)).replaceAll("-", "")}T${String(Math.floor((minute % 1440) / 60)).padStart(2, "0")}${String(minute % 60).padStart(2, "0")}00`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cont Contabil//Gerador de Jornadas//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Escalas programadas Cont Contábil",
  ];
  for (const { schedule, company, employee } of entries) {
    for (const day of schedule.dias.filter((item) =>
      item.data.startsWith(schedule.mes.slice(0, 7)),
    )) {
      day.intervalos.forEach((shift, index) => {
        const [start, end] = span(shift);
        lines.push(
          "BEGIN:VEVENT",
          `UID:${icsEscape(`${schedule.funcionario_id}-${day.data}-${index}`)}@cont-contabil`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${dateTime(day.data, start)}`,
          `DTEND:${dateTime(day.data, end)}`,
          `SUMMARY:${icsEscape(`${employee.nome} · ${company.nome}`)}`,
          `DESCRIPTION:${icsEscape(`Jornada programada. Não é marcação real de ponto.${day.observacao ? ` ${day.observacao}` : ""}`)}`,
          "END:VEVENT",
        );
      });
    }
  }
  return [...lines, "END:VCALENDAR"].map(foldLine).join("\r\n") + "\r\n";
}
