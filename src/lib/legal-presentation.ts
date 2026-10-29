/** Human-readable labels and units; persisted legal parameters remain unchanged. */
const labels: Record<string, string> = {
  tipo_regime: "Regime de trabalho",
  limite_semanal_minutos: "Limite semanal",
  limite_diario_minutos: "Limite diário",
  descansos_semanais: "Repousos semanais",
  preferir_domingo: "Preferir domingo",
  permite_limite_empresa: "Limite específico da empresa",
  plantao_maximo_minutos: "Plantão máximo",
  descanso_minimo_minutos: "Descanso entre plantões",
  intervalo_minimo_minutos: "Intervalo mínimo",
  alternancia_horas: "Ciclo entre inícios",
  limite_media_semanal_minutos: "Média semanal no ciclo",
  intervalo_tratamento: "Tratamento do intervalo",
  descanso_semanal_tratamento: "Tratamento dos repousos",
  fundamento_tipo: "Fundamento jurídico",
  fundamento_referencia: "Instrumento aplicável",
  comprovado: "Instrumento conferido",
  descanso_compensacao_referencia: "Instrumento da compensação",
  descanso_compensacao_comprovada: "Compensação conferida",
  acima_minutos: "Jornada longa acima de",
  entre_inicio_minutos: "Jornada intermediária acima de",
  intervalo_longo_minutos: "Intervalo da jornada longa",
  intervalo_curto_minutos: "Intervalo da jornada intermediária",
  minutos: "Descanso entre jornadas",
  inicio_minutos: "Início do horário noturno",
  fim_minutos: "Fim do horário noturno",
  hora_reduzida_segundos: "Duração da hora noturna",
  adicional_percentual: "Adicional noturno",
  fator: "Fator do divisor",
};
const valueLabels: Record<string, string> = {
  comum: "Jornada comum",
  "12x36": "12×36",
  usufruido: "Usufruído",
  indenizado: "Indenizado",
  semanal: "A cada semana",
  media_mensal: "Média mensal mediante ACT/CCT",
  acordo_individual: "Acordo individual escrito",
  cct: "Convenção coletiva de trabalho",
  act: "Acordo coletivo de trabalho",
};

export function durationLabel(minutes: number) {
  if (!Number.isFinite(minutes) || minutes < 0) return "Valor a conferir";
  if (!Number.isInteger(minutes)) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${String(rest).padStart(2, "0")}`;
}

export function legalValuePresentation(
  key: string,
  value: string | number | boolean,
) {
  const label = labels[key] ?? key.replaceAll("_", " ");
  if (typeof value === "boolean")
    return { label, value: value ? "Sim" : "Não" };
  if (typeof value === "number") {
    if (key === "inicio_minutos" || key === "fim_minutos")
      return {
        label,
        value: `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`,
      };
    if (key === "minutos" || key.endsWith("_minutos"))
      return { label, value: durationLabel(value) };
    if (key.endsWith("_horas")) return { label, value: `${value}h` };
    if (key.endsWith("_percentual")) return { label, value: `${value}%` };
    if (key.endsWith("_segundos"))
      return {
        label,
        value: `${Math.floor(value / 60)}min${value % 60 ? ` ${value % 60}s` : ""}`,
      };
  }
  return {
    label,
    value:
      valueLabels[String(value)] ??
      (value === "" ? "Não informado" : String(value)),
  };
}
