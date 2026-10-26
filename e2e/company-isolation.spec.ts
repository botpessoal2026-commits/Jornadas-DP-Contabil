import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";

const alphaId = "demo-company";
const betaId = "demo-company-beta";
const baseModel = "5×2 · 42h · seg a sex";

async function tab(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Administração da empresa", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}

async function saveForm(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}

async function selectCompany(page: Page, id: string, discardPreview = false) {
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption(id);
  if (discardPreview)
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirmar", exact: true })
      .click();
  await expect(
    page.getByRole("combobox", { name: "Empresa ativa", exact: true }),
  ).toHaveValue(id);
}

function cardWithHeading(page: Page, region: Locator, name: string) {
  return region
    .locator(".panel")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .last();
}

async function expectCompanyUrl(page: Page, companyId: string, view: string) {
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("empresa") === companyId &&
      url.searchParams.get("pagina") === view,
  );
}

test("URL e recarga preservam a empresa; identificador indisponível não revela o contexto anterior", async ({
  page,
}, testInfo) => {
  await page.goto(`/?empresa=${betaId}&pagina=modelos&mes=2026-12&demo=1`);
  await expect(
    page.getByRole("region", { name: "Empresa em administração", exact: true }),
  ).toContainText("Horizonte Serviços");
  await expect(
    page.getByRole("region", { name: "Modelos da empresa", exact: true }),
  ).toContainText("Administrativo · 30h");
  await page.screenshot({
    path: testInfo.outputPath("ambiente-empresa-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: testInfo.outputPath("ambiente-empresa-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expectCompanyUrl(page, betaId, "modelos");
  await expect(
    page.getByRole("combobox", { name: "Empresa ativa", exact: true }),
  ).toHaveValue(betaId);
  await tab(page, "Funcionários");
  await expectCompanyUrl(page, betaId, "funcionarios");
  await expect(page.locator(".employee-card")).toContainText("Rafael Lima");
  await expect(page.locator(".employee-card")).not.toContainText(
    "Mariana Costa",
  );
  await page.goto(
    `/?empresa=${alphaId}&pagina=employee-detail&funcionario=demo-employee-beta&demo=1&mes=2026-12`,
  );
  await expect(
    page.getByRole("region", { name: "Empresa em administração", exact: true }),
  ).toContainText("Aurora Contabilidade");
  await expect(
    page.getByText("Funcionário não disponível nesta empresa.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".employee-detail")).toHaveCount(0);
  await page.goto(
    "/?empresa=empresa-sem-acesso&pagina=funcionarios&demo=1&mes=2026-12",
  );
  await expect(
    page.getByRole("heading", { name: "Empresa não disponível", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".employee-card")).toHaveCount(0);
  await expect(page.locator(".company-context")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Todas as empresas", exact: true })
    .click();
  await expect(page.locator(".company-card")).toHaveCount(2);
  await expect(page).toHaveURL((url) => !url.searchParams.has("empresa"));
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Parâmetros legais", exact: true })
    .click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("pagina") === "regras" &&
      !url.searchParams.has("empresa"),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Parâmetros legais", exact: true }),
  ).toBeVisible();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Escalas mensais", exact: true })
    .click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("pagina") === "escalas" &&
      !url.searchParams.has("empresa"),
  );
  await page.reload();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("pagina") === "escalas" &&
      !url.searchParams.has("empresa"),
  );
  await expect(
    page.getByRole("heading", { name: "Escalas de trabalho", exact: true }),
  ).toBeVisible();
  await selectCompany(page, betaId);
  await expectCompanyUrl(page, betaId, "escalas");
  await tab(page, "Configurações");
  await expectCompanyUrl(page, betaId, "company-settings");
  await page
    .getByRole("button", { name: "Arquivar empresa", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expectCompanyUrl(page, betaId, "escalas");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Empresa ativa", exact: true }),
  ).toHaveValue(betaId);
  await expect(
    page.getByRole("button", { name: "Gerar prévia", exact: true }),
  ).toBeEnabled();
});

test("nova empresa começa sem vínculos e utiliza uma cópia própria da biblioteca", async ({
  page,
}) => {
  await page.goto("/?pagina=empresas&demo=1&mes=2026-12");
  await page
    .getByRole("button", { name: "Cadastrar nova empresa", exact: true })
    .click();
  const companyName = "Empresa Independente E2E";
  await page
    .getByRole("dialog")
    .getByLabel("Nome da empresa / razão social", { exact: true })
    .fill(companyName);
  await saveForm(page);
  const companyCard = page
    .locator(".company-card")
    .filter({ hasText: companyName });
  if (await companyCard.isVisible())
    await companyCard
      .getByRole("button", { name: "Acessar empresa", exact: true })
      .click();
  await expect(
    page.getByRole("region", { name: "Empresa em administração", exact: true }),
  ).toContainText(companyName);
  const createdId = await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .inputValue();
  expect(createdId).not.toBe(alphaId);
  expect(createdId).not.toBe(betaId);
  expect(createdId).not.toBe("");
  await tab(page, "Funcionários");
  await expect(page.locator(".employee-card")).toHaveCount(0);
  await tab(page, "Jornadas e modelos");
  const own = page.getByRole("region", {
    name: "Modelos da empresa",
    exact: true,
  });
  const library = page.getByRole("region", {
    name: "Biblioteca de modelos-base",
    exact: true,
  });
  await expect(
    own.getByRole("button", { name: "Editar modelo", exact: true }),
  ).toHaveCount(0);
  const reference = cardWithHeading(page, library, baseModel);
  const original = await reference.innerText();
  await reference
    .getByRole("button", { name: "Personalizar nesta empresa", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const company = dialog.getByRole("combobox", {
    name: "Disponível para",
    exact: true,
  });
  await expect(company).toBeDisabled();
  await expect(company).toHaveValue(createdId);
  const ownName = "Jornada da empresa independente E2E";
  await dialog.getByLabel("Nome do modelo", { exact: true }).fill(ownName);
  await dialog
    .getByLabel("Horários de Segunda", { exact: true })
    .fill("09:00-12:00, 13:00-17:00");
  await saveForm(page);
  await expect(
    own.getByRole("heading", { name: ownName, exact: true }),
  ).toBeVisible();
  await expect(reference).toHaveText(original, { useInnerText: true });
  await tab(page, "Funcionários");
  await page
    .getByRole("button", { name: "Adicionar funcionário", exact: true })
    .click();
  await expect(
    dialog.getByRole("combobox", { name: "Empresa", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("combobox", { name: "Empresa", exact: true }),
  ).toHaveValue(createdId);
  const model = dialog.getByRole("combobox", {
    name: "Modelo individual de jornada",
    exact: true,
  });
  await expect(
    model.locator("option").filter({ hasText: baseModel }),
  ).toHaveCount(0);
  await model.selectOption({ label: ownName });
  await dialog
    .getByLabel("Nome do funcionário", { exact: true })
    .fill("Pessoa do Ambiente E2E");
  await saveForm(page);
  await expect(page.locator(".employee-card")).toContainText(
    "Pessoa do Ambiente E2E",
  );
  await tab(page, "Jornadas e modelos");
  await expect(
    cardWithHeading(page, own, ownName).getByRole("button", {
      name: "Excluir modelo",
      exact: true,
    }),
  ).toBeDisabled();
  await selectCompany(page, betaId);
  await tab(page, "Funcionários");
  await expect(page.locator(".employee-card")).not.toContainText(
    "Pessoa do Ambiente E2E",
  );
  await tab(page, "Jornadas e modelos");
  await expect(own).not.toContainText(ownName);
  await expect(own).toContainText("Administrativo · 30h");
  await expect(cardWithHeading(page, library, baseModel)).toHaveText(original, {
    useInnerText: true,
  });
});

test("feriado próprio altera somente a prévia da empresa de origem", async ({
  page,
}) => {
  await page.goto(`/?empresa=${alphaId}&pagina=feriados&demo=1&mes=2026-12`);
  await page.getByRole("button", { name: "Novo feriado", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const holiday = "Data exclusiva da Aurora E2E";
  await dialog.getByLabel("Nome do feriado", { exact: true }).fill(holiday);
  await dialog.getByLabel("Data", { exact: true }).fill("2026-12-01");
  await dialog
    .getByRole("combobox", { name: "Abrangência", exact: true })
    .selectOption("municipal");
  await dialog
    .getByLabel("UF (estadual ou municipal)", { exact: true })
    .fill("PE");
  await dialog.getByLabel("Cidade (municipal)", { exact: true }).fill("Recife");
  await saveForm(page);
  const own = page.getByRole("region", {
    name: "Feriados da empresa",
    exact: true,
  });
  await expect(own).toContainText(holiday);
  await expect(
    page.getByRole("region", {
      name: "Referências gerais de feriados",
      exact: true,
    }),
  ).not.toContainText(holiday);
  await tab(page, "Escalas");
  await page.getByRole("button", { name: "Gerar prévia", exact: true }).click();
  const day = page.locator('[data-date="2026-12-01"]');
  await expect(day).toContainText(holiday);
  await expect(day).toContainText("Folga");
  await selectCompany(page, betaId, true);
  await expect(day).toContainText("15:00");
  await expect(day).not.toContainText(holiday);
  await tab(page, "Feriados");
  await expect(own).not.toContainText(holiday);
  await expect(
    page.getByRole("region", {
      name: "Referências gerais de feriados",
      exact: true,
    }),
  ).toContainText("Natal");
  await selectCompany(page, alphaId);
  await expect(own).toContainText(holiday);
});

test("parâmetros particulares afetam apenas a conferência da respectiva empresa", async ({
  page,
}) => {
  await page.goto(
    `/?empresa=${alphaId}&pagina=company-settings&demo=1&mes=2026-12`,
  );
  await page
    .getByRole("button", {
      name: "Parâmetros legais desta empresa",
      exact: true,
    })
    .click();
  const general = page.getByRole("region", {
    name: "Parâmetros gerais aplicáveis",
    exact: true,
  });
  const original = general.locator(".legal-card").filter({
    has: page.getByRole("heading", {
      name: "Divisor mensal de referência",
      exact: true,
    }),
  });
  const originalText = await original.innerText();
  await original
    .getByRole("button", { name: "Personalizar nesta empresa", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Nome da regra", { exact: true })
    .fill("Divisor exclusivo Aurora E2E");
  await dialog
    .getByLabel("Início da vigência", { exact: true })
    .fill("2026-12-01");
  await dialog
    .getByLabel("Fator multiplicador da carga semanal", { exact: true })
    .fill("7");
  await saveForm(page);
  const own = page.getByRole("region", {
    name: "Parâmetros legais da empresa",
    exact: true,
  });
  await expect(own).toContainText("Divisor exclusivo Aurora E2E");
  await expect(original).toHaveText(originalText, { useInnerText: true });
  await tab(page, "Escalas");
  const divisor = page.locator(".stat").filter({ hasText: "Divisor mensal" });
  await expect(divisor).toContainText("308 / 294");
  await selectCompany(page, betaId);
  await expect(divisor).toContainText("220 / 210");
  await tab(page, "Configurações");
  await page
    .getByRole("button", {
      name: "Parâmetros legais desta empresa",
      exact: true,
    })
    .click();
  await expect(own).not.toContainText("Divisor exclusivo Aurora E2E");
  await page.getByRole("button", { name: "Nova regra", exact: true }).click();
  await dialog
    .getByLabel("Nome da regra", { exact: true })
    .fill("Divisor exclusivo Horizonte E2E");
  await dialog
    .getByRole("combobox", { name: "Grupo do parâmetro", exact: true })
    .selectOption("divisor");
  await dialog
    .getByLabel("Início da vigência", { exact: true })
    .fill("2026-12-01");
  await dialog
    .getByLabel("Fonte / publicação oficial", { exact: true })
    .fill("Fonte fictícia de teste de isolamento");
  await dialog
    .getByLabel("Fator multiplicador da carga semanal", { exact: true })
    .fill("6");
  await saveForm(page);
  await tab(page, "Escalas");
  await expect(divisor).toContainText("264 / 252");
  await selectCompany(page, alphaId);
  await expect(divisor).toContainText("308 / 294");
});

test("detalhe do funcionário emite folha com CPF somente do vínculo da empresa ativa", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `/?empresa=${alphaId}&pagina=funcionarios&demo=1&mes=2026-12`,
  );
  const person = page.locator(".employee-card");
  await person
    .getByRole("button", { name: "Editar funcionário", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("CPF (opcional)", { exact: true })
    .fill("01234567890");
  await saveForm(page);
  await person
    .getByRole("button", { name: "Visualizar funcionário", exact: true })
    .click();
  const details = page.getByRole("region", {
    name: "Página do funcionário",
    exact: true,
  });
  await expect(details).toContainText("Mariana Costa");
  await expect(details).toContainText("012.345.678-90");
  const downloadFromDetails = async (name: string) => {
    const pending = page.waitForEvent("download");
    await details
      .getByRole("button", { name: "Emitir folha de ponto", exact: true })
      .click();
    const download = await pending;
    const path = testInfo.outputPath(`${name}.pdf`);
    await download.saveAs(path);
    expect(await download.failure()).toBeNull();
    return (await readFile(path)).toString("latin1");
  };
  const alphaPdf = await downloadFromDetails("folha-detalhe-aurora");
  expect(alphaPdf).toContain("Aurora Contabilidade");
  expect(alphaPdf).toContain("Mariana Costa");
  expect(alphaPdf).toContain("CPF: 012.345.678-90");
  expect(alphaPdf).toContain("Assinatura do funcionário");
  expect(alphaPdf).not.toContain("Rafael Lima");
  await selectCompany(page, betaId);
  await tab(page, "Funcionários");
  await person
    .getByRole("button", { name: "Visualizar funcionário", exact: true })
    .click();
  await expect(details).toContainText("Rafael Lima");
  await expect(details).not.toContainText("012.345.678-90");
  const betaPdf = await downloadFromDetails("folha-detalhe-horizonte");
  expect(betaPdf).toContain("Horizonte");
  expect(betaPdf).toContain("Rafael Lima");
  expect(betaPdf).toContain("CPF: Não informado");
  expect(betaPdf).not.toContain("012.345.678-90");
  expect(betaPdf).not.toContain("Mariana Costa");
  expect(errors).toEqual([]);
});
