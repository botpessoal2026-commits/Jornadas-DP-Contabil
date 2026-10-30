import { test, expect } from "@playwright/test";

test("olhinho mostra e oculta a senha sem perder o valor, o foco ou enviar o login", async ({
  page,
}) => {
  const loginRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/auth/username"
    )
      loginRequests.push(request.url());
  });
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill("teste.olhinho");
  const password = page.getByLabel("Senha", { exact: true });
  await password.fill("Senha visível 123");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await page
    .getByRole("button", { name: "Mostrar senha", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("Senha visível 123");
  await expect(password).toBeFocused();
  const hide = page.getByRole("button", { name: "Ocultar senha", exact: true });
  await expect(hide).toHaveAttribute("aria-pressed", "true");
  await hide.click();
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue("Senha visível 123");
  await expect(password).toBeFocused();
  expect(loginRequests).toEqual([]);
});

test("olhinho funciona pelo teclado e não aciona o envio do formulário", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill("teste.teclado");
  const password = page.getByLabel("Senha", { exact: true });
  await password.fill("Senha teclado 123");
  await password.press("Tab");
  const toggle = page.getByRole("button", {
    name: "Mostrar senha",
    exact: true,
  });
  await expect(toggle).toBeFocused();
  await toggle.press("Space");
  await expect(password).toHaveAttribute("type", "text");
  const hide = page.getByRole("button", { name: "Ocultar senha", exact: true });
  await expect(hide).toBeFocused();
  await hide.press("Enter");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue("Senha teclado 123");
  await expect(
    page.getByRole("button", { name: "Entrar", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Bem-vindo ao seu DP" }),
  ).toBeVisible();
});

test("trocar entre cadastro, login e recuperação volta a ocultar a senha", async ({
  page,
}) => {
  await page.goto("/");
  const password = page.getByLabel("Senha", { exact: true });
  await password.fill("Senha anterior 123");
  await page
    .getByRole("button", { name: "Mostrar senha", exact: true })
    .click();
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("autocomplete", "new-password");
  await expect(password).toHaveValue("");
  await password.fill("Senha cadastro 123");
  await page
    .getByRole("button", { name: "Mostrar senha", exact: true })
    .click();
  await expect(password).toHaveValue("Senha cadastro 123");
  await page
    .getByRole("button", { name: "Já tenho uma conta", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await page
    .getByRole("button", { name: "Entrar com e-mail existente", exact: true })
    .click();
  await password.fill("Senha e-mail 123");
  await page
    .getByRole("button", { name: "Mostrar senha", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("Senha e-mail 123");
  await page
    .getByRole("button", { name: "Esqueci minha senha", exact: true })
    .click();
  await expect(password).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /(?:Mostrar|Ocultar) senha/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Voltar ao login", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "password");
  await page
    .getByRole("button", { name: "Reenviar confirmação", exact: true })
    .click();
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  await expect(password).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /(?:Mostrar|Ocultar) senha/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Voltar ao login", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "password");
});

test("olhinho permanece acessível no celular e no tema escuro sem transbordamento", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 375, height: 812 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  const password = page.getByLabel("Senha", { exact: true });
  await password.fill("Senha do celular 123");
  const toggle = page.getByRole("button", {
    name: "Mostrar senha",
    exact: true,
  });
  await expect(toggle).toBeVisible();
  await toggle.tap();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("Senha do celular 123");
  const bounds = await page
    .getByRole("button", { name: "Ocultar senha", exact: true })
    .boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(40);
  expect(bounds?.height).toBeGreaterThanOrEqual(40);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await context.close();
});
