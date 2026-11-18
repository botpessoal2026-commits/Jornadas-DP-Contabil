import { test, expect } from "@playwright/test";
import { planningFixture } from "./support/planning-fixture";
import {
  rotationFixture,
  rotationIds as ids,
  rotationSelection,
} from "../tests/fixtures/rotation-data";
import {
  applyRotationLocally,
  prepareRestRotation,
} from "../src/lib/rest-rotation";

test("horário da empresa salva, recarrega e permanece isolado da outra empresa", async ({
  page,
}) => {
  const { db } = await planningFixture(page);
  await page.goto(`/?empresa=${ids.company}&pagina=company-settings`);
  await page
    .getByRole("button", { name: "Editar configurações", exact: true })
    .click();
  const fields = page.getByRole("group", {
    name: "Horário de funcionamento da empresa",
    exact: true,
  });
  await fields
    .getByRole("checkbox", {
      name: "Cadastrar horário de funcionamento",
      exact: true,
    })
    .check();
  await fields
    .getByRole("combobox", { name: "Segunda-feira", exact: true })
    .selectOption("hours");
  await fields
    .getByLabel("Abertura Segunda-feira · período 1", { exact: true })
    .fill("07:00");
  await fields
    .getByLabel("Fechamento Segunda-feira · período 1", { exact: true })
    .fill("19:00");
  await fields
    .getByLabel("Cobertura mínima durante o funcionamento", { exact: true })
    .fill("2");
  await page
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    db.tables.empresas.find((company) => company.id === ids.company)
      ?.horario_funcionamento,
  ).toMatchObject({
    minimo_funcionarios: 2,
    semana: { "1": [{ start: "07:00", end: "19:00" }] },
  });
  expect(
    db.tables.empresas.find((company) => company.id === ids.second)
      ?.horario_funcionamento,
  ).toBeUndefined();
  await page.reload();
  await page
    .getByRole("button", { name: "Editar configurações", exact: true })
    .click();
  await expect(
    fields.getByLabel("Abertura Segunda-feira · período 1", { exact: true }),
  ).toHaveValue("07:00");
  await expect(
    fields.getByLabel("Cobertura mínima durante o funcionamento", {
      exact: true,
    }),
  ).toHaveValue("2");
});
test("cadastro de funcionamento no celular aceita 24h e impede horários inválidos sem perder o formulário", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { db } = await planningFixture(page);
  await page.goto(`/?empresa=${ids.company}&pagina=company-settings`);
  await page
    .getByRole("button", { name: "Editar configurações", exact: true })
    .click();
  const fields = page.getByRole("group", {
    name: "Horário de funcionamento da empresa",
    exact: true,
  });
  await fields
    .getByRole("checkbox", {
      name: "Cadastrar horário de funcionamento",
      exact: true,
    })
    .check();
  await fields
    .getByRole("combobox", { name: "Sábado", exact: true })
    .selectOption("24h");
  await fields
    .getByRole("combobox", { name: "Domingo", exact: true })
    .selectOption("hours");
  await fields
    .getByRole("combobox", { name: "Segunda-feira", exact: true })
    .selectOption("hours");
  await fields
    .getByRole("checkbox", {
      name: "Fecha no dia seguinte · Domingo · período 1",
      exact: true,
    })
    .check();
  await expect(fields.getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    db.tables.empresas.find((company) => company.id === ids.company)
      ?.horario_funcionamento,
  ).toBeUndefined();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
});
test("grade mostra lacuna no almoço, descanso alternado e períodos fora do funcionamento", async ({
  page,
}) => {
  const data = rotationFixture();
  data.companies[0].horario_funcionamento = {
    semana: Object.fromEntries(
      Array.from({ length: 7 }, (_, day) => [
        String(day),
        [{ start: "08:00", end: "18:00" }],
      ]),
    ),
    minimo_funcionarios: 1,
    feriados: "seguir_semana",
  };
  const saved = applyRotationLocally(
    data,
    prepareRestRotation(
      data,
      ids.company,
      "2027-01",
      "2027-01-01",
      rotationSelection,
    ),
  );
  await planningFixture(page, saved);
  await page.goto(
    `/?empresa=${ids.company}&pagina=escalas&mes=2027-01&visao=equipe`,
  );
  const coverage = page.getByLabel("Cobertura do horário de funcionamento", {
    exact: true,
  });
  await coverage
    .getByText("Cobertura do horário de funcionamento", { exact: true })
    .click();
  await expect(coverage.getByRole("status")).toContainText(
    "31 dia(s) com cobertura abaixo da meta",
  );
  await coverage
    .getByText(
      "04/01/2027 · Cobertura abaixo da meta · trabalho fora do funcionamento",
      { exact: true },
    )
    .click();
  await expect(coverage).toContainText("12:00–13:00 · 0/1 funcionário(s)");
  await expect(coverage).toContainText("Bruna: 07:00–08:00");
  await expect(coverage).toContainText("Bruna: 18:00–19:00");
});
