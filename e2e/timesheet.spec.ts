import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function openSchedule(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar demonstração" }).click();
  await page
    .getByRole("button", { name: "Escalas mensais", exact: true })
    .click();
}

test("folha de ponto baixa PDF da prévia atual sem salvar ou substituir a exportação da escala", async ({
  page,
}, testInfo) => {
  await openSchedule(page);
  await page.locator('[data-date="2026-12-01"]').click();
  await page
    .getByRole("dialog")
    .getByLabel("Saída", { exact: true })
    .fill("18:10");
  await page
    .getByRole("button", { name: "Salvar na prévia", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "PDF", exact: true }),
  ).toBeVisible();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Folha de ponto", exact: true })
    .click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(
    "folha-de-ponto-2026-12-mariana-costa.pdf",
  );
  const path = testInfo.outputPath("folha-de-ponto-previa.pdf");
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  const bytes = (await readFile(path)).toString("latin1");
  expect(bytes.startsWith("%PDF-")).toBe(true);
  expect(bytes).toContain("Mariana Costa");
  expect(bytes).toContain("18:10");
  expect(bytes).toContain("01/12/2026");
  expect(bytes).toContain("31/12/2026");
  expect(bytes).toContain("Base:");
  expect(bytes).not.toContain("Rafael Lima");
  await expect(page.locator('[data-date="2026-12-01"]')).toContainText("18:10");
  await expect(
    page.getByRole("button", { name: "Salvar escala", exact: true }),
  ).toBeEnabled();
});

test("folha segue empresa e funcionário selecionados, sem misturar jornadas", async ({
  page,
}, testInfo) => {
  await openSchedule(page);
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption("demo-company-beta");
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Folha de ponto", exact: true })
    .click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(
    "folha-de-ponto-2026-12-rafael-lima.pdf",
  );
  const path = testInfo.outputPath("folha-de-ponto-beta.pdf");
  await download.saveAs(path);
  const bytes = (await readFile(path)).toString("latin1");
  expect(bytes).toContain("Rafael Lima");
  expect(bytes).toContain("Horizonte");
  expect(bytes).toContain("15:00");
  expect(bytes).not.toContain("Mariana Costa");
  expect(bytes).not.toContain("17:24");
});
