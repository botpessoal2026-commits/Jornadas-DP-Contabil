import assert from "node:assert/strict";
import { test } from "node:test";
import { activeRule } from "../src/lib/engine";
import { demoData } from "../src/lib/demo";
import {
  commonTransitionReferences,
  constitutionalPhaseForDate,
  constitutionalReference,
  missingReferenceRules,
} from "../src/lib/legal-reference";
import { initialRules } from "../src/lib/presets";
import type { LegalRule } from "../src/lib/types";

const rules = initialRules.map((rule, i) => ({ ...rule, id: `ref-${i}` }));

test("EC141 aplica 44h, 42h e 40h nas datas civis oficiais, com dois repousos", () => {
  assert.deepEqual(constitutionalPhaseForDate("2026-12-15"), {
    start: "1988-10-05",
    weekly: 2640,
    rests: 1,
  });
  for (const date of ["2026-12-16", "2027-12-15"])
    assert.deepEqual(constitutionalPhaseForDate(date), {
      start: "2026-12-16",
      weekly: 2520,
      rests: 2,
    });
  assert.deepEqual(constitutionalPhaseForDate("2027-12-16"), {
    start: "2027-12-16",
    weekly: 2400,
    rests: 2,
  });
});

test("referências comuns e 12x36 têm fases próprias, sem certificar enquadramento", () => {
  for (const date of ["2026-12-15", "2026-12-16", "2027-12-15", "2027-12-16"]) {
    const phase = constitutionalPhaseForDate(date);
    const common = activeRule(rules, "regime", date)!;
    const special = activeRule(rules, "regime", date, "12x36")!;
    assert.equal(common.valor.limite_semanal_minutos, phase.weekly);
    assert.equal(special.valor.limite_media_semanal_minutos, phase.weekly);
    assert.equal(common.valor.descansos_semanais, phase.rests);
    assert.equal(special.valor.descansos_semanais, phase.rests);
    assert.equal(common.confirmado, false);
    assert.equal(special.confirmado, false);
    assert.equal(special.valor.comprovado, false);
    assert.equal(special.valor.fundamento_tipo, "");
  }
});

test("demonstração atual usa cortes oficiais e continua sem fontes certificadas", () => {
  const demo = demoData();
  assert.equal(
    activeRule(demo.rules, "regime", "2026-12-15")!.valor
      .limite_semanal_minutos,
    2640,
  );
  assert.equal(
    activeRule(demo.rules, "regime", "2026-12-16")!.valor
      .limite_semanal_minutos,
    2520,
  );
  assert.equal(
    activeRule(demo.rules, "regime", "2027-12-01")!.valor
      .limite_semanal_minutos,
    2520,
  );
  assert.equal(
    activeRule(demo.rules, "regime", "2027-12-16")!.valor
      .limite_semanal_minutos,
    2400,
  );
  assert.ok(demo.rules.every((rule) => rule.confirmado === false));
  assert.equal(
    new Set(
      demo.rules.map(
        (rule) =>
          `${rule.chave}:${rule.valor.tipo_regime ?? "comum"}:${rule.inicio_vigencia}`,
      ),
    ).size,
    demo.rules.length,
  );
});

test("importação incremental preserva referências existentes customizadas e conferidas", () => {
  const existing: LegalRule = {
    ...structuredClone(
      rules.find(
        (rule) =>
          rule.inicio_vigencia === "2026-12-16" &&
          rule.valor.tipo_regime === "comum",
      )!,
    ),
    valor: { limite_semanal_minutos: 2100, observacao_local: "Contrato menor" },
    confirmado: true,
  };
  const before = structuredClone(existing);
  const missing = missingReferenceRules([existing], initialRules);
  assert.deepEqual(existing, before);
  assert.ok(
    !missing.some(
      (rule) =>
        rule.inicio_vigencia === existing.inicio_vigencia &&
        rule.chave === existing.chave &&
        rule.valor.tipo_regime !== "12x36",
    ),
  );
  assert.ok(
    missing.some(
      (rule) =>
        rule.inicio_vigencia === existing.inicio_vigencia &&
        rule.valor.tipo_regime === "12x36",
    ),
  );
  assert.ok(missing.every((rule) => rule.confirmado === false));
});

test("importação é idempotente e parâmetros particulares não escondem referência geral", () => {
  assert.deepEqual(missingReferenceRules(rules, initialRules), []);
  const particular = rules.map((rule) => ({
    ...rule,
    empresa_id: "empresa-a",
  }));
  assert.equal(
    missingReferenceRules(particular, initialRules).length,
    initialRules.length,
  );
  const twice = [...initialRules, ...initialRules];
  assert.equal(missingReferenceRules([], twice).length, initialRules.length);
});

test("referências não compartilham objetos editáveis nem aprovam templates", () => {
  const templates = structuredClone(initialRules);
  templates[0].confirmado = true;
  const imported = missingReferenceRules([], templates);
  assert.equal(imported[0].confirmado, false);
  imported[0].valor.limite_semanal_minutos = 1;
  assert.equal(templates[0].valor.limite_semanal_minutos, 2640);
  assert.equal(initialRules[0].valor.limite_semanal_minutos, 2640);
});

test("fonte, versão, vigência e limites da referência ficam identificados", () => {
  for (const rule of commonTransitionReferences) {
    assert.ok(rule.fonte.includes(constitutionalReference.consultedUrl));
    assert.equal(rule.valor.fonte_versao, constitutionalReference.version);
    assert.equal(rule.valor.fonte_consultada_em, "2026-10-29");
    assert.equal(rule.valor.escopo, "referencia_geral");
    assert.equal(rule.valor.comprovado, false);
    assert.ok(rule.observacao.includes("irredutibilidade salarial"));
    assert.ok(rule.observacao.includes("não são aplicados automaticamente"));
  }
  assert.ok(commonTransitionReferences[0].observacao.includes("CCT/ACT"));
  assert.equal(
    commonTransitionReferences[1].valor.permite_limite_empresa,
    false,
  );
});
