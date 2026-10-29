import type { Company, Employee, Establishment, Model } from "./types";
import { contractMinutesFromHours } from "./contract";
import { normalizeCpf } from "./cpf";

export const employeeImportFields = {
  nome: "Nome",
  cpf: "CPF",
  matricula: "Matrícula",
  cargo: "Cargo",
  setor: "Setor",
  admissao: "Admissão",
  carga_diaria: "Carga diária",
  carga_semanal: "Carga semanal",
  estabelecimento: "Estabelecimento",
  modelo: "Modelo individual",
  descanso: "Descansos (0=domingo, 6=sábado)",
  horario: "Horário / observações",
  situacao: "Situação",
} as const;
export type EmployeeImportField = keyof typeof employeeImportFields;
export type EmployeeImportMapping = Partial<
  Record<EmployeeImportField, number>
>;
export type EmployeeImportIssue = {
  row: number;
  field: string;
  message: string;
};
export type EmployeeImportPreview = {
  employees: Employee[];
  issues: EmployeeImportIssue[];
  total: number;
};
const normal = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const aliases: Record<EmployeeImportField, string[]> = {
  nome: ["nome", "funcionario", "nome do funcionario", "colaborador"],
  cpf: ["cpf", "cpf do funcionario"],
  matricula: ["matricula", "identificador", "codigo"],
  cargo: ["cargo", "funcao"],
  setor: ["setor", "departamento"],
  admissao: ["admissao", "data de admissao"],
  carga_diaria: ["carga diaria", "carga diaria contratual"],
  carga_semanal: ["carga semanal", "carga semanal contratual"],
  estabelecimento: ["estabelecimento", "unidade", "filial"],
  modelo: ["modelo", "modelo individual", "jornada"],
  descanso: ["descansos", "dias descanso", "dias de descanso"],
  horario: ["horario", "observacoes", "horario contratual"],
  situacao: ["situacao", "status"],
};
export function guessEmployeeImportMapping(
  headers: string[],
): EmployeeImportMapping {
  return Object.fromEntries(
    Object.entries(aliases).flatMap(([key, names]) => {
      const index = headers.findIndex((header) =>
        names.includes(normal(header)),
      );
      return index < 0 ? [] : [[key, index]];
    }),
  );
}

/** RFC-style quoting, including escaped quotes and newlines, without evaluation. */
export function parseEmployeeCSV(source: string): string[][] {
  const input = source.replace(/^\uFEFF/, "");
  if (input.length > 5 * 1024 * 1024) throw new Error("Arquivo excede 5 MB.");
  let headerQuoted = false,
    semicolons = 0,
    commas = 0;
  for (let i = 0; i < input.length; i++) {
    const character = input[i];
    if (character === '"') {
      if (headerQuoted && input[i + 1] === '"') i++;
      else headerQuoted = !headerQuoted;
    } else if (!headerQuoted) {
      if (character === "\r" || character === "\n") break;
      if (character === ";") semicolons++;
      if (character === ",") commas++;
    }
  }
  const separator = semicolons >= commas ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    afterQuote = false;
  const pushCell = () => {
    row.push(cell);
    cell = "";
    afterQuote = false;
    if (row.length > 100) throw new Error("A planilha excede 100 colunas.");
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
    if (rows.length > 1001)
      throw new Error("Importe até 1.000 funcionários por arquivo.");
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
        afterQuote = true;
      } else cell += ch;
    } else if (ch === '"' && cell === "" && !afterQuote) quoted = true;
    else if (ch === separator) pushCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      pushRow();
    } else if (afterQuote && ch.trim())
      throw new Error("CSV inválido após aspas de fechamento.");
    else cell += ch;
  }
  if (quoted) throw new Error("CSV contém aspas sem fechamento.");
  if (cell || row.length) pushRow();
  if (rows.length < 2)
    throw new Error("Inclua cabeçalho e ao menos um funcionário.");
  return rows;
}

