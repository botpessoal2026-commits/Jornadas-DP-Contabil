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

test("CPF opcional salvo no cadastro alimenta somente a folha do funcionário e pode ser removido", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar demonstração" }).click();
  await page.getByRole("button", { name: "Empresas", exact: true }).click();
  await page
    .locator(".company-card")
    .filter({ hasText: "Aurora Contabilidade" })
    .getByRole("button", { name: "Acessar empresa", exact: true })
    .click();
  const employeesTab = page
    .getByRole("navigation", { name: "Administração da empresa", exact: true })
    .getByRole("button", { name: "Funcionários", exact: true });
  const person = page
    .locator(".employee-card")
    .filter({ hasText: "Mariana Costa" });
  const edit = person.getByRole("button", {
    name: "Editar funcionário",
    exact: true,
  });
  const dialog = page.getByRole("dialog");
  const cpf = dialog.getByLabel("CPF (opcional)", { exact: true });
  const save = dialog.getByRole("button", {
    name: "Salvar cadastro",
    exact: true,
  });
  const downloadPdf = async (name: string) => {
    const pending = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Folha de ponto", exact: true })
      .click();
    const download = await pending;
    const path = testInfo.outputPath(`${name}.pdf`);
    await download.saveAs(path);
    expect(await download.failure()).toBeNull();
    return (await readFile(path)).toString("latin1");
  };
  await employeesTab.click();
  await edit.click();
  await expect(cpf).toBeEmpty();
  await cpf.fill("123");
  await save.click();
  await expect(dialog).toBeVisible();
  expect(
    await cpf.evaluate(
      (field: HTMLInputElement) => field.validity.patternMismatch,
    ),
  ).toBe(true);
  await cpf.fill("01234567890");
  await save.click();
  await expect(dialog).not.toBeVisible();
  await edit.click();
  await expect(cpf).toHaveValue("012.345.678-90");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await person
    .getByRole("button", { name: "Gerenciar escalas", exact: true })
    .click();
  const withCpf = await downloadPdf("folha-com-cpf");
  expect(withCpf).toContain("CPF: 012.345.678-90");
  expect(withCpf).not.toContain(
    "Horário de trabalho no cabeçalho é referência",
  );
  expect(withCpf).not.toContain("Linhas escuras e riscadas:");
  expect(withCpf).toContain("Assinatura do funcionário");
  expect(withCpf).toContain("Cont Contábil");
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption("demo-company-beta");
  const otherEmployee = await downloadPdf("folha-outra-empresa-sem-cpf");
  expect(otherEmployee).toContain("CPF: Não informado");
  expect(otherEmployee).not.toContain("012.345.678-90");
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption("demo-company");
  await employeesTab.click();
  await edit.click();
  await cpf.fill("");
  await save.click();
  await expect(dialog).not.toBeVisible();
  await edit.click();
  await expect(cpf).toBeEmpty();
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await person
    .getByRole("button", { name: "Gerenciar escalas", exact: true })
    .click();
  const withoutCpf = await downloadPdf("folha-cpf-removido");
  expect(withoutCpf).toContain("CPF: Não informado");
  expect(withoutCpf).not.toContain("012.345.678-90");
  expect(errors).toEqual([]);
});
