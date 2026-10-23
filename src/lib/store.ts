import { supabase } from "./supabase";
import type {
  Company,
  Employee,
  Holiday,
  LegalRule,
  Model,
  Schedule,
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
};
export const emptyData: Data = {
  companies: [],
  employees: [],
  models: [],
  rules: [],
  holidays: [],
  schedules: [],
  logs: [],
};
export async function loadData(): Promise<Data> {
  if (!supabase) throw new Error("Configure o Supabase.");
  const tables = [
    "empresas",
    "funcionarios",
    "modelos_jornada",
    "parametros_legais",
    "feriados",
    "escalas",
    "log_alteracoes",
  ];
  const responses = await Promise.all(
    tables.map((t) =>
      t === "escalas"
        ? supabase!
            .from(t)
            .select(
              "*,dias:escala_dias(data,intervalos,folga,feriado,observacao)",
            )
        : t === "log_alteracoes"
          ? supabase!
              .from(t)
              .select(
                "id,tabela,acao,alterado_em,registro_id,empresa_id,ator_id,antes,depois,campos",
              )
              .order("alterado_em", { ascending: false })
              .limit(100)
          : supabase!.from(t).select("*"),
    ),
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
export async function saveSchedules(schedules: Schedule[]) {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { error } = await supabase.rpc("salvar_escalas", {
    itens: schedules.map((s) => ({ ...s, id: s.id || null })),
  });
  if (error) throw new Error(error.message);
}
export async function importDefaults(data: Data) {
  if (!supabase) throw new Error("Supabase não configurado.");
  if (!data.rules.length) {
    const { error } = await supabase
      .from("parametros_legais")
      .insert(initialRules);
    if (error) throw new Error(error.message);
  }
  if (!data.models.length) {
    const { error } = await supabase
      .from("modelos_jornada")
      .insert(initialModels);
    if (error) throw new Error(error.message);
  }
}
export async function importHolidays(year: number) {
  for (const h of initialHolidays(year)) {
    if (!supabase) throw new Error("Supabase não configurado.");
    const { error } = await supabase.from("feriados").upsert(h, {
      onConflict: "user_id,nome,data,abrangencia",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(error.message);
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
