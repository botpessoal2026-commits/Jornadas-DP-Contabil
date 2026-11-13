import { test, expect, type Page } from "@playwright/test";
import { backend, userA, userB } from "./support/persistence-backend";

async function emailLogin(
  page: Page,
  email = "primeira@example.invalid",
  password = "senha-teste-123",
) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Meu acesso", exact: true }),
  ).toBeVisible();
}

test("e-mail: cadastro funciona com gateway de usuário indisponível e dados sobrevivem a recarga e novo login", async ({
  page,
}) => {
  test.setTimeout(60000);
  const db = await backend(page, true);
  db.seedCompany(userB, "Empresa de outra pessoa");
  const legacyCalls: string[] = [];
  await page.route("**/api/auth/username", async (route) => {
    legacyCalls.push(route.request().method());
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ available: false }),
    });
  });
  await page.goto("/ferramenta");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Usuário", { exact: true })).toHaveCount(0);
  await expect(page.locator(".login-demo")).toHaveCount(0);
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Mariana Persistente");
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("mariana.persistente@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill("Senha-persistente-123");
  await page
    .getByLabel("Confirmar senha", { exact: true })
    .fill("Senha-persistente-123");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Confirme seu e-mail para ativar o acesso",
      exact: true,
    }),
  ).toBeVisible();
  expect(db.signups).toHaveLength(1);
  expect(db.signups[0].data).toEqual({ nome: "Mariana Persistente" });
  expect(legacyCalls).toEqual([]);
  db.confirmEmail("mariana.persistente@example.invalid");
  await emailLogin(
    page,
    "mariana.persistente@example.invalid",
    "Senha-persistente-123",
  );
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Empresas", exact: true })
    .click();
  await page
    .locator(".page-head")
    .getByRole("button", { name: "Cadastrar nova empresa", exact: true })
    .click();
  await page
    .getByLabel("Nome da empresa / razão social", { exact: true })
    .fill("Empresa persistente por e-mail");
  await page
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Empresa persistente por e-mail",
      exact: true,
    }),
  ).toBeVisible();
  const created = db.tables.empresas.find(
    (row) => row.nome === "Empresa persistente por e-mail",
  )!;
  await page.goto(`/?empresa=${created.id}&pagina=modelos&mes=2026-12`);
  await page.getByRole("button", { name: "Novo modelo", exact: true }).click();
  await page
    .getByLabel("Nome do modelo", { exact: true })
    .fill("Modelo salvo por e-mail");
  await page
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Modelo salvo por e-mail", exact: true }),
  ).toBeVisible();
  const model = db.tables.modelos_jornada.find(
    (row) => row.nome === "Modelo salvo por e-mail",
  )!;
  await page.goto(`/?empresa=${created.id}&pagina=funcionarios&mes=2026-12`);
  await page
    .getByRole("button", { name: "Adicionar funcionário", exact: true })
    .click();
  await page
    .getByLabel("Nome do funcionário", { exact: true })
    .fill("Funcionária persistente");
  await page.getByLabel("Carga semanal contratual (horas)").fill("42:00");
  await page
    .getByRole("combobox", {
      name: "Modelo individual de jornada",
      exact: true,
    })
    .selectOption(String(model.id));
  await page
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const employee = db.tables.funcionarios.find(
    (row) => row.nome === "Funcionária persistente",
  )!;
  await page.goto(
    `/?empresa=${created.id}&pagina=escalas&funcionario=${employee.id}&mes=2026-12`,
  );
  await page.getByRole("button", { name: "Gerar prévia", exact: true }).click();
  await page
    .getByRole("button", { name: "Salvar escala", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Escala salva com sucesso." }),
  ).toBeVisible();
  expect(db.tables.escalas).toHaveLength(1);
  const scheduleId = db.tables.escalas[0].id;
  await page.reload();
  await expect(page.getByRole("gridcell")).toHaveCount(31);
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await emailLogin(
    page,
    "mariana.persistente@example.invalid",
    "Senha-persistente-123",
  );
  await page.goto(
    `/?empresa=${created.id}&pagina=escalas&funcionario=${employee.id}&mes=2026-12`,
  );
  await expect(page.getByRole("gridcell")).toHaveCount(31);
  expect(db.tables.escalas[0].id).toBe(scheduleId);
  expect(db.tables.modelos_jornada).toHaveLength(1);
  expect(db.tables.funcionarios).toHaveLength(1);
  await expect(
    page.getByText("Empresa de outra pessoa", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Modo demonstração", { exact: true }),
  ).toHaveCount(0);
  expect(legacyCalls).toEqual([]);
  expect(db.unexpected).toEqual([]);
});

