import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
test("relatório na grade respeita filtro, identifica folgas e exporta CSV/Excel/PDF", async ({
  page,
}) => {
  await page.goto("/?demo=1&pagina=escalas&mes=2026-12&visao=equipe");
  const grid = page.getByLabel("Grade da equipe", { exact: true });
  await grid.getByLabel("Pesquisar equipe", { exact: true }).fill("Mariana");
  await grid
    .getByText("Relatório de dias trabalhados e folgas", { exact: true })
    .click();
  const report = grid.getByLabel("Relatório de dias trabalhados e folgas", {
    exact: true,
  });
  await report
    .getByRole("button", {
      name: "Gerar relatório de dias e folgas",
      exact: true,
    })
    .click();
  await expect(report.locator(".work-rest-card")).toHaveCount(1);
  await expect(report.locator(".work-rest-card")).toContainText(
    "Mariana Costa",
  );
  await expect(
    report.getByText("Folgas programadas", { exact: true }),
  ).toBeVisible();
  for (const [button, extension] of [
    ["CSV de dias e folgas", "csv"],
    ["Excel de dias e folgas", "xlsx"],
    ["PDF de dias e folgas", "pdf"],
  ]) {
    const downloadPromise = page.waitForEvent("download");
    await report.getByRole("button", { name: button, exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      `dias-e-folgas-2026-12.${extension}`,
    );
    const bytes = await readFile((await download.path())!);
    if (extension === "csv") {
      expect(bytes.toString()).toContain("Mariana Costa");
      expect(bytes.toString()).not.toContain("Rafael Lima");
    }
    if (extension === "pdf")
      expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    if (extension === "xlsx") {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes as never);
      expect(book.getWorksheet("Dias e horários")!.rowCount).toBe(32);
    }
  }
  await grid.getByLabel("Pesquisar equipe", { exact: true }).fill("Rafael");
  await expect(report.locator(".work-rest-card")).toHaveCount(0);
  await expect(
    report.getByRole("button", { name: "CSV de dias e folgas", exact: true }),
  ).toBeDisabled();
});
test("relatório central funciona no celular e separa funcionário sem escala", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/?demo=1&pagina=relatorios&mes=2027-01");
  const report = page.getByLabel("Relatório de dias trabalhados e folgas", {
    exact: true,
  });
  await report
    .getByRole("button", {
      name: "Gerar relatório de dias e folgas",
      exact: true,
    })
    .click();
  await expect(report.locator(".work-rest-card")).toHaveCount(2);
  await expect(report.locator(".work-rest-card").first()).toContainText(
    "31 sem escala",
  );
  await expect(report.locator(".work-rest-card").first()).toContainText(
    "0 folgas",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
});
