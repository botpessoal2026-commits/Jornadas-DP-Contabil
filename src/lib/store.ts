import { supabase } from "./supabase";
import type {
  Company,
  Employee,
  Establishment,
  Holiday,
  LegalRule,
  Model,
  Schedule,
  SpecialDate,
} from "./types";
import { initialHolidays, initialModels, initialRules } from "./presets";
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
};
export async function loadData(companyId?: string | null): Promise<Data> {
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
  const directory = companyId
    ? await supabase.from("empresas").select("*")
    : null;
  if (directory?.error) throw new Error(directory.error.message);
  if (companyId && !directory?.data?.some((row) => row.id === companyId))
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
  const responses = await Promise.all(
    tables.map((t) => {
      if (t === "empresas" && directory) return directory;
      let query =
        t === "escalas"
          ? supabase!
              .from(t)
              .select(
                "*,dias:escala_dias(data,intervalos,folga,feriado,observacao,calendario)",
              )
          : t === "log_alteracoes"
            ? supabase!
                .from(t)
                .select(
                  "id,tabela,acao,alterado_em,registro_id,empresa_id,ator_id,antes,depois,campos",
                )
                .order("alterado_em", { ascending: false })
                .limit(100)
            : supabase!.from(t).select("*");
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
      return query;
    }),
  );
  for (const r of responses) if (r.error) throw new Error(r.error.message);
  return Object.fromEntries(
    Object.keys(emptyData).map((k, i) => [k, responses[i].data]),
  ) as Data;
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
  }));
  const { error } = companyId
    ? await supabase.rpc("salvar_escalas_empresa", {
        p_empresa: companyId,
        itens,
      })
    : await supabase.rpc("salvar_escalas", { itens });
  if (error) throw new Error(error.message);
}
export async function importDefaults(data: Data) {
  if (!supabase) throw new Error("Supabase não configurado.");
  if (!data.rules.some((rule) => !rule.empresa_id)) {
    const { error } = await supabase
      .from("parametros_legais")
      .insert(initialRules);
    if (error) throw new Error(error.message);
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
