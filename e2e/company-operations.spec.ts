import { test, expect, type Page } from "@playwright/test";

async function start(page: Page) {
  await page.goto("/?empresa=demo-company&pagina=operacoes&mes=2026-12&demo=1");
  const region = page.getByRole("region", {
    name: "Operação e conferência da empresa",
    exact: true,
  });
  await expect(region).toBeVisible();
  return region;
}

test("ausência só é conferida explicitamente e mantém isolamento da empresa", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  const region = await start(page);
  await region
    .getByRole("button", { name: "Novo registro", exact: true })
    .click();
  await region
    .getByRole("textbox", { name: "Título", exact: true })
    .fill("Ausência individual conferida");
  await region
    .getByRole("combobox", { name: "Funcionário", exact: true })
    .selectOption("demo-employee");
  await region
    .getByRole("button", { name: "Salvar para conferência", exact: true })
    .click();
  const card = region.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Ausência individual conferida",
      exact: true,
    }),
  });
  await expect(card).toContainText("Pendente de conferência");
  await card
    .getByRole("button", { name: "Conferir registro", exact: true })
    .click();
  await expect(card).toContainText("Conferido");
  await expect(card).toContainText(
    "dias com trabalho programado durante a ausência",
  );
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption("demo-company-beta");
  await expect(region).toBeVisible();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("empresa") === "demo-company-beta" &&
      url.searchParams.get("pagina") === "operacoes",
  );
  await expect(
    page.getByRole("heading", {
      name: "Ausência individual conferida",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("cobertura mostra lacunas sem presumir funcionários de outra empresa", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  const region = await start(page);
  await region.getByRole("button", { name: "Cobertura", exact: true }).click();
  await region
    .getByRole("button", { name: "Novo registro", exact: true })
    .click();
  await region
    .getByRole("textbox", { name: "Título", exact: true })
    .fill("Duas pessoas no atendimento");
  await region
    .getByRole("spinbutton", { name: "Pessoas mínimas", exact: true })
    .fill("2");
  await region
    .getByRole("button", { name: "Salvar para conferência", exact: true })
    .click();
  const card = region.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Duas pessoas no atendimento",
      exact: true,
    }),
  });
  await card
    .getByRole("button", { name: "Conferir registro", exact: true })
    .click();
  await expect(card).toContainText("faixas abaixo da cobertura mínima");
  await expect(card).toContainText("1/2 pessoas");
});

test("realizado começa vazio, diferencia zero de ausência e não preenche a folha automaticamente", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  const region = await start(page);
  await region
    .getByRole("button", { name: "Planejado × realizado", exact: true })
    .click();
  await region
    .getByRole("combobox", {
      name: "Funcionário para comparação e importação",
      exact: true,
    })
    .selectOption("demo-employee");
  await region
    .getByRole("button", { name: "Novo registro", exact: true })
    .click();
  await region
    .getByRole("textbox", { name: "Título", exact: true })
    .fill("Zero horas declarado");
  const periods = region.getByRole("textbox", {
    name: "Períodos efetivamente registrados",
    exact: true,
  });
  await expect(periods).toHaveValue("");
  await region
    .getByRole("button", { name: "Salvar para conferência", exact: true })
    .click();
  await expect(region.getByRole("alert")).toContainText("zero horas");
  await region
    .getByRole("checkbox", {
      name: "Confirmo zero horas efetivamente registradas nesta data",
      exact: true,
    })
    .check();
  await region
    .getByRole("button", { name: "Salvar para conferência", exact: true })
    .click();
  const card = region.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Zero horas declarado",
      exact: true,
    }),
  });
  await card
    .getByRole("button", { name: "Conferir registro", exact: true })
    .click();
  await region
    .getByText("Comparar planejado × realizado — 2026-12", { exact: true })
    .click();
  const row = region.getByRole("row").filter({
    has: page.getByRole("cell", { name: "01/12/2026", exact: true }),
  });
  await expect(row).toContainText("0h00");
  await expect(
    region.getByRole("row").filter({
      has: page.getByRole("cell", { name: "02/12/2026", exact: true }),
    }),
  ).toContainText("Não informado");
});

test("documento rejeita URL insegura e troca rejeita o mesmo vínculo", async ({
  page,
}) => {
  const region = await start(page);
  await region.getByRole("button", { name: "Documentos", exact: true }).click();
  await region
    .getByRole("button", { name: "Novo registro", exact: true })
    .click();
  await region
    .getByRole("textbox", { name: "Título", exact: true })
    .fill("Instrumento de conferência");
  await region
    .getByRole("textbox", { name: "Fonte / publicação", exact: true })
    .fill("Documento informado");
  await region
    .getByRole("textbox", {
      name: "Endereço HTTPS do documento (opcional)",
      exact: true,
    })
    .fill("http://example.com/documento.pdf");
  await region
    .getByRole("button", { name: "Salvar para conferência", exact: true })
    .click();
  await expect(region.getByRole("alert")).toContainText("HTTPS");
  page.once("dialog", (dialog) => dialog.accept());
  await region
    .getByRole("button", { name: "Solicitações de troca", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Novo registro", exact: true })
    .click();
  await region
    .getByRole("textbox", { name: "Título", exact: true })
    .fill("Troca inválida");
  await region
    .getByRole("combobox", { name: "Funcionário", exact: true })
    .selectOption("demo-employee");
  await region
    .getByRole("combobox", { name: "Outro funcionário", exact: true })
    .selectOption("demo-employee");
  await region
    .getByRole("textbox", { name: "Justificativa", exact: true })
    .fill("Teste do mesmo vínculo");
  await region
    .getByRole("button", { name: "Salvar para conferência", exact: true })
    .click();
  await expect(region.getByRole("alert")).toContainText(
    "outro funcionário ativo da mesma empresa",
  );
});
