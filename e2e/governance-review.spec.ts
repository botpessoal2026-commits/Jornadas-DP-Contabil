import { test, expect } from "@playwright/test";

const scheduleURL =
  "/?demo=1&empresa=demo-company&pagina=escalas&funcionario=demo-employee&mes=2026-12";

test("revisão da escala preserva pendências e exige justificativa para devolver ao rascunho", async ({
  page,
}) => {
  await page.goto(scheduleURL);
  const governance = page.getByRole("region", {
    name: "Revisão e publicação da escala",
    exact: true,
  });
  await expect(governance.locator('[aria-current="step"]')).toHaveText(
    "Rascunho",
  );
  await governance
    .getByRole("button", { name: "Encaminhar para revisão", exact: true })
    .click();
  await expect(governance.locator('[aria-current="step"]')).toHaveText(
    "Em revisão",
  );
  await expect(
    governance.getByRole("button", { name: "Aprovar escala", exact: true }),
  ).toBeDisabled();
  await governance.getByRole("checkbox").check();
  await expect(
    governance.getByRole("button", { name: "Aprovar escala", exact: true }),
  ).toBeDisabled();
  await expect(governance).toContainText("fontes e regras pendentes");
  const reopen = governance.getByRole("button", {
    name: "Reabrir como rascunho",
    exact: true,
  });
  await expect(reopen).toBeDisabled();
  await governance
    .getByRole("textbox", { name: /^Justificativa/ })
    .fill("Conferência adicional antes da publicação.");
  await reopen.click();
  await expect(governance.locator('[aria-current="step"]')).toHaveText(
    "Rascunho",
  );
  await expect(page.locator('[data-date="2026-12-01"]')).toContainText("17:24");
  await governance
    .getByRole("button", { name: "Consultar versões publicadas", exact: true })
    .click();
  await expect(governance).toContainText("Nenhuma versão publicada");
});

test("lote preserva prévias ao cancelar navegação e limpa o contexto após descarte confirmado", async ({
  page,
}) => {
  await page.goto(scheduleURL);
  await page
    .getByText("Gerar, editar e duplicar escalas em lote", { exact: true })
    .click();
  const bulk = page.getByRole("region", {
    name: "Operações em lote de escalas",
    exact: true,
  });
  await bulk
    .getByRole("checkbox", { name: "Mariana Costa", exact: true })
    .check();
  await bulk
    .getByLabel("Competência de destino", { exact: true })
    .fill("2027-01");
  await bulk
    .getByRole("button", { name: "Duplicar selecionados", exact: true })
    .click();
  const table = bulk.getByRole("table", {
    name: "Conferência das prévias selecionadas",
    exact: true,
  });
  await expect(table.getByRole("row")).toHaveCount(2);
  await page.getByLabel("Mês da escala", { exact: true }).fill("2027-02");
  const discard = page.getByRole("dialog", {
    name: "Descartar alterações não salvas?",
    exact: true,
  });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(page.getByLabel("Mês da escala", { exact: true })).toHaveValue(
    "2026-12",
  );
  await page.getByLabel("Mês da escala", { exact: true }).fill("2027-02");
  await discard.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByLabel("Mês da escala", { exact: true })).toHaveValue(
    "2027-02",
  );
  await expect(table).toHaveCount(0);
  await page
    .getByLabel("Empresa ativa", { exact: true })
    .selectOption("demo-company-beta");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Empresa ativa", { exact: true })).toHaveValue(
    "demo-company-beta",
  );
});
