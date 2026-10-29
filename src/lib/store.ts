import { supabase } from "./supabase";
import type {
  Company,
  Employee,
  Establishment,
  Holiday,
  LegalRule,
  Model,
  Schedule,
  ScheduleReview,
  ScheduleStatus,
  SpecialDate,
} from "./types";
import type { CompanyOperation } from "./company-operations";
import type { ScheduleVersion } from "./schedule-governance";
import { initialHolidays, initialModels, initialRules } from "./presets";
import { missingReferenceRules } from "./legal-reference";
export type AuditLog = {
  id: string;
  tabela: string;
  acao: string;
  alterado_em: string;
  registro_id?: string;
  empresa_id?: string | null;
  ator_id?: string | null;
  antes?: Record<string, unknown> | null;
  depois?: Record<string, unknown> | null;
  campos?: string[];
};
export type Data = {
  companies: Company[];
  employees: Employee[];
  models: Model[];
  rules: LegalRule[];
  holidays: Holiday[];
  schedules: Schedule[];
  logs: AuditLog[];
  specialDates?: SpecialDate[];
  establishments?: Establishment[];
  operations?: CompanyOperation[];
  scheduleVersions?: ScheduleVersion[];
  schemaWarnings?: string[];
  /** Present only when a caller explicitly requests a limited period. */
  scheduleWindow?: [from: string, to: string];
};
export const emptyData: Data = {
  companies: [],
  employees: [],
  models: [],
  rules: [],
  holidays: [],
  schedules: [],
  logs: [],
  specialDates: [],
  establishments: [],
  operations: [],
  scheduleVersions: [],
  schemaWarnings: [],
};
type PageResponse<T> = {
  data: T[] | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
};
/** Stable ordering belongs to the query; advance by actual rows, even on a lower API cap. */
export async function readAllPages<T>(
  readPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 1000; page++) {
    const result = await readPage(rows.length, rows.length + pageSize - 1);
    if (result.error)
      throw Object.assign(new Error(result.error.message), {
        code: result.error.code,
      });
    const data = result.data ?? [];
    rows.push(...data);
    if (result.count != null && rows.length >= result.count) return rows;
    if (result.count == null && data.length < pageSize) return rows;
    if (!data.length)
      throw new Error(
        "A consulta foi interrompida antes de carregar todos os registros. Tente atualizar os dados.",
      );
  }
  throw new Error(
    "O volume consultado excede o limite seguro. Selecione uma empresa e competência.",
  );
}
export function scheduleMonthWindow(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Competência inválida.");
  const [year, number] = month.split("-").map(Number);
  const at = (offset: number) => {
    const date = new Date(Date.UTC(year, number - 1 + offset, 1));
    return date.toISOString().slice(0, 10);
  };
  return { from: at(-1), to: at(1) };
}
function migrationError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["42P01", "42703", "42883", "PGRST202", "PGRST205"].includes(
      String(error.code),
    )
  );
}
export async function loadData(
  companyId?: string | null,
  month?: string,
): Promise<Data> {
  if (!supabase) throw new Error("Configure o Supabase.");
  if (
    companyId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      companyId,
    )
  )
    throw new Error("Empresa indisponível ou sem permissão.");
  // Keep the authorized directory for the selector, then restrict resource
  // queries at the API boundary rather than loading another company's records.
  const client = supabase;
  const directory = companyId
    ? await readAllPages<Company>((from, to) =>
        client
          .from("empresas")
          .select("*", { count: "exact" })
          .order("id")
          .range(from, to),
      )
    : null;
  if (companyId && !directory?.some((row) => row.id === companyId))
    throw new Error("Empresa indisponível ou sem permissão.");
  const tables = [
    "empresas",
    "funcionarios",
    "modelos_jornada",
    "parametros_legais",
    "feriados",
    "escalas",
    "log_alteracoes",
    "datas_especiais",
    "estabelecimentos",
  ];
  const window = month ? scheduleMonthWindow(month) : null;
  const responses = await Promise.all(
    tables.map((t) => {
      if (t === "empresas" && directory) return directory;
      if (t === "log_alteracoes") {
        let query = client
          .from(t)
          .select(
            "id,tabela,acao,alterado_em,registro_id,empresa_id,ator_id,antes,depois,campos",
          )
          .order("alterado_em", { ascending: false })
          .order("id", { ascending: false })
          .limit(100);
        if (companyId) query = query.eq("empresa_id", companyId);
        return query.then((response) => {
          if (response.error) throw new Error(response.error.message);
          return response.data;
        });
      }
      return readAllPages((from, to) => {
        let query =
          t === "escalas"
            ? client
                .from(t)
                .select(
                  "*,dias:escala_dias(data,intervalos,folga,feriado,observacao,calendario)",
                  { count: "exact" },
                )
            : client.from(t).select("*", { count: "exact" });
        if (t === "escalas" && window)
          query = query.gte("mes", window.from).lte("mes", window.to);
        if (companyId) {
          if (
            [
              "funcionarios",
              "escalas",
              "log_alteracoes",
              "datas_especiais",
              "estabelecimentos",
            ].includes(t)
          )
            query = query.eq("empresa_id", companyId);
          else if (
            ["modelos_jornada", "parametros_legais", "feriados"].includes(t)
          )
            query = query.or(`empresa_id.eq.${companyId},empresa_id.is.null`);
        }
        return query.order("id").range(from, to);
      });
    }),
  );
  const keys = [
    "companies",
    "employees",
    "models",
    "rules",
    "holidays",
    "schedules",
    "logs",
    "specialDates",
    "establishments",
  ];
  const data = Object.fromEntries(
    keys.map((key, i) => [key, responses[i]]),
  ) as unknown as Data;
  const schemaWarnings: string[] = [];
  try {
    data.operations = await readAllPages<CompanyOperation>((from, to) => {
      let query = client
        .from("registros_operacionais")
        .select("*", { count: "exact" });
      if (companyId) query = query.eq("empresa_id", companyId);
      return query.order("id").range(from, to);
    });
  } catch (error) {
    if (!migrationError(error)) throw error;
    data.operations = [];
    schemaWarnings.push(
      "Atualização do banco pendente: operações e governança exigem a migração mais recente.",
    );
  }
  return {
    ...data,
    scheduleVersions: [],
    schemaWarnings,
    ...(window
      ? { scheduleWindow: [window.from, window.to] as [string, string] }
      : {}),
  };
}
export async function saveRow(table: string, value: object, id?: string) {
  if (!supabase) throw new Error("Supabase não configurado.");
  const q = id
    ? supabase.from(table).update(value).eq("id", id)
    : supabase.from(table).insert(value);
  const { data, error } = await q.select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}
