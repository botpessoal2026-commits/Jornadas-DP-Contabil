import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LegalFields from "../src/components/legal-fields";
import ModelFields from "../src/components/model-fields";
import { default12x36Values } from "../src/lib/work-regime";
import type { Model } from "../src/lib/types";

test("parâmetro 12×36 oferece instrumentos válidos sem impor CCT ao fundamento individual", () => {
  const html = renderToStaticMarkup(
    createElement(LegalFields, {
      row: {
        chave: "regime",
        valor: {
          ...default12x36Values,
          fundamento_tipo: "acordo_individual",
          fundamento_referencia: "Acordo escrito do vínculo",
          comprovado: false,
        },
      },
    }),
  );
  assert.ok(html.includes("Duração máxima do plantão (minutos)"));
  assert.ok(html.includes("Descanso mínimo entre plantões (minutos)"));
  assert.ok(html.includes("Acordo individual escrito"));
  assert.ok(html.includes("Convenção coletiva de trabalho"));
  assert.ok(html.includes("Acordo coletivo de trabalho"));
  assert.ok(html.includes("Pendente de comprovação"));
  assert.ok(html.includes('value="acordo_individual" selected=""'));
  assert.ok(!html.includes("Teto diário (minutos)"));
  assert.ok(!html.includes("Admite limite diário específico da empresa"));
  assert.ok(!html.includes("ACT/CCT para compensação dos repousos"));
});

test("compensação mensal tem referência coletiva própria sem reutilizar a prova do regime", () => {
  const html = renderToStaticMarkup(
    createElement(LegalFields, {
      row: {
        chave: "regime",
        valor: {
          ...default12x36Values,
          fundamento_tipo: "acordo_individual",
          fundamento_referencia: "Acordo escrito do vínculo",
          comprovado: true,
          descanso_semanal_tratamento: "media_mensal",
          descanso_compensacao_referencia: "ACT da compensação dos repousos",
          descanso_compensacao_comprovada: false,
        },
      },
    }),
  );
  assert.ok(html.includes("ACT/CCT para compensação dos repousos"));
  assert.ok(html.includes('value="ACT da compensação dos repousos"'));
  assert.ok(html.includes('value="Acordo escrito do vínculo"'));
  assert.ok(html.includes("Compensação coletiva dos repousos conferida"));
  assert.ok(html.includes("EC nº 141/2026"));
  const checked = html.match(/checked=""/g) ?? [];
  assert.equal(checked.length, 1);
});

test("parâmetros comuns legados permanecem comuns e mantêm os limites cadastrados", () => {
  const html = renderToStaticMarkup(
    createElement(LegalFields, {
      row: {
        chave: "regime",
        valor: {
          limite_semanal_minutos: 2520,
          limite_diario_minutos: 504,
          descansos_semanais: 2,
          permite_limite_empresa: true,
        },
      },
    }),
  );
  assert.ok(html.includes('value="comum" selected=""'));
  assert.ok(html.includes('value="504"'));
  assert.ok(html.includes("Teto diário (minutos)"));
  assert.ok(!html.includes("Duração máxima do plantão (minutos)"));
  assert.ok(!html.includes("Fundamento jurídico do regime"));
});

test("modelo 12×36 apresenta duração total e trabalho efetivo distintos inclusive à noite", () => {
  const model: Model = {
    id: "ciclo-noturno",
    empresa_id: "empresa",
    nome: "Plantão noturno",
    tipo: "12x36",
    padrao: {},
    ciclo_inicio: "2026-10-01",
    turno: [
      { start: "19:00", end: "23:00" },
      { start: "00:00", end: "07:00", startDay: 1, endDay: 1 },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(ModelFields, { model, companies: [] }),
  );
  assert.ok(html.includes("Duração do plantão: 12h00"));
  assert.ok(html.includes("trabalhadas: 11h00"));
  assert.ok(!html.includes("confira a CCT"));
  assert.ok(!html.includes("Total semanal:"));
});
