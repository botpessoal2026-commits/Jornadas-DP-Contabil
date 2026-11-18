import { test, expect, type Page } from "@playwright/test";
import { backend, userA } from "./support/persistence-backend";
import {
  rotationFixture,
  rotationIds as ids,
} from "../tests/fixtures/rotation-data";

async function setup(page: Page) {
  const db = await backend(page),
    data = rotationFixture();
  for (const [table, rows] of [
    ["empresas", data.companies],
    ["funcionarios", data.employees],
    ["modelos_jornada", data.models],
  ] as const)
    db.tables[table].push(...rows.map((row) => ({ ...row, user_id: userA })));
  await page.goto("/login");
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("primeira@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill("senha-teste-123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Meu acesso", exact: true }),
  ).toBeVisible();
  await page.goto(
    `/?empresa=${ids.company}&pagina=escalas&mes=2027-01&visao=equipe`,
  );
  await page
    .getByText("Revezar folgas 12×36 — grupos A e B", { exact: true })
    .click();
  const rotation = page.getByLabel("Revezamento de folgas 12×36", {
    exact: true,
  });
  await rotation
    .getByRole("button", { name: "Selecionar funcionários 12×36", exact: true })
    .click();
  await rotation
    .getByRole("button", { name: "Distribuir grupos A e B", exact: true })
    .click();
  return { db, rotation };
}

test("revezamento salva modelos e escalas, alterna a equipe e mantém os vínculos após recarga e novo login", async ({
  page,
}) => {
  const { db, rotation } = await setup(page);
  await expect(
    rotation.getByRole("combobox", { name: "Grupo de Ana", exact: true }),
  ).toHaveValue("A");
  await expect(
    rotation.getByRole("combobox", { name: "Grupo de Bruna", exact: true }),
  ).toHaveValue("B");
  await rotation
    .getByRole("button", { name: "Gerar prévia do revezamento", exact: true })
    .click();
  await expect(
    rotation.getByRole("heading", {
      name: "Conferência do revezamento",
      exact: true,
    }),
  ).toBeVisible();
  expect(db.writes).toEqual([]);
  await rotation
    .getByText("Ver quem trabalha e quem folga em cada dia", { exact: true })
    .click();
  const monday = rotation.locator("article").filter({
    has: page.getByRole("heading", { name: "04/01/2027", exact: true }),
  });
  await expect(monday).toContainText("Trabalham: Bruna");
  await expect(monday).toContainText("Folga / sem expediente: Ana");
  await rotation.getByRole("checkbox", { name: /^Conferi os grupos/ }).check();
  await rotation
    .getByRole("button", {
      name: "Salvar revezamento sem aprovar",
      exact: true,
    })
    .click();
  await expect(rotation.getByRole("status")).toContainText("Revezamento salvo");
  expect(db.rotations).toHaveLength(1);
  expect(db.tables.modelos_jornada).toHaveLength(3);
  expect(db.tables.escalas).toHaveLength(2);
  expect(
    db.tables.modelos_jornada.find((model) => model.id === ids.model)
      ?.ciclo_inicio,
  ).toBe("2027-01-01");
  const bruna = db.tables.funcionarios.find(
    (employee) => employee.id === ids.colleague,
  )!;
  const modelId = bruna.modelo_padrao_id;
  expect(
    db.tables.modelos_jornada.find((model) => model.id === modelId)
      ?.ciclo_inicio,
  ).toBe("2027-01-02");
  await page.reload();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("primeira@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill("senha-teste-123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Meu acesso", exact: true }),
  ).toBeVisible();
  await page.goto(
    `/?empresa=${ids.company}&pagina=escalas&funcionario=${ids.colleague}&mes=2027-02`,
  );
  await page.getByRole("button", { name: "Gerar prévia", exact: true }).click();
  await expect(page.locator('[data-date="2027-02-01"]')).toContainText("07:00");
  expect(
    db.tables.funcionarios.find((employee) => employee.id === ids.colleague)
      ?.modelo_padrao_id,
  ).toBe(modelId);
  expect(db.unexpected).toEqual([]);
});

test("migration ausente preserva a prévia e não altera modelos, vínculos ou escalas", async ({
  page,
}) => {
  const { db, rotation } = await setup(page);
  db.setRotationUnavailable(true);
  await rotation
    .getByRole("button", { name: "Gerar prévia do revezamento", exact: true })
    .click();
  await rotation.getByRole("checkbox", { name: /^Conferi os grupos/ }).check();
  await rotation
    .getByRole("button", {
      name: "Salvar revezamento sem aprovar",
      exact: true,
    })
    .click();
  await expect(rotation.getByRole("alert")).toContainText(
    "202611180001_rest_rotation.sql",
  );
  await expect(
    rotation.getByRole("heading", {
      name: "Conferência do revezamento",
      exact: true,
    }),
  ).toBeVisible();
  expect(db.tables.modelos_jornada).toHaveLength(1);
  expect(db.tables.escalas).toHaveLength(0);
  expect(
    db.tables.funcionarios.find((employee) => employee.id === ids.colleague)
      ?.modelo_padrao_id,
  ).toBe(ids.model);
});

test("revezamento no celular exige grupos diferentes e preserva a prévia ao cancelar descarte", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { rotation } = await setup(page);
  await rotation
    .getByRole("combobox", { name: "Grupo de Bruna", exact: true })
    .selectOption("A");
  await rotation
    .getByRole("button", { name: "Gerar prévia do revezamento", exact: true })
    .click();
  await expect(rotation.getByRole("alert")).toContainText("grupos A e B");
  await rotation
    .getByRole("combobox", { name: "Grupo de Bruna", exact: true })
    .selectOption("B");
  await rotation
    .getByRole("button", { name: "Gerar prévia do revezamento", exact: true })
    .click();
  await rotation
    .getByRole("button", {
      name: "Descartar prévia do revezamento",
      exact: true,
    })
    .click();
  await rotation
    .getByRole("button", { name: "Continuar no revezamento", exact: true })
    .click();
  await expect(
    rotation.getByRole("heading", {
      name: "Conferência do revezamento",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: "work/revezamento-mobile.png",
    fullPage: true,
  });
});

test("gravação concluída com falha na recarga não permite repetir a operação", async ({
  page,
}) => {
  const { db, rotation } = await setup(page);
  await rotation
    .getByRole("button", { name: "Gerar prévia do revezamento", exact: true })
    .click();
  await rotation.getByRole("checkbox", { name: /^Conferi os grupos/ }).check();
  db.failAfterNextWrite();
  await rotation
    .getByRole("button", {
      name: "Salvar revezamento sem aprovar",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Gravação do revezamento concluída" }),
  ).toBeVisible({ timeout: 12000 });
  await expect(
    rotation.getByRole("button", {
      name: "Gerar prévia do revezamento",
      exact: true,
    }),
  ).toBeDisabled();
  expect(db.rotations).toHaveLength(1);
  expect(db.tables.modelos_jornada).toHaveLength(3);
  expect(db.tables.escalas).toHaveLength(2);
  db.restoreReadback();
  await page.reload();
  expect(db.rotations).toHaveLength(1);
});
