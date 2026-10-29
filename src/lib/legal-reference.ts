import type { LegalRule } from "./types";

/** Source review is not a certification of an employer's instrument or scope. */
export const constitutionalReference = {
  version: "EC141-2026/revisao-2026-10-29",
  reviewedAt: "2026-10-29",
  publishedAt: "2026-10-16",
  primaryUrl:
    "https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc141.htm",
  consultedUrl:
    "https://legis.senado.leg.br/norma/44184944/publicacao/44189027",
  salaryReference:
    "EC nº 141/2026, art. 2º: irredutibilidade salarial, inclusive dos pisos; o gerador não apura remuneração.",
  scope:
    "Referência geral. Exceções dos arts. 8º e 9º e instrumentos coletivos exigem enquadramento comprovado; não são aplicados automaticamente.",
} as const;

export const constitutionalPhases = [
  { start: "1988-10-05", weekly: 2640, rests: 1 },
  { start: "2026-12-16", weekly: 2520, rests: 2 },
  { start: "2027-12-16", weekly: 2400, rests: 2 },
] as const;

/** Dates are civil ISO dates, never timestamps affected by the client timezone. */
export function constitutionalPhaseForDate(date: string) {
  const phase = [...constitutionalPhases]
    .reverse()
    .find((candidate) => candidate.start <= date);
  return { ...(phase ?? constitutionalPhases[0]) };
}

const source = `EC nº 141/2026, arts. 1º, 2º, 3º, 6º, 7º e 10 — ${constitutionalReference.primaryUrl}; texto oficial consultado: ${constitutionalReference.consultedUrl}`;

/** Editable suggestions; importing them never records a legal approval. */
export const commonTransitionReferences: Omit<LegalRule, "id">[] =
  constitutionalPhases.slice(1).map((phase) => ({
    nome: `Regime de referência — ${phase.weekly / 60}h / dois repousos`,
    chave: "regime",
    valor: {
      tipo_regime: "comum",
      limite_semanal_minutos: phase.weekly,
      limite_diario_minutos: 480,
      permite_limite_empresa: phase.weekly === 2520,
      descansos_semanais: phase.rests,
      preferir_domingo: true,
      fundamento_tipo: "",
      fundamento_referencia: "",
      comprovado: false,
      fonte_versao: constitutionalReference.version,
      fonte_consultada_em: constitutionalReference.reviewedAt,
      escopo: "referencia_geral",
    },
    inicio_vigencia: phase.start,
    fonte: source,
    observacao:
      `${constitutionalReference.salaryReference} ${constitutionalReference.scope} ` +
      (phase.weekly === 2520
        ? "Art. 7º: ampliação diária para distribuir 42h na transição depende de CCT/ACT aplicável e conferido. Marcar uma permissão não comprova o instrumento."
        : "Art. 6º, II: 40h após mais um ano da primeira fase. Não reduzir proporcionalmente contratos já iguais ou inferiores a 40h (art. 4º).") +
      " A conferência da fonte não confirma a aplicação ao vínculo.",
    confirmado: false,
  }));

/**
 * Explicit import only. Existing rules (including customized values and review
 * state) win by semantic key; references never overwrite or certify a record.
 */
export function missingReferenceRules(
  existing: readonly LegalRule[],
  templates: readonly Omit<LegalRule, "id">[],
) {
  const key = (rule: Pick<LegalRule, "chave" | "valor" | "inicio_vigencia">) =>
    `${rule.chave}:${rule.chave === "regime" ? (rule.valor.tipo_regime === "12x36" ? "12x36" : "comum") : ""}:${rule.inicio_vigencia}`;
  const included = new Set(
    existing.filter((rule) => !rule.empresa_id).map(key),
  );
  return templates.flatMap((rule) => {
    if (rule.empresa_id || included.has(key(rule))) return [];
    included.add(key(rule));
    return [{ ...structuredClone(rule), confirmado: false }];
  });
}