/** The SQL RPC validates both the record and payload against this context. */
export async function saveCompanyRow(
  companyId: string,
  table: string,
  value: object,
  id?: string,
) {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { data, error } = await supabase.rpc("salvar_registro_empresa", {
    p_empresa: companyId,
    p_tabela: table,
    p_valores: value,
    p_id: id ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function deleteCompanyModel(companyId: string, modelId: string) {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { error } = await supabase.rpc("excluir_modelo_empresa", {
    p_empresa: companyId,
    p_modelo: modelId,
  });
  if (error) throw new Error(error.message);
}
export async function deleteCompanySpecialDate(companyId: string, id: string) {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { error } = await supabase.rpc("excluir_data_especial", {
    p_empresa: companyId,
    p_id: id,
  });
  if (error) throw new Error(error.message);
}
export async function saveSchedules(
  schedules: Schedule[],
  companyId?: string | null,
) {
  if (!supabase) throw new Error("Supabase não configurado.");
  // The loaded API result also contains server metadata. Send only the
  // schedule fields the existing persistence RPC consumes.
  const itens = schedules.map((schedule) => ({
    id: schedule.id || null,
    empresa_id: schedule.empresa_id,
    funcionario_id: schedule.funcionario_id,
    modelo_id: schedule.modelo_id,
    mes: schedule.mes,
    nome_funcionario: schedule.nome_funcionario,
    modelo_nome: schedule.modelo_nome,
    modelo_tipo: schedule.modelo_tipo,
    dias: schedule.dias,
    ...(schedule.revisao !== undefined
      ? { revisao_esperada: schedule.revisao }
      : !schedule.id
        ? { revisao_esperada: null }
        : {}),
  }));
  const { error } = companyId
    ? await supabase.rpc("salvar_escalas_empresa", {
        p_empresa: companyId,
        itens,
      })
    : await supabase.rpc("salvar_escalas", { itens });
  if (error) throw new Error(error.message);
}
export async function transitionScheduleStatus(
  companyId: string,
  schedule: Schedule,
  next: ScheduleStatus,
  reason: string,
  review: ScheduleReview,
) {
  if (!supabase) throw new Error("Supabase não configurado.");
  if (schedule.revisao === undefined)
    throw new Error(
      "Atualize os dados e aplique a migração de governança antes de alterar a situação.",
    );
  const { error } = await supabase.rpc("alterar_status_escala", {
    p_empresa: companyId,
    p_escala: schedule.id,
    p_status: next,
    p_revisao: schedule.revisao,
    p_justificativa: reason.trim(),
    p_conferencia: review,
  });
  if (error) {
    if (migrationError(error))
      throw new Error(
        "Atualização do banco pendente: aplique a migração de governança.",
      );
    throw new Error(error.message);
  }
}
export async function loadScheduleVersions(
  companyId: string,
  scheduleId: string,
): Promise<ScheduleVersion[]> {
  if (!supabase) throw new Error("Supabase não configurado.");
  const client = supabase;
  try {
    return await readAllPages<ScheduleVersion>((from, to) =>
      client
        .from("escala_versoes")
        .select(
          "id,escala_id,empresa_id,revisao,versao,publicado_em,publicado_por,justificativa,snapshot",
          { count: "exact" },
        )
        .eq("empresa_id", companyId)
        .eq("escala_id", scheduleId)
        .order("versao", { ascending: false })
        .range(from, to),
    );
  } catch (error) {
    if (migrationError(error))
      throw new Error(
        "Atualização do banco pendente: as versões exigem a migração de governança.",
      );
    throw error;
  }
}
export async function saveCompanyOperation(
  companyId: string,
  operation: CompanyOperation,
) {
  if (!supabase) throw new Error("Supabase não configurado.");
  if (operation.empresa_id !== companyId)
    throw new Error("A operação deve pertencer à empresa ativa.");
  const { data, error } = await supabase.rpc("salvar_operacao_empresa", {
    p_empresa: companyId,
    p_id: operation.id || null,
    p_valores: {
      tipo: operation.tipo,
      status: operation.status,
      titulo: operation.titulo,
      funcionario_id: operation.funcionario_id,
      data_inicio: operation.data_inicio,
      data_fim: operation.data_fim,
      payload: operation.payload,
    },
  });
  if (error) {
    if (migrationError(error))
      throw new Error(
        "Atualização do banco pendente: aplique a migração de operações.",
      );
    throw new Error(error.message);
  }
  return data as string;
}
export async function deleteCompanyOperation(companyId: string, id: string) {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { error } = await supabase.rpc("excluir_operacao_empresa", {
    p_empresa: companyId,
    p_id: id,
  });
  if (error) throw new Error(error.message);
}
export async function applyCompanySwap(
  companyId: string,
  operation: CompanyOperation,
  schedules: Schedule[],
) {
  if (!supabase) throw new Error("Supabase não configurado.");
  if (
    operation.empresa_id !== companyId ||
    operation.tipo !== "troca" ||
    operation.status !== "pendente" ||
    schedules.length !== 2 ||
    schedules.some(
      (entry) => entry.empresa_id !== companyId || entry.revisao === undefined,
    )
  )
    throw new Error(
      "Carregue a solicitação pendente e as duas escalas desta empresa antes de aplicar a troca.",
    );
  const { error } = await supabase.rpc("aplicar_troca_empresa", {
    p_empresa: companyId,
    p_operacao: operation.id,
    p_itens: schedules.map((schedule) => ({
      id: schedule.id,
      empresa_id: schedule.empresa_id,
      funcionario_id: schedule.funcionario_id,
      modelo_id: schedule.modelo_id,
      mes: schedule.mes,
      nome_funcionario: schedule.nome_funcionario,
      modelo_nome: schedule.modelo_nome ?? "",
      modelo_tipo: schedule.modelo_tipo ?? "personalizado",
      dias: schedule.dias,
      revisao_esperada: schedule.revisao,
    })),
  });
  if (error) {
    if (migrationError(error))
      throw new Error(
        "Atualização do banco pendente: aplique a migração de operações para trocar plantões.",
      );
    throw new Error(error.message);
  }
}
export async function importCompanyEmployees(
  companyId: string,
  employees: Employee[],
): Promise<string[]> {
  if (!supabase) throw new Error("Supabase não configurado.");
  if (employees.some((employee) => employee.empresa_id !== companyId))
    throw new Error("Todos os funcionários devem pertencer à empresa ativa.");
  const fields: (keyof Employee)[] = [
    "nome",
    "cpf",
    "cargo",
    "horario_contratual",
    "carga_semanal_minutos",
    "dias_descanso",
    "matricula",
    "setor",
    "admissao",
    "situacao",
    "modelo_padrao_id",
    "carga_diaria_minutos",
    "regras_especiais",
    "estabelecimento_id",
  ];
  const { data, error } = await supabase.rpc("importar_funcionarios_empresa", {
    p_empresa: companyId,
    p_itens: employees.map((employee) =>
      Object.fromEntries(
        fields
          .filter((field) => employee[field] !== undefined)
          .map((field) => [field, employee[field]]),
      ),
    ),
  });
  if (error) {
    if (migrationError(error))
      throw new Error(
        "Atualização do banco pendente: aplique a migração para importar funcionários.",
      );
    throw new Error(error.message);
  }
  return data as string[];
}
export async function importDefaults(data: Data) {
  if (!supabase) throw new Error("Supabase não configurado.");
  const references = missingReferenceRules(
    data.rules.filter((rule) => !rule.empresa_id),
    initialRules,
  );
  for (const rule of references) {
    const { error } = await supabase.from("parametros_legais").insert(rule);
    // A concurrent import may have created this reference. Never overwrite it.
    if (error && error.code !== "23505") throw new Error(error.message);
  }
  if (!data.models.some((model) => !model.empresa_id)) {
    const { error } = await supabase
      .from("modelos_jornada")
      .insert(initialModels);
    if (error) throw new Error(error.message);
  }
}
export async function importHolidays(year: number) {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { data, error } = await supabase
    .from("feriados")
    .select("nome,data,abrangencia")
    .is("empresa_id", null)
    .gte("data", `${year}-01-01`)
    .lte("data", `${year}-12-31`);
  if (error) throw new Error(error.message);
  for (const h of initialHolidays(year)) {
    if (
      data.some(
        (entry) =>
          entry.nome === h.nome &&
          entry.data === h.data &&
          entry.abrangencia === h.abrangencia,
      )
    )
      continue;
    const { error: insertError } = await supabase.from("feriados").insert(h);
    // Partial indexes separate global/company calendars. A concurrent import
    // may insert the same global date; preserve it instead of overwriting it.
    if (insertError && insertError.code !== "23505")
      throw new Error(insertError.message);
  }
}

/** Page inside the authorized company; avoids dropping a quiet company's history. */
export async function loadCompanyLogs(
  companyId: string,
  offset = 0,
): Promise<AuditLog[]> {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { data, error } = await supabase
    .from("log_alteracoes")
    .select(
      "id,tabela,acao,alterado_em,registro_id,empresa_id,ator_id,antes,depois,campos",
    )
    .eq("empresa_id", companyId)
    .order("alterado_em", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + 99);
  if (error) throw new Error(error.message);
  return data as AuditLog[];
}
