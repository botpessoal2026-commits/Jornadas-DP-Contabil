import test from "node:test";
import assert from "node:assert/strict";
import { validationDays } from "../src/lib/schedule-context";
import { scheduleRegime } from "../src/lib/work-regime";
import { demoData } from "../src/lib/demo";
import { activeRule } from "../src/lib/engine";
import { rulesForCompany } from "../src/lib/company-resources";
import type { Day, LegalRule } from "../src/lib/types";

const day = (data: string, end = "19:00"): Day => ({
  data,
  intervalos: [{ start: "07:00", end }],
  folga: false,
  feriado: null,
  observacao: "",
});

test("validação usa datas efetivas do mês vizinho sem substituir prévia nem misturar vínculos", () => {
  const original = demoData().schedules[0];
  const current = {
    ...original,
    mes: "2026-11-01",
    dias: [day("2026-10-31"), day("2026-11-01"), day("2026-12-01")],
  };
  const prior = {
    ...original,
    mes: "2026-10-01",
    dias: [
      day("2026-10-30", "18:00"),
      day("2026-10-31", "20:00"),
      day("2026-11-01", "21:00"),
    ],
  };
  const following = {
    ...original,
    mes: "2026-12-01",
    dias: [day("2026-11-30", "22:00"), day("2026-12-01", "18:00")],
  };
  const before = structuredClone([current, prior, following]);
  const result = validationDays(current, [
    prior,
    following,
    { ...prior, empresa_id: "outra", dias: [day("2026-10-31", "23:00")] },
    { ...prior, funcionario_id: "outro", dias: [day("2026-10-31", "22:00")] },
  ]);
  assert.equal(
    result.find((d) => d.data === "2026-10-31")?.intervalos[0].end,
    "20:00",
  );
  assert.equal(
    result.find((d) => d.data === "2026-11-01")?.intervalos[0].end,
    "19:00",
  );
  assert.equal(
    result.find((d) => d.data === "2026-12-01")?.intervalos[0].end,
    "18:00",
  );
  assert.ok(result.some((d) => d.data === "2026-10-30"));
  assert.ok(!result.some((d) => d.data === "2026-11-30"));
  assert.deepEqual([current, prior, following], before);
});

test("regime usa vínculo salvo e tipo estruturado preservando o snapshot quando o modelo muda de tipo", () => {
  const data = demoData();
  const schedule = data.schedules[0];
  const linked = data.models[0];
  assert.equal(scheduleRegime(schedule, data.models), linked);
  assert.equal(scheduleRegime(schedule, [{ ...linked, tipo: "12x36" }]), "5x2");
  const resolved = scheduleRegime({ ...schedule, modelo_tipo: undefined }, [
    { ...linked, tipo: "12x36" },
  ]);
  assert.equal(typeof resolved, "object");
  assert.equal(typeof resolved === "object" && resolved.tipo, "12x36");
  assert.equal(
    scheduleRegime(
      { ...schedule, modelo_id: "ausente", modelo_tipo: "12x36" },
      data.models,
    ),
    "12x36",
  );
});

test("regras particulares de 12×36 e comuns têm vigências independentes na mesma empresa", () => {
  const common = demoData().rules.find((rule) => rule.chave === "regime")!;
  const rules: LegalRule[] = [
    { ...common, id: "geral-comum" },
    { ...common, id: "geral-ciclo", valor: { tipo_regime: "12x36" } },
    {
      ...common,
      id: "alfa-ciclo",
      empresa_id: "alfa",
      inicio_vigencia: "2026-01-01",
      valor: { tipo_regime: "12x36" },
    },
    {
      ...common,
      id: "beta-comum",
      empresa_id: "beta",
      inicio_vigencia: "2026-01-01",
    },
  ];
  const alpha = rulesForCompany(rules, "alfa");
  const beta = rulesForCompany(rules, "beta");
  assert.equal(activeRule(alpha, "regime", "2026-10-01")?.id, "geral-comum");
  assert.equal(
    activeRule(alpha, "regime", "2026-10-01", "12x36")?.id,
    "alfa-ciclo",
  );
  assert.equal(activeRule(beta, "regime", "2026-10-01")?.id, "beta-comum");
  assert.equal(
    activeRule(beta, "regime", "2026-10-01", "12x36")?.id,
    "geral-ciclo",
  );
});