test("e-mail: validação acessível impede envio inválido; erros do provedor e rede são claros", async ({
  page,
}) => {
  const db = await backend(page);
  await page.goto("/login");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Teste de validação");
  await page.getByLabel("E-mail", { exact: true }).fill("invalido");
  await page.getByLabel("Senha", { exact: true }).fill("1234567");
  await page.getByLabel("Confirmar senha", { exact: true }).fill("diferente");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await expect(page.getByLabel("E-mail", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Informe um e-mail válido." })
      .first(),
  ).toBeVisible();
  expect(db.signups).toHaveLength(0);
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("primeira@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill("senha-teste-123");
  await page
    .getByLabel("Confirmar senha", { exact: true })
    .fill("senha-teste-123");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Este e-mail já está cadastrado." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Já tenho uma conta", exact: true })
    .click();
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("primeira@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill("senha-incorreta");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "E-mail ou senha incorretos." }),
  ).toBeVisible();
  await page.route("**/auth/v1/token**", (r) => r.abort());
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Falha de conexão." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Entrar", exact: true }),
  ).toBeEnabled();
});

test("e-mail: não busca dados privados antes de autenticar e login é utilizável em 375px", async ({
  page,
}) => {
  const reads: string[] = [];
  await page.route("**/rest/v1/**", (r) => {
    reads.push(r.request().url());
    return r.abort();
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/?empresa=${userA}&pagina=escalas&mes=2026-12`);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Escalas de trabalho", exact: true }),
  ).toHaveCount(0);
  expect(reads).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: "work/login-email-mobile.png",
    fullPage: true,
  });
});

test("e-mail: cadastro informa carregamento, desabilita botão e envia uma só vez", async ({
  page,
}) => {
  await backend(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: unknown[] = [];
  await page.route("**/auth/v1/signup**", async (route) => {
    calls.push(route.request().postDataJSON());
    await gate;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: userA,
          email: "novo@example.invalid",
          identities: [{ id: userA }],
          user_metadata: { nome: "Novo cadastro" },
        },
        session: null,
      }),
    });
  });
  await page.goto("/login");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Novo cadastro");
  await page.getByLabel("E-mail", { exact: true }).fill("novo@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill("Senha-cadastro-123");
  await page
    .getByLabel("Confirmar senha", { exact: true })
    .fill("Senha-cadastro-123");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Criar conta", exact: true }),
  ).toBeDisabled();
  await expect(page.locator('form[aria-busy="true"]')).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", {
      name: "Confirme seu e-mail para ativar o acesso",
      exact: true,
    }),
  ).toBeVisible();
  expect(calls).toHaveLength(1);
});

test("e-mail: recuperação envia apenas e-mail e usa o callback /login", async ({
  page,
}) => {
  await backend(page);
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  await page.route("**/auth/v1/recover**", async (route) => {
    calls.push({
      url: route.request().url(),
      body: route.request().postDataJSON(),
    });
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Esqueci minha senha", exact: true })
    .click();
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("primeira@example.invalid");
  await page
    .getByRole("button", { name: "Enviar instruções", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "enviaremos as instruções" }),
  ).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toMatchObject({ email: "primeira@example.invalid" });
  expect(calls[0].body).not.toHaveProperty("password");
  expect(new URL(calls[0].url).searchParams.get("redirect_to")).toBe(
    new URL("/login", page.url()).href,
  );
});

test("e-mail: callback de recuperação exige confirmação e permite entrar com a nova senha", async ({
  page,
}) => {
  const db = await backend(page);
  const session = db.sessionFor(userA);
  const updates: Array<Record<string, unknown>> = [];
  await page.route("**/auth/v1/user", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON();
    updates.push(body);
    db.users[0].password = String(body.password);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(session.user),
    });
  });
  const fragment = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: "bearer",
    type: "recovery",
    expires_in: "86400",
  });
  await page.goto(`/login#${fragment}`);
  await expect(
    page.getByRole("heading", { name: "Defina uma nova senha", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Senha", { exact: true }).fill("Senha-recuperada-123");
  await page
    .getByLabel("Confirmar senha", { exact: true })
    .fill("Outra-senha-123");
  await page.getByRole("button", { name: "Salvar senha", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "A confirmação deve ser igual à senha." })
      .first(),
  ).toBeVisible();
  expect(updates).toHaveLength(0);
  await page
    .getByLabel("Confirmar senha", { exact: true })
    .fill("Senha-recuperada-123");
  await page.getByRole("button", { name: "Salvar senha", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Senha atualizada." }),
  ).toBeVisible();
  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({ password: "Senha-recuperada-123" });
  expect(updates[0]).not.toHaveProperty("confirmPassword");
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await emailLogin(page, "primeira@example.invalid", "Senha-recuperada-123");
  expect(db.unexpected).toEqual([]);
});
