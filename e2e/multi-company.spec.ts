import { test, expect, type Page } from "@playwright/test";

const alpha = "Aurora Contabilidade";
const beta = "Horizonte Serviços";
const alphaId = "demo-company";
const betaId = "demo-company-beta";

async function sidebar(page: Page, name: string) {
  const mobileMenu = page.getByRole("button", {
    name: "Abrir menu",
    exact: true,
  });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name, exact: true })
    .click();
}
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar demonstração" }).click();
  await sidebar(page, "Empresas");
}
async function enterCompany(page: Page, name = alpha) {
  await page
    .locator(".company-card")
    .filter({ hasText: name })
    .getByRole("button", { name: "Acessar empresa", exact: true })
    .click();
}
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
async function confirm(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}

// Context switching exercises actual UI state; persistence/RLS is covered in SQL tests.
test("cada administração mostra somente seus vínculos ao trocar a empresa ativa", async ({
  page,
}) => {
  await start(page);
  await expect(page.locator(".company-card")).toHaveCount(2);
  await enterCompany(page);
  await tab(page, "Funcionários");
  await expect(page.locator(".employee-card")).toHaveCount(1);
  await expect(page.locator(".employee-card")).toContainText("Mariana Costa");
  await expect(page.locator(".employee-card")).not.toContainText("Rafael Lima");
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption(betaId);
  await expect(page.locator(".employee-card")).toHaveCount(1);
  await expect(page.locator(".employee-card")).toContainText("Rafael Lima");
  await expect(page.locator(".employee-card")).not.toContainText(
    "Mariana Costa",
  );
  await tab(page, "Jornadas e modelos");
  await expect(
    page.getByRole("heading", { name: "Administrativo · 30h", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption(alphaId);
  await expect(
    page.getByRole("heading", { name: "Administrativo · 30h", exact: true }),
  ).not.toBeVisible();
});

test("empresa mínima aceita CNPJ vazio e funcionário novo fica no vínculo contextual", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("button", { name: "Cadastrar nova empresa", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Nome da empresa / razão social", { exact: true })
    .fill("Empresa Nova sem CNPJ");
  await saveForm(page);
  await enterCompany(page, "Empresa Nova sem CNPJ");
  await tab(page, "Funcionários");
  await page
    .getByRole("button", { name: "Adicionar funcionário", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("combobox", { name: "Empresa", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog
      .getByRole("combobox", { name: "Empresa", exact: true })
      .locator("option:checked"),
  ).toHaveText("Empresa Nova sem CNPJ");
  await dialog
    .getByLabel("Nome do funcionário", { exact: true })
    .fill("Camila do Novo Vínculo");
  await dialog
    .getByLabel("Matrícula / identificador interno", { exact: true })
    .fill("N-001");
  await dialog
    .getByLabel("Setor / departamento", { exact: true })
    .fill("Pessoal");
  await dialog.getByLabel("Cargo", { exact: true }).fill("Assistente");
  await dialog
    .getByLabel("Carga diária contratual (horas)", { exact: true })
    .fill("6");
  await dialog
    .getByRole("spinbutton", { name: "Carga semanal contratual (horas)" })
    .fill("30");
  await dialog
    .getByRole("combobox", {
      name: "Modelo individual de jornada",
      exact: true,
    })
    .selectOption("demo-model-0");
  await saveForm(page);
  const card = page
    .locator(".employee-card")
    .filter({ hasText: "Camila do Novo Vínculo" });
  await expect(card).toContainText("30h00 / semana");
  await card
    .getByRole("button", { name: "Editar funcionário", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Matrícula / identificador interno", { exact: true }),
  ).toHaveValue("N-001");
  await expect(
    dialog.getByRole("combobox", {
      name: "Modelo individual de jornada",
      exact: true,
    }),
  ).toHaveValue("demo-model-0");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await card
    .getByRole("button", { name: "Visualizar funcionário", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Página do funcionário" }),
  ).toContainText("6h00");
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption(betaId);
  await tab(page, "Funcionários");
  await expect(page.locator(".employee-card")).not.toContainText(
    "Camila do Novo Vínculo",
  );
});

test("modelo individual continua prioritário quando o padrão empresarial muda", async ({
  page,
}) => {
  await start(page);
  await enterCompany(page);
  await tab(page, "Funcionários");
  await page
    .locator(".employee-card")
    .filter({ hasText: "Mariana Costa" })
    .getByRole("button", { name: "Editar funcionário", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", {
      name: "Modelo individual de jornada",
      exact: true,
    })
    .selectOption("demo-model-0");
  await saveForm(page);
  await tab(page, "Configurações");
  await page
    .getByRole("button", { name: "Editar configurações", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Modelo padrão da empresa", exact: true })
    .selectOption("demo-model-1");
  await saveForm(page);
  await tab(page, "Funcionários");
  const person = page
    .locator(".employee-card")
    .filter({ hasText: "Mariana Costa" });
  await expect(person).toContainText("5×2 · 42h · seg a sex · individual");
  await person
    .getByRole("button", { name: "Gerenciar escalas", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Modelo de jornada", exact: true }),
  ).toHaveValue("demo-model-0");
  // Cadastro padrão não reescreve a competência que já foi salva.
  await expect(page.locator('[data-date="2026-12-01"]')).toContainText("17:24");
  await expect(
    page.getByRole("button", { name: "Escala salva", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Gerar prévia", exact: true }).click();
  await expect(page.locator('[data-date="2026-12-01"]')).toContainText("17:24");
});

test("arquivamento exige confirmação e preserva consulta com operações bloqueadas", async ({
  page,
}) => {
  await start(page);
  await enterCompany(page);
  await tab(page, "Configurações");
  await page
    .getByRole("button", { name: "Arquivar empresa", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "histórico serão preservados",
  );
  await confirm(page);
  await tab(page, "Funcionários");
  await expect(page.locator(".employee-card")).toContainText("Mariana Costa");
  await expect(
    page.getByRole("button", { name: "Adicionar funcionário", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Editar funcionário", exact: true }),
  ).toBeDisabled();
  await tab(page, "Escalas");
  await expect(
    page.getByRole("button", { name: "Gerar prévia", exact: true }),
  ).toBeDisabled();
  await expect(page.locator('[data-date="2026-12-01"]')).toBeDisabled();
  await expect(page.locator('[data-date="2026-12-01"]')).toContainText("17:24");
  await page
    .getByRole("button", { name: "Reativar empresa", exact: true })
    .first()
    .click();
  await confirm(page);
  await expect(
    page.getByRole("button", { name: "Gerar prévia", exact: true }),
  ).toBeEnabled();
  await expect(page.locator('[data-date="2026-12-01"]')).toBeEnabled();
});

test("troca de empresa pede descarte e nunca leva ajustes locais para outra empresa", async ({
  page,
}) => {
  await start(page);
  await enterCompany(page);
  await tab(page, "Escalas");
  await page.locator('[data-date="2026-12-01"]').click();
  await page
    .getByRole("dialog")
    .getByLabel("Saída", { exact: true })
    .fill("18:00");
  await page
    .getByRole("button", { name: "Salvar na prévia", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption(betaId);
  const discard = page.getByRole("dialog", {
    name: "Descartar alterações não salvas?",
    exact: true,
  });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Empresa ativa", exact: true }),
  ).toHaveValue(alphaId);
  await expect(page.locator('[data-date="2026-12-01"]')).toContainText("18:00");
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption(betaId);
  await confirm(page);
  await expect(page.locator('[data-date="2026-12-01"]')).toContainText("15:00");
  await expect(page.locator('[data-date="2026-12-01"]')).not.toContainText(
    "18:00",
  );
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption(alphaId);
  await expect(page.locator('[data-date="2026-12-01"]')).toContainText("17:24");
  await expect(page.locator('[data-date="2026-12-01"]')).not.toContainText(
    "18:00",
  );
});

test("personalizar referência compartilhada cria modelo próprio sem editar a outra empresa", async ({
  page,
}) => {
  await start(page);
  await enterCompany(page);
  await tab(page, "Jornadas e modelos");
  const reference = page.locator("section.panel").filter({
    has: page.getByRole("heading", {
      name: "5×2 · 42h · seg a sex",
      exact: true,
    }),
  });
  await reference
    .getByRole("button", { name: "Personalizar nesta empresa", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("combobox", { name: "Disponível para", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("combobox", { name: "Disponível para", exact: true }),
  ).toHaveValue(alphaId);
  await dialog
    .getByLabel("Nome do modelo", { exact: true })
    .fill("Exclusivo Aurora Teste");
  await dialog
    .getByLabel("Horários de Segunda", { exact: true })
    .fill("09:00-12:00, 13:00-17:00");
  await saveForm(page);
  await expect(
    page.getByRole("heading", { name: "Exclusivo Aurora Teste", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "5×2 · 42h · seg a sex", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption(betaId);
  await expect(
    page.getByRole("heading", { name: "Exclusivo Aurora Teste", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "5×2 · 42h · seg a sex", exact: true }),
  ).toBeVisible();
  await tab(page, "Escalas");
  await expect(page.locator('[data-date="2026-12-01"]')).toContainText("15:00");
});

test("histórico mostra autor e alterações do contexto correto", async ({
  page,
}) => {
  await start(page);
  await enterCompany(page);
  await tab(page, "Funcionários");
  await page
    .locator(".employee-card")
    .getByRole("button", { name: "Editar funcionário", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Setor / departamento", { exact: true })
    .fill("Setor exclusivo Aurora");
  await saveForm(page);
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption(betaId);
  await page
    .locator(".employee-card")
    .getByRole("button", { name: "Editar funcionário", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Setor / departamento", { exact: true })
    .fill("Setor exclusivo Horizonte");
  await saveForm(page);
  await tab(page, "Histórico");
  const history = page.getByRole("region", {
    name: "Histórico de alterações",
    exact: true,
  });
  await expect(history).toContainText(beta);
  await expect(history).toContainText("Ação local na demonstração");
  await history.getByText("Ver campos e alterações", { exact: true }).click();
  await expect(history).toContainText("Setor exclusivo Horizonte");
  await expect(history).not.toContainText("Setor exclusivo Aurora");
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption(alphaId);
  await expect(history).toContainText(alpha);
  await expect(history).not.toContainText("Setor exclusivo Horizonte");
});

for (const width of [375, 390]) {
  test(`administração contextual móvel ${width}px mantém controles e horários acessíveis`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await start(page);
    await expect(page.locator(".company-card")).toHaveCount(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await enterCompany(page);
    for (const name of ["Funcionários", "Feriados", "Escalas"]) {
      await tab(page, name);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        name,
      ).toBeLessThanOrEqual(width);
      await expect(
        page.getByRole("combobox", { name: "Empresa ativa", exact: true }),
      ).toBeVisible();
    }
    const day = page.locator('[data-date="2026-12-01"]');
    await expect(day.getByText("08:00 — 12:00", { exact: true })).toBeVisible();
    await expect(day.getByText("13:00 — 17:24", { exact: true })).toBeVisible();
    await day.click();
    await expect(
      page.getByRole("dialog").getByLabel("Entrada", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await sidebar(page, "Empresas");
    await expect(
      page.getByRole("heading", { name: "Empresas", exact: true }),
    ).toBeVisible();
  });
}

test("sair e reabrir demonstração limpa contexto empresarial anterior", async ({
  page,
}) => {
  await start(page);
  await enterCompany(page, beta);
  await tab(page, "Funcionários");
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Sair", exact: true })
    .click();
  await page.getByRole("button", { name: "Explorar demonstração" }).click();
  await expect(
    page.getByRole("combobox", { name: "Empresa ativa", exact: true }),
  ).toHaveValue("");
  await expect(page.locator(".company-context")).toHaveCount(0);
  await sidebar(page, "Escalas mensais");
  await expect(
    page.getByRole("combobox", { name: "Funcionário", exact: true }),
  ).toHaveValue("demo-employee");
  await expect(page.locator('[data-date="2026-12-01"]')).toContainText("17:24");
});

test("feriados oficiais da empresa seguem localização sem alterar cadastro compartilhado", async ({
  page,
}) => {
  await start(page);
  await enterCompany(page);
  await tab(page, "Feriados");
  await expect(
    page.getByRole("cell", {
      name: "Data Magna de Pernambuco — conferir calendário local",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page
      .getByRole("button", { name: "Editar", exact: true })
      .evaluateAll((buttons) =>
        buttons.every((button) => (button as HTMLButtonElement).disabled),
      ),
  ).toBe(true);
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption(betaId);
  await expect(
    page.getByRole("cell", {
      name: "Data Magna de Pernambuco — conferir calendário local",
      exact: true,
    }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Natal", exact: true }),
  ).toBeVisible();
});
