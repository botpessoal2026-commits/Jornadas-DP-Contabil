import { test } from "node:test";
import assert from "node:assert/strict";
import { legalValuePresentation } from "../src/lib/legal-presentation";

test("apresentação distingue duração, horário noturno, segundos e percentuais", () => {
  assert.deepEqual(legalValuePresentation("limite_diario_minutos", 504), {
    label: "Limite diário",
    value: "8h24",
  });
  assert.equal(
    legalValuePresentation("descanso_minimo_minutos", 2160).value,
    "36h00",
  );
  assert.equal(legalValuePresentation("inicio_minutos", 1320).value, "22:00");
  assert.equal(
    legalValuePresentation("hora_reduzida_segundos", 3150).value,
    "52min 30s",
  );
  assert.equal(legalValuePresentation("adicional_percentual", 20).value, "20%");
});

test("comprovação e modalidade recebem rótulos sem alterar os valores originais", () => {
  const original = {
    comprovado: false,
    fundamento_tipo: "acordo_individual",
    valor_desconhecido: "referência real",
  };
  assert.equal(
    legalValuePresentation("comprovado", original.comprovado).value,
    "Não",
  );
  assert.equal(
    legalValuePresentation("fundamento_tipo", original.fundamento_tipo).value,
    "Acordo individual escrito",
  );
  assert.equal(
    legalValuePresentation("valor_desconhecido", original.valor_desconhecido)
      .value,
    "referência real",
  );
  assert.equal(original.fundamento_tipo, "acordo_individual");
  assert.equal(
    legalValuePresentation("limite_diario_minutos", 90.5).value,
    "90.5 min",
  );
});
