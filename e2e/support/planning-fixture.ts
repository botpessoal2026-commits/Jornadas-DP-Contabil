import { expect, type Page } from "@playwright/test";
import { backend, userA } from "./persistence-backend";
import { rotationFixture } from "../../tests/fixtures/rotation-data";
export async function planningFixture(page: Page, data = rotationFixture()) {
  const db = await backend(page);
  for (const [table, rows] of [
    ["empresas", data.companies],
    ["funcionarios", data.employees],
    ["modelos_jornada", data.models],
    ["escalas", data.schedules],
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
  return { db, data };
}
