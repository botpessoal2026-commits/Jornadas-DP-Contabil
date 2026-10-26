import type { Holiday, LegalRule, Model } from "./types";

/** A particular rule takes over its key from its first effective date onward. */
export function rulesForCompany(rules: LegalRule[], companyId: string) {
  const firstParticular = new Map<string, string>();
  for (const rule of rules) {
    if (rule.empresa_id !== companyId) continue;
    const first = firstParticular.get(rule.chave);
    if (!first || rule.inicio_vigencia < first)
      firstParticular.set(rule.chave, rule.inicio_vigencia);
  }
  return rules.filter((rule) => {
    if (rule.empresa_id === companyId) return true;
    if (rule.empresa_id != null) return false;
    const first = firstParticular.get(rule.chave);
    return !first || rule.inicio_vigencia < first;
  });
}

/** Company entries precede general references when both apply to one date. */
export function holidaysForCompany(holidays: Holiday[], companyId: string) {
  return [
    ...holidays.filter((holiday) => holiday.empresa_id === companyId),
    ...holidays.filter((holiday) => holiday.empresa_id == null),
  ];
}

/** Global models are a library; only existing links may keep using them. */
export function modelsForCompany(
  models: Model[],
  companyId: string,
  legacyIds: readonly (string | null | undefined)[] = [],
) {
  const legacy = new Set(legacyIds.filter(Boolean));
  return models.filter(
    (model) =>
      model.empresa_id === companyId ||
      (model.empresa_id == null && legacy.has(model.id)),
  );
}
