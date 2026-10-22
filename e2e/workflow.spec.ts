import { test, expect } from "@playwright/test";
test("demonstração: calendário, edições, exportações, duplicação e cadastros", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  if (process.env.NEXT_PUBLIC_DEMO_ONLY === "true") {
    await expect(
      page.getByRole("heading", { name: "Demonstração pessoal", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "E-mail", exact: true }),
    ).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Explorar demonstração" }).click();
  await expect(
    page.getByRole("heading", { name: "Seu mês, bem planejado." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Escalas mensais" }).click();
  await expect(
    page.getByRole("heading", { name: "Escalas de trabalho" }),
  ).toBeVisible();
  await expect(page.getByRole("gridcell")).toHaveCount(31);
  await expect(page.getByText("220 / 210", { exact: true })).toBeVisible();
  await expect(page.getByText("42h00 / 42h00").first()).toBeVisible();
  await page.screenshot({ path: "/tmp/jornadas-desktop.png", fullPage: true });
  for (const [name, ext] of [
    ["PDF", ".pdf"],
    ["Excel", ".xlsx"],
    ["CSV", ".csv"],
  ]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name, exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename().endsWith(ext)).toBe(true);
    await file.saveAs(`/tmp/jornadas-e2e${ext}`);
    expect(await file.failure()).toBeNull();
  }
  await page.getByRole("gridcell").first().click();
  await page
    .getByRole("textbox", { name: "Intervalos de trabalho (vazio = folga)" })
    .fill("08:00-12:00, 13:00-18:00");
  await page.getByRole("button", { name: "Salvar na prévia" }).click();
  await expect(
    page.getByRole("button", { name: "Salvar escala", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Salvar escala", exact: true })
    .click();
  await page.getByRole("button", { name: "Este funcionário" }).click();
  await expect(
    page.getByRole("heading", { name: "janeiro de 2027", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Empresas", exact: true }).click();
  await page.getByRole("button", { name: "Nova empresa" }).click();
  await page
    .getByRole("textbox", { name: "Nome da empresa" })
    .fill("Empresa de teste");
  await page
    .getByRole("textbox", { name: "CNPJ", exact: true })
    .fill("04.252.011/0001-10");
  await page.getByRole("button", { name: "Salvar cadastro" }).click();
  await expect(
    page.getByText("Empresa de teste", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Parâmetros legais", exact: true })
    .click();
  await expect(
    page.getByText("Vigências propostas, não validadas.", { exact: true }),
  ).toBeVisible();
  const proposed = page.locator(".legal-card").filter({
    has: page.getByRole("heading", {
      name: "Proposta 42h / 5x2 — conferir vigência",
      exact: true,
    }),
  });
  await proposed.getByRole("button", { name: "Editar regra" }).click();
  await page.getByLabel("Início da vigência").fill("2026-12-16");
  await expect(
    page.getByRole("spinbutton", { name: "Teto semanal (minutos)" }),
  ).toHaveValue("2520");
  await page.getByRole("button", { name: "Salvar cadastro" }).click();
  await expect(
    proposed.getByText("Vigência a partir de 16/12/2026 · regime"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("mobile: menu acessível e calendário sem rolagem horizontal da página", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar demonstração" }).click();
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("button", { name: "Escalas mensais" }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(31);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "/tmp/jornadas-mobile.png", fullPage: true });
});
