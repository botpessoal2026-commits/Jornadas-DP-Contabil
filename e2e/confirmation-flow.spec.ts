import { test, expect, type Page, type Route } from "@playwright/test";

type Body = Record<string, unknown>;
const password = "  senha-exata-123  ";
const pendingMessage = "Confirme seu e-mail para ativar o acesso";
const resendMessage =
  "Se houver um cadastro pendente para esse e-mail, enviaremos uma nova confirmação. Confira também o spam.";

/** Native Auth SDK remains real; every provider call is intercepted. */
async function pendingBackend(page: Page) {
  const usernameLogins: Body[] = [];
  const emailLogins: Body[] = [];
  const signups: Body[] = [];
  const resends: Array<{ body: Body; url: string }> = [];
  const unexpected: string[] = [];
  const respond = (route: Route, value: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: {
        "X-Supabase-Api-Version": "2024-01-01",
        "Access-Control-Expose-Headers": "X-Supabase-Api-Version",
      },
      body: JSON.stringify(value),
    });

  await page.route(/https?:\/\/[^/]+\.supabase\.(?:co|in)\//, async (route) => {
    unexpected.push(new URL(route.request().url()).pathname);
    await route.abort();
  });
  await page.route("**/api/auth/username", async (route) => {
    if (route.request().method() === "GET")
      return respond(route, { available: true });
    usernameLogins.push(route.request().postDataJSON() as Body);
    return respond(
      route,
      {
        code: "confirmation_required",
        error:
          "Confirme seu e-mail para ativar o acesso. Se necessário, use Reenviar confirmação.",
      },
      403,
    );
  });
  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/signup")) {
      const body = request.postDataJSON() as Body;
      signups.push(body);
      return respond(route, {
        user: {
          id: "73000000-0000-4000-8000-000000000001",
          email: body.email,
          aud: "authenticated",
          role: "authenticated",
          app_metadata: { provider: "email" },
          user_metadata: body.data,
          created_at: "2026-10-29T00:00:00Z",
        },
        session: null,
      });
    }
    if (url.pathname.endsWith("/resend")) {
      resends.push({
        body: request.postDataJSON() as Body,
        url: request.url(),
      });
      return respond(route, {});
    }
    if (url.pathname.endsWith("/token")) {
      emailLogins.push(request.postDataJSON() as Body);
      return respond(
        route,
        { code: "email_not_confirmed", message: "Email not confirmed" },
        400,
      );
    }
    unexpected.push(url.pathname);
    return respond(route, { message: "Unexpected Auth route" }, 400);
  });
  return { usernameLogins, emailLogins, signups, resends, unexpected };
}

async function expectSignedOut(page: Page) {
  await expect(
    page.getByRole("button", { name: "Meu acesso", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => /^sb-.*-auth-token$/.test(key)),
    ),
  ).toEqual([]);
}

test("login pendente mantém orientação e reenvio usa somente o e-mail informado", async ({
  page,
}) => {
  const db = await pendingBackend(page);
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill("ANDRE.TESTE");
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const banner = page.getByRole("heading", {
    name: pendingMessage,
    exact: true,
  });
  await expect(banner).toBeVisible();
  await expect(
    page.getByText("Usuário ou senha inválidos.", { exact: true }),
  ).toHaveCount(0);
  expect(db.usernameLogins).toEqual([{ username: "andre.teste", password }]);
  await expectSignedOut(page);
  await page
    .getByRole("button", { name: "Fechar mensagem", exact: true })
    .click();
  await expect(banner).toBeVisible();

  await page
    .getByRole("button", { name: "Reenviar confirmação", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Reenvie a confirmação", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Senha", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Usuário", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("andre@example.invalid");
  await page
    .getByRole("button", { name: "Enviar confirmação", exact: true })
    .click();
  await expect(page.locator(".toast[role='status']")).toContainText(
    resendMessage,
  );
  expect(db.resends).toHaveLength(1);
  expect(db.resends[0].body).toMatchObject({
    type: "signup",
    email: "andre@example.invalid",
  });
  for (const key of ["password", "username", "access_token", "refresh_token"])
    expect(db.resends[0].body).not.toHaveProperty(key);
  const resendUrl = new URL(db.resends[0].url);
  expect(resendUrl.searchParams.get("redirect_to")).toBe(
    new URL(page.url()).origin,
  );
  await expectSignedOut(page);
  await page
    .getByRole("button", { name: "Voltar ao login", exact: true })
    .click();
  await expect(page.getByLabel("Usuário", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Senha", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  expect(db.unexpected).toEqual([]);
});

test("cadastro sem sessão mostra confirmação persistente e preserva a senha exata", async ({
  page,
}) => {
  const db = await pendingBackend(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await page.getByLabel("Usuário", { exact: true }).fill("NOVA.CONTA");
  await page
    .getByLabel("E-mail para recuperação", { exact: true })
    .fill("nova@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  const banner = page.getByRole("heading", {
    name: pendingMessage,
    exact: true,
  });
  await expect(banner).toBeVisible();
  await expectSignedOut(page);
  expect(db.signups).toHaveLength(1);
  expect(db.signups[0]).toMatchObject({
    email: "nova@example.invalid",
    password,
    data: { username: "nova.conta" },
  });
  expect(db.resends).toEqual([]);
  await page
    .getByRole("button", { name: "Fechar mensagem", exact: true })
    .click();
  await expect(banner).toBeVisible();
  await expect(page.getByLabel("Usuário", { exact: true })).toBeVisible();
  expect(db.unexpected).toEqual([]);
});

test("acesso legado também explica confirmação pendente sem alterar senha ou criar sessão", async ({
  page,
}) => {
  const db = await pendingBackend(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Entrar com e-mail existente", exact: true })
    .click();
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("legado@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: pendingMessage, exact: true }),
  ).toBeVisible();
  expect(db.emailLogins).toHaveLength(1);
  expect(db.emailLogins[0]).toMatchObject({
    email: "legado@example.invalid",
    password,
  });
  expect(db.resends).toEqual([]);
  await expectSignedOut(page);
  expect(db.unexpected).toEqual([]);
});
