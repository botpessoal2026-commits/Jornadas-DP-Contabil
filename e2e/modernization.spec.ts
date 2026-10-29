import { test, expect, type Page } from "@playwright/test";

const scheduleURL =
  "/?demo=1&empresa=demo-company&pagina=escalas&funcionario=demo-employee&mes=2026-12";
const calls = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  calls.set(page, []);
  await page.route(/https:\/\/[^/]*supabase\.(co|in)\//, async (route) => {
    calls.get(page)!.push(route.request().url());
    await route.abort();
  });
});
test.afterEach(async ({ page }) => {
  expect(calls.get(page)).toEqual([]);
});

async function newModel(page: Page) {
  await page.goto("/?demo=1&empresa=demo-company&pagina=modelos&mes=2026-12");
  await page.getByRole("button", { name: "Novo modelo", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const simulator = dialog.locator(".schedule-simulator");
  await simulator.locator("summary").click();
  return { dialog, simulator };
}

test("modernização: simulador calcula 42h em cinco dias e só altera campos após aplicação explícita", async ({
  page,
}) => {
  const { dialog, simulator } = await newModel(page);
  const monday = dialog.getByLabel("Horários de Segunda", { exact: true });
  await monday.fill("09:00-12:00, 13:00-18:00");
  await simulator
    .getByLabel("Carga semanal desejada", { exact: true })
    .fill("42:00");
  await simulator
    .getByRole("button", { name: "Calcular proposta", exact: true })
    .click();
  await expect(
    simulator.getByText("Total exato: 42h00", { exact: true }),
  ).toBeVisible();
  await expect(
    simulator.getByRole("table", {
      name: "Proposta de horários por dia da semana",
      exact: true,
    }),
  ).toContainText("8h24");
  await expect(monday).toHaveValue("09:00-12:00, 13:00-18:00");
  await simulator
    .getByRole("button", { name: "Aplicar proposta ao modelo", exact: true })
    .click();
  for (const day of ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"])
    await expect(
      dialog.getByLabel(`Horários de ${day}`, { exact: true }),
    ).toHaveValue("08:00-12:00, 13:00-17:24");
  await expect(
    dialog.getByText("Total semanal: 42h00", { exact: true }),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Nome do modelo", { exact: true })
    .fill("Distribuição matemática de 42 horas");
  await dialog
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Distribuição matemática de 42 horas",
      exact: true,
    }),
  ).toBeVisible();
});

test("modernização: minutos residuais são distribuídos sem perder o total semanal", async ({
  page,
}) => {
  const { dialog, simulator } = await newModel(page);
  await simulator
    .getByLabel("Carga semanal desejada", { exact: true })
    .fill("40:01");
  await simulator
    .getByRole("checkbox", { name: "Sábado", exact: true })
    .check();
  await simulator
    .getByRole("button", { name: "Calcular proposta", exact: true })
    .click();
  const proposal = simulator.getByRole("table", {
    name: "Proposta de horários por dia da semana",
    exact: true,
  });
  await expect(
    simulator.getByText("Total exato: 40h01", { exact: true }),
  ).toBeVisible();
  await expect(
    proposal.getByRole("row").filter({
      has: page.getByRole("cell", { name: "Segunda", exact: true }),
    }),
  ).toContainText("6h41");
  await expect(
    proposal.getByRole("cell", { name: "6h40", exact: true }),
  ).toHaveCount(5);
  await simulator
    .getByRole("button", { name: "Aplicar proposta ao modelo", exact: true })
    .click();
  await expect(
    dialog.getByText("Total semanal: 40h01", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Horários de Sábado", { exact: true }),
  ).toHaveValue("08:00-12:00, 13:00-15:40");
});

test("modernização: simulador mantém offsets noturnos e não apresenta proposta sem dias de trabalho", async ({
  page,
}) => {
  const { dialog, simulator } = await newModel(page);
  await simulator.getByLabel("Início do turno", { exact: true }).fill("22:00");
  await simulator
    .getByRole("button", { name: "Calcular proposta", exact: true })
    .click();
  await expect(
    simulator.getByRole("table", {
      name: "Proposta de horários por dia da semana",
      exact: true,
    }),
  ).toContainText("22:00-02:00 +1, 03:00 +1-07:24 +1");
  await simulator
    .getByRole("button", { name: "Aplicar proposta ao modelo", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Horários de Segunda", { exact: true }),
  ).toHaveValue("22:00-02:00 +1, 03:00 +1-07:24 +1");
  await expect(
    dialog.getByText("Total semanal: 42h00", { exact: true }),
  ).toBeVisible();
  for (const day of ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"])
    await simulator.getByRole("checkbox", { name: day, exact: true }).uncheck();
  await simulator
    .getByRole("button", { name: "Calcular proposta", exact: true })
    .click();
  await expect(simulator.getByRole("alert")).toBeVisible();
  await expect(
    simulator.getByRole("button", {
      name: "Aplicar proposta ao modelo",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    dialog.getByLabel("Horários de Segunda", { exact: true }),
  ).toHaveValue("22:00-02:00 +1, 03:00 +1-07:24 +1");
});

test("modernização: menu lateral recolhe sem perder navegação e mantém preferência após recarga", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(scheduleURL);
  const menu = page.locator(".workspace-sidebar");
  await expect(
    menu.getByRole("navigation", { name: "Áreas de trabalho", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Recolher menu lateral", exact: true })
    .click();
  await expect(menu).toHaveClass(/is-collapsed/);
  await expect(
    page.getByRole("button", { name: "Expandir menu lateral", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await menu
    .getByRole("button", { name: "Modelos de jornada", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Jornadas e modelos", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(menu).toHaveClass(/is-collapsed/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Expandir menu lateral", exact: true })
    .click();
  await expect(menu).not.toHaveClass(/is-collapsed/);
});

test("modernização: menu móvel fecha por Escape e devolve o foco ao botão de abertura", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(scheduleURL);
  const opener = page.getByRole("button", { name: "Abrir menu", exact: true });
  await opener.click();
  const menu = page.getByRole("dialog", {
    name: "Menu principal",
    exact: true,
  });
  await expect(menu).toBeVisible();
  const close = menu.getByRole("button", { name: "Fechar menu", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    menu.getByRole("button", { name: "Sair", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(opener).toBeFocused();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("modernização: trabalho noturno é informativo enquanto descanso insuficiente continua bloqueante", async ({
  page,
}) => {
  await page.goto(scheduleURL);
  await page.locator('[data-date="2026-12-01"]').click();
  const editor = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Editar dia da escala",
      exact: true,
    }),
  });
  await editor
    .getByRole("button", {
      name: "Editar períodos adicionais em texto",
      exact: true,
    })
    .click();
  await editor
    .getByLabel("Intervalos de trabalho (vazio = folga)", { exact: true })
    .fill("22:00-02:00 +1, 03:00 +1-06:00 +1");
  await editor
    .getByRole("button", { name: "Salvar na prévia", exact: true })
    .click();
  const alerts = page.getByRole("region", {
    name: "Conferência da escala",
    exact: true,
  });
  await expect(
    alerts.getByRole("heading", { name: "Bloqueantes", exact: true }),
  ).toBeVisible();
  const informational = alerts.getByTestId("informative-alerts");
  await informational.locator(":scope > summary").click();
  await expect(informational).toContainText("Trabalho noturno");
  await expect(informational).toContainText("não representam irregularidade");
  await expect(alerts.getByTestId("pending-sources")).toBeVisible();
});

test("modernização: ciência dos alertas não permite aprovar regra jurídica ainda pendente", async ({
  page,
}) => {
  await page.goto(scheduleURL);
  const governance = page.getByRole("region", {
    name: "Revisão e publicação da escala",
    exact: true,
  });
  await governance
    .getByRole("button", { name: "Encaminhar para revisão", exact: true })
    .click();
  await governance.getByRole("checkbox").check();
  await governance
    .getByRole("textbox", { name: /^Justificativa/ })
    .fill("Conferi a prévia; documento jurídico ainda está pendente.");
  await expect(
    governance.getByRole("button", { name: "Aprovar escala", exact: true }),
  ).toBeDisabled();
  await expect(governance).toContainText("fontes e regras pendentes");
  await expect(governance.locator('[aria-current="step"]')).toHaveText(
    "Em revisão",
  );
});

test("modernização: referências oficiais usam 16 de dezembro sem simular confirmação ou sobrescrever cadastros", async ({
  page,
}) => {
  await page.goto("/?demo=1&pagina=regras&mes=2026-12");
  const cards = page.locator(".legal-card");
  const before = await cards.allTextContents();
  await expect(
    page.getByText(/Vigência a partir de 16\/12\/2026/).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/Vigência a partir de 16\/12\/2027/).first(),
  ).toBeVisible();
  await expect(cards.filter({ hasText: "44h" }).first()).toBeVisible();
  await expect(cards.getByText("Conferida", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Importar referências", exact: true })
    .click();
  expect(await cards.allTextContents()).toEqual(before);
});
