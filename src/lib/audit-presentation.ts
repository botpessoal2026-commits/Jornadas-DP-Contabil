import type { AuditLog } from "./store";
import type { Day } from "./types";
import { formatMinutes, minutes } from "./engine";

const labels: Record<string, string> = {
  nome: "Nome",
  nome_fantasia: "Nome fantasia",
  cpf: "CPF",
  cnpj: "CNPJ",
  cargo: "Cargo",
  setor: "Setor",
  matricula: "Matrícula",
  admissao: "Admissão",
  situacao: "Situação",
  cidade: "Cidade",
  uf: "UF",
  observacao: "Observação",
  observacoes: "Observações",
  horario_contratual: "Horário contratual",
  carga_diaria_minutos: "Carga diária",
  carga_semanal_minutos: "Carga semanal",
  carga_semanal_padrao_minutos: "Carga semanal padrão",
  permite_6x1: "Permite 6×1",
  usa_banco_horas: "Banco de horas",
  inicio_vigencia: "Início da vigência",
  confirmado: "Conferência da fonte",
  fonte: "Fonte",
  data_inicio: "Data inicial",
  data_fim: "Data final",
  ativo: "Ativo",
  categoria: "Categoria",
  expediente: "Expediente",
  alcance: "Abrangência",
  recorrencia: "Recorrência",
  dias_descanso: "Descansos",
  regras_especiais: "Regras individuais",
  modelo_id: "Modelo",
  modelo_padrao_id: "Modelo padrão",
  estabelecimento_id: "Estabelecimento",
  funcionario_ids: "Pessoas abrangidas",
  valor: "Parâmetros",
  dias: "Dias da escala",
};
export const auditTableLabels: Record<string, string> = {
  empresas: "Empresa",
  funcionarios: "Funcionário",
  modelos_jornada: "Modelo de jornada",
  parametros_legais: "Parâmetro legal",
  feriados: "Feriado",
  datas_especiais: "Data especial",
  estabelecimentos: "Estabelecimento",
  escalas: "Escala",
  escala_dias: "Dia da escala",
};
const hidden = new Set([
  "id",
  "user_id",
  "empresa_id",
  "created_at",
  "updated_at",
  "alterado_em",
]);
const readable = (value: unknown, key: string) => {
  if (value === null || value === undefined || value === "")
    return "Não informado";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number" && key.endsWith("_minutos"))
    return formatMinutes(value);
  if (Array.isArray(value))
    return `${value.length} ${key === "funcionario_ids" ? "pessoa(s)" : "item(ns)"}`;
  if (typeof value === "object") return "Configuração alterada";
  return String(value).replaceAll("_", " ").slice(0, 300);
};
function dayLabel(day: Day) {
  const intervals = Array.isArray(day.intervalos)
    ? day.intervalos.filter((shift) => shift && typeof shift === "object")
    : [];
  const periods = intervals
    ?.map(
      (shift) =>
        `${shift.start}–${shift.end}${shift.endDay === 1 || shift.end <= shift.start ? " (+1 dia)" : ""}`,
    )
    .join(" / ");
  const status = periods || (day.folga ? "Folga" : "Sem expediente");
  let total = "";
  try {
    if (intervals.length) total = ` (${formatMinutes(minutes(intervals))})`;
  } catch {
    total = " (horários a conferir)";
  }
  return `${status}${total}${day.feriado ? ` · ${day.feriado}` : ""}${day.observacao ? ` · ${day.observacao}` : ""}`;
}

/** Human differences first; raw payload remains available in technical details. */
export function auditChanges(log: AuditLog): string[] {
  const before = log.antes ?? {},
    after = log.depois ?? {};
  const changes: string[] = [];
  const validDays = (value: unknown) =>
    Array.isArray(value)
      ? value.filter(
          (day): day is Day =>
            !!day && typeof day === "object" && typeof day.data === "string",
        )
      : [];
  const beforeDays = validDays(before.dias);
  const afterDays = validDays(after.dias);
  if (beforeDays.length || afterDays.length) {
    const dates = Array.from(
      new Set([...beforeDays, ...afterDays].map((day) => day.data)),
    ).sort();
    for (const date of dates) {
      const old = beforeDays.find((day) => day.data === date),
        next = afterDays.find((day) => day.data === date);
      const oldLabel = old ? dayLabel(old) : "Sem registro",
        newLabel = next ? dayLabel(next) : "Sem registro";
      if (oldLabel !== newLabel)
        changes.push(
          `Dia ${date.slice(8, 10)}/${date.slice(5, 7)}: ${oldLabel} → ${newLabel}`,
        );
    }
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (hidden.has(key) || key === "dias") continue;
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    if (key.endsWith("_id")) {
      changes.push(
        `${labels[key] ?? key.replaceAll("_", " ")}: ${!before[key] ? "vínculo definido" : !after[key] ? "vínculo removido" : "vínculo alterado"}`,
      );
      continue;
    }
    if (key === "intervalos") {
      changes.push(
        `Horários: ${dayLabel({ ...before, intervalos: Array.isArray(before.intervalos) ? before.intervalos : [] } as Day)} → ${dayLabel({ ...after, intervalos: Array.isArray(after.intervalos) ? after.intervalos : [] } as Day)}`,
      );
      continue;
    }
    changes.push(
      `${labels[key] ?? key.replaceAll("_", " ")}: ${readable(before[key], key)} → ${readable(after[key], key)}`,
    );
  }
  return changes.length
    ? changes
    : [
        log.acao === "INSERT"
          ? "Registro incluído."
          : log.acao === "DELETE"
            ? "Registro excluído."
            : "Metadados atualizados; consulte os detalhes técnicos.",
      ];
}

export function auditLocalDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(+date)
    ? new Intl.DateTimeFormat("sv-SE", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date)
    : "";
}
