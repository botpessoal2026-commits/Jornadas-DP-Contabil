import type { LegalRule, Model, Schedule } from "./types";

export const default12x36Values: Record<string, number | boolean | string> = {
  tipo_regime: "12x36",
  plantao_maximo_minutos: 720,
  descanso_minimo_minutos: 2160,
  intervalo_tratamento: "usufruido",
  intervalo_minimo_minutos: 60,
  alternancia_horas: 48,
  limite_media_semanal_minutos: 2640,
  descansos_semanais: 1,
  descanso_semanal_tratamento: "semanal",
  descanso_compensacao_referencia: "",
  descanso_compensacao_comprovada: false,
  fundamento_tipo: "",
  fundamento_referencia: "",
  comprovado: false,
};

/** Legacy rules without a discriminator remain common-workday rules. */
export function regimeKey(rule: Pick<LegalRule, "chave" | "valor">) {
  return rule.chave === "regime"
    ? `regime:${rule.valor.tipo_regime === "12x36" ? "12x36" : "comum"}`
    : rule.chave;
}

/** The saved model link identifies the regime; a current picker never does. */
export function scheduleRegime(schedule: Schedule, models: Model[]) {
  const model = models.find((entry) => entry.id === schedule.modelo_id);
  return model && (!schedule.modelo_tipo || model.tipo === schedule.modelo_tipo)
    ? model
    : schedule.modelo_tipo;
}

export function validateRegimeValues(
  value: Record<string, number | boolean | string>,
) {
  if (
    Object.values(value).some(
      (entry) => !["string", "number", "boolean"].includes(typeof entry),
    )
  )
    throw new Error("Os parâmetros do regime devem conter valores simples.");
  if (
    value.tipo_regime !== undefined &&
    !["comum", "12x36"].includes(String(value.tipo_regime))
  )
    throw new Error("Escolha um tipo de regime válido.");
  const numeric = (key: string, min: number, max = Number.MAX_SAFE_INTEGER) => {
    const number = value[key];
    if (
      typeof number !== "number" ||
      !Number.isFinite(number) ||
      number < min ||
      number > max
    )
      throw new Error(`Confira o parâmetro 12×36: ${key}.`);
  };
  if (value.tipo_regime !== "12x36") {
    numeric("limite_semanal_minutos", 1);
    numeric("limite_diario_minutos", 1);
    numeric("descansos_semanais", 0, 7);
    return;
  }
  numeric("plantao_maximo_minutos", 1, 720);
  numeric("descanso_minimo_minutos", 2160);
  numeric(
    "intervalo_minimo_minutos",
    value.intervalo_tratamento === "indenizado" ? 0 : 1,
    720,
  );
  numeric("alternancia_horas", 48, 48);
  numeric("limite_media_semanal_minutos", 1, 2640);
  numeric("descansos_semanais", 1, 7);
  if (!Number.isInteger(value.descansos_semanais))
    throw new Error("Informe uma quantidade inteira de descansos semanais.");
  if (!["usufruido", "indenizado"].includes(String(value.intervalo_tratamento)))
    throw new Error("Escolha o tratamento do intervalo no regime 12×36.");
  if (
    !["semanal", "media_mensal"].includes(
      String(value.descanso_semanal_tratamento),
    )
  )
    throw new Error(
      "Escolha o tratamento do descanso semanal no regime 12×36.",
    );
  if (
    !["", "acordo_individual", "cct", "act"].includes(
      String(value.fundamento_tipo),
    )
  )
    throw new Error(
      "Escolha um fundamento jurídico válido para o regime 12×36.",
    );
}

/** Official EC 141/2026, arts. 1, 2 and 6. Values are protective ceilings. */
export function constitutionalPhase(date: string) {
  if (date >= "2027-12-16")
    return { start: "2027-12-16", weekly: 2400, rests: 2 };
  if (date >= "2026-12-16")
    return { start: "2026-12-16", weekly: 2520, rests: 2 };
  return { start: "1988-10-05", weekly: 2640, rests: 1 };
}