export async function readEmployeeWorkbook(
  bytes: ArrayBuffer,
): Promise<string[][]> {
  if (bytes.byteLength > 5 * 1024 * 1024)
    throw new Error("Arquivo excede 5 MB.");
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.worksheets[0];
  if (!sheet) throw new Error("A planilha não contém uma aba.");
  if (sheet.rowCount > 1001 || sheet.columnCount > 100)
    throw new Error(
      "Importe até 1.000 funcionários e 100 colunas por arquivo.",
    );
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    for (let index = 1; index <= sheet.columnCount; index++) {
      const cell = row.getCell(index);
      if (cell.type === ExcelJS.ValueType.Formula)
        throw new Error(
          `Remova a fórmula da célula ${cell.address}; importe valores.`,
        );
      cells.push(
        cell.value instanceof Date
          ? cell.value.toISOString().slice(0, 10)
          : cell.text,
      );
    }
    if (cells.some((value) => value.trim())) rows.push(cells);
  });
  if (rows.length < 2)
    throw new Error("Inclua cabeçalho e ao menos um funcionário.");
  return rows;
}

export function validImportCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const length of [9, 10]) {
    const sum = cpf
      .slice(0, length)
      .split("")
      .reduce((total, digit, i) => total + Number(digit) * (length + 1 - i), 0);
    const check = (sum * 10) % 11;
    if ((check === 10 ? 0 : check) !== Number(cpf[length])) return false;
  }
  return true;
}
function admission(value: string): string | null {
  if (!value) return null;
  const masked = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const iso = masked ? `${masked[3]}-${masked[2]}-${masked[1]}` : value;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
    !Number.isFinite(+new Date(`${iso}T00:00:00Z`)) ||
    new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso
  )
    throw new Error("Use data válida em dd/mm/aaaa ou aaaa-mm-dd.");
  return iso;
}
export function previewEmployeeImport({
  rows,
  mapping,
  company,
  existing,
  establishments = [],
  models = [],
  makeId = () => crypto.randomUUID(),
}: {
  rows: string[][];
  mapping: EmployeeImportMapping;
  company: Company;
  existing: Employee[];
  establishments?: Establishment[];
  models?: Model[];
  makeId?: () => string;
}): EmployeeImportPreview {
  if ((company.situacao ?? "ativa") !== "ativa")
    throw new Error("A empresa deve estar ativa para importar funcionários.");
  if (mapping.nome === undefined) throw new Error("Mapeie a coluna Nome.");
  const mapped = Object.values(mapping);
  if (
    mapped.some(
      (index) =>
        !Number.isInteger(index) ||
        index < 0 ||
        index >= (rows[0]?.length ?? 0),
    ) ||
    new Set(mapped).size !== mapped.length
  )
    throw new Error("Cada campo deve usar uma coluna diferente do arquivo.");
  if (rows.length < 2 || rows.length > 1001)
    throw new Error("Inclua entre 1 e 1.000 funcionários.");
  const issues: EmployeeImportIssue[] = [],
    employees: Employee[] = [];
  const own = existing.filter((employee) => employee.empresa_id === company.id);
  const cpfs = new Set(
    own.map((employee) => employee.cpf?.replace(/\D/g, "")).filter(Boolean),
  );
  const registrations = new Set(
    own.map((employee) => normal(employee.matricula ?? "")).filter(Boolean),
  );
  rows.slice(1).forEach((source, i) => {
    const row = i + 2;
    const get = (field: EmployeeImportField) =>
      source[mapping[field] ?? -1]?.trim() ?? "";
    const problems: EmployeeImportIssue[] = [];
    const issue = (field: string, message: string) =>
      problems.push({ row, field, message });
    const name = get("nome"),
      registration = get("matricula");
    if (!name || name.length > 160)
      issue("Nome", "Informe nome com até 160 caracteres.");
    for (const [field, max] of [
      ["matricula", 64],
      ["cargo", 120],
      ["setor", 100],
      ["horario", 1000],
    ] as const)
      if (get(field).length > max)
        issue(employeeImportFields[field], `Use até ${max} caracteres.`);
    let cpf: string | null = null,
      admitted: string | null = null;
    try {
      cpf = normalizeCpf(get("cpf"));
      if (cpf && !validImportCpf(cpf))
        issue(
          "CPF",
          "Dígitos verificadores inválidos; revise o cadastro de origem.",
        );
    } catch (error) {
      issue("CPF", (error as Error).message);
    }
    if (cpf && cpfs.has(cpf))
      issue(
        "CPF",
        "Já existe neste arquivo ou nesta empresa. A importação não sobrescreve cadastros.",
      );
    if (registration && registrations.has(normal(registration)))
      issue("Matrícula", "Já existe neste arquivo ou nesta empresa.");
    if (cpf) cpfs.add(cpf);
    if (registration) registrations.add(normal(registration));
    try {
      admitted = admission(get("admissao"));
    } catch (error) {
      issue("Admissão", (error as Error).message);
    }
    const duration = (field: "carga_diaria" | "carga_semanal", max: number) => {
      try {
        const value = contractMinutesFromHours(get(field));
        if (value !== null && value > max)
          throw new Error(`Carga máxima: ${max / 60} horas.`);
        return value;
      } catch (error) {
        issue(employeeImportFields[field], (error as Error).message);
        return null;
      }
    };
    const daily = duration("carga_diaria", 1440),
      weekly = duration("carga_semanal", 10080);
    const resolve = <
      T extends { id: string; nome: string; empresa_id?: string | null },
    >(
      field: "estabelecimento" | "modelo",
      values: T[],
    ) => {
      const raw = get(field);
      if (!raw) return null;
      const candidates = values.filter(
        (item) =>
          item.empresa_id === company.id &&
          (item.id === raw || normal(item.nome) === normal(raw)),
      );
      if (candidates.length !== 1)
        issue(
          employeeImportFields[field],
          "Informe ID ou nome único de um cadastro desta empresa.",
        );
      return candidates.length === 1 ? candidates[0].id : null;
    };
    const unit = resolve(
      "estabelecimento",
      establishments.filter((item) => item.ativo),
    );
    const model = resolve("modelo", models);
    if (
      model &&
      models.some((item) => item.id === model && item.tipo === "6x1") &&
      !company.permite_6x1
    )
      issue(
        "Modelo individual",
        "A empresa não autoriza o modelo 6x1 selecionado.",
      );
    let rests: number[] = [];
    if (get("descanso")) {
      const tokens = get("descanso").split(/[|,;\s]+/);
      if (tokens.some((token) => !/^[0-6]$/.test(token)))
        issue("Descansos", "Use números de 0 a 6 separados por vírgula ou |.");
      else rests = [...new Set(tokens.map(Number))].sort();
    }
    const status = normal(get("situacao") || "ativo");
    if (!["ativo", "inativo"].includes(status))
      issue("Situação", "Use ativo ou inativo.");
    if (problems.length) issues.push(...problems);
    else
      employees.push({
        id: makeId(),
        empresa_id: company.id,
        nome: name,
        cpf,
        matricula: registration,
        cargo: get("cargo"),
        setor: get("setor"),
        admissao: admitted,
        carga_diaria_minutos: daily,
        carga_semanal_minutos: weekly,
        estabelecimento_id: unit,
        modelo_padrao_id: model,
        dias_descanso: rests,
        horario_contratual: get("horario"),
        situacao: status as "ativo" | "inativo",
      });
  });
  return { employees, issues, total: rows.length - 1 };
}

export function employeeImportTemplate(): string {
  return "\uFEFFnome;cpf;matricula;cargo;setor;admissao;carga diaria;carga semanal;estabelecimento;modelo;descansos;horario;situacao\r\n";
}
