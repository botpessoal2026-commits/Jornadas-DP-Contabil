import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
const userA = "a1000000-0000-4000-8000-000000000001";
const userB = "a1000000-0000-4000-8000-000000000002";

/** Persistent test transport; SDK sessions and application UI remain real. */
async function backend(page: Page, legacy = false) {
  const users = [
    {
      id: userA,
      email: "primeira@example.invalid",
      username: legacy ? null : "primeira.dp",
    },
    { id: userB, email: "segunda@example.invalid", username: "segunda.dp" },
  ];
  const tables: Record<string, Row[]> = Object.fromEntries(
    [
      "empresas",
      "funcionarios",
      "modelos_jornada",
      "parametros_legais",
      "feriados",
      "escalas",
      "log_alteracoes",
      "datas_especiais",
      "estabelecimentos",
      "registros_operacionais",
    ].map((name) => [name, []]),
  );
  const writes: string[] = [];
  const unexpected: string[] = [];
  const signups: Row[] = [];
  let failReadback = false;
  let failNextWriteReadback = false;
  const user = (id: string) => {
    const found = users.find((item) => item.id === id)!;
    return {
      id,
      email: found.email,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    };
  };
  const token = (id: string) =>
    [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
        "base64url",
      ),
      Buffer.from(
        JSON.stringify({
          sub: id,
          aud: "authenticated",
          role: "authenticated",
          exp: Math.floor(Date.now() / 1000) + 86400,
        }),
      ).toString("base64url"),
      "transport-test-only",
    ].join(".");
  const actor = (authorization?: string) => {
    try {
      return JSON.parse(
        Buffer.from(
          (authorization ?? "").split(" ")[1].split(".")[1],
          "base64url",
        ).toString(),
      ).sub as string;
    } catch {
      return "";
    }
  };
  const session = (id: string) => ({
    access_token: token(id),
    refresh_token: `test-refresh-${id}`,
    token_type: "bearer",
    expires_in: 86400,
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    user: user(id),
  });
  const respond = async (
    route: Parameters<Parameters<Page["route"]>[1]>[0],
    value: unknown,
    status = 200,
  ) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  };
  await page.route(/https?:\/\/[^/]+\.supabase\.(?:co|in)\//, async (route) => {
    unexpected.push(route.request().url());
    await route.abort();
  });
  await page.route("**/api/auth/username", async (route) => {
    if (route.request().method() === "GET")
      return respond(route, { available: true });
    const body = route.request().postDataJSON();
    const found = users.find(
      (item) => item.username === String(body.username).trim().toLowerCase(),
    );
    if (!found || body.password !== "senha-teste-123")
      return respond(
        route,
        { error: "Usuário ou senha inválidos.", code: "invalid_credentials" },
        401,
      );
    return respond(route, {
      access_token: token(found.id),
      refresh_token: `test-refresh-${found.id}`,
    });
  });
  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname.endsWith("/user")) {
      const id = actor(request.headers().authorization);
      return id
        ? respond(route, user(id))
        : respond(route, { message: "Unauthorized" }, 401);
    }
    if (url.pathname.endsWith("/logout")) return respond(route, {});
    if (url.pathname.endsWith("/signup")) {
      const body = request.postDataJSON() as Row;
      signups.push(body);
      return respond(route, {
        user: { ...user(userA), user_metadata: body.data },
        session: null,
      });
    }
    if (url.pathname.endsWith("/token")) {
      const body = request.postDataJSON();
      const found = users.find(
        (item) =>
          item.email === body.email ||
          `test-refresh-${item.id}` === body.refresh_token,
      );
      if (!found || (body.email && body.password !== "senha-teste-123"))
        return respond(
          route,
          {
            error: "invalid_grant",
            error_description: "Invalid login credentials",
          },
          400,
        );
      return respond(route, session(found.id));
    }
    unexpected.push(url.pathname);
    return respond(route, { message: "Unexpected Auth route" }, 400);
  });
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const path = url.pathname.split("/rest/v1/")[1];
    const id = actor(request.headers().authorization);
    if (!id) return respond(route, { message: "Unauthorized" }, 401);
    if (path === "nomes_login") {
      const found = users.find((item) => item.id === id)!;
      return respond(
        route,
        found.username ? [{ usuario: found.username, user_id: id }] : [],
      );
    }
    if (path.startsWith("rpc/")) {
      const rpc = path.slice(4),
        body = request.postDataJSON();
      if (rpc === "definir_nome_usuario") {
        const found = users.find((item) => item.id === id)!;
        found.username = body.p_usuario;
        return respond(route, found.username);
      }
      if (rpc === "salvar_registro_empresa") {
        const name = String(body.p_tabela),
          values = body.p_valores as Row;
        const rowId = body.p_id ?? randomUUID();
        const previous = tables[name].find(
          (item) => item.id === rowId && item.user_id === id,
        );
        const next = { ...previous, ...values, id: rowId, user_id: id };
        tables[name] = [
          ...tables[name].filter((item) => item.id !== rowId),
          next,
        ];
        writes.push(name);
        return respond(route, rowId);
      }
      unexpected.push(rpc);
      return respond(route, { message: "Unexpected RPC" }, 400);
    }
    if (!(path in tables)) {
      unexpected.push(path);
      return respond(route, { message: "Unexpected table" }, 400);
    }
    if (request.method() === "POST") {
      const value = request.postDataJSON();
      const row = { ...value, id: randomUUID(), user_id: id };
      tables[path].push(row);
      writes.push(path);
      if (failNextWriteReadback) {
        failReadback = true;
        failNextWriteReadback = false;
      }
      return respond(route, row, 201);
    }
    if (failReadback && path === "empresas")
      return respond(
        route,
        { message: "Readback temporarily unavailable" },
        503,
      );
    let rows = tables[path].filter((item) => item.user_id === id);
    for (const [key, value] of url.searchParams)
      if (value.startsWith("eq."))
        rows = rows.filter((item) => String(item[key]) === value.slice(3));
    await route.fulfill({
      contentType: "application/json",
      headers: {
        "content-range": rows.length
          ? `0-${rows.length - 1}/${rows.length}`
          : "*/0",
      },
      body: JSON.stringify(rows),
    });
  });
  return {
    users,
    tables,
    writes,
    unexpected,
    signups,
    seedCompany: (id: string, name: string) =>
      tables.empresas.push({
        id: randomUUID(),
        user_id: id,
        nome: name,
        cnpj: "",
        cidade: "Recife",
        uf: "PE",
        cct: "",
        situacao: "ativa",
        permite_6x1: false,
        limite_diario_minutos: null,
        usa_banco_horas: false,
      }),
    failAfterNextWrite: () => {
      failNextWriteReadback = true;
    },
    restoreReadback: () => {
      failReadback = false;
    },
  };
}

async function login(page: Page, username = "primeira.dp") {
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill(username);
  await page.getByLabel("Senha", { exact: true }).fill("senha-teste-123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Meu acesso", exact: true }),
  ).toBeVisible();
}
async function companies(page: Page) {
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Empresas", exact: true })
    .click();
}
async function companyForm(page: Page, name: string) {
  await companies(page);
  await page
    .locator(".page-head")
    .getByRole("button", { name: "Cadastrar nova empresa", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await form
    .getByLabel("Nome da empresa / razão social", { exact: true })
    .fill(name);
  return form;
}

test("usuário e senha abrem conta persistente; cadastro permanece após recarregar e sair/entrar", async ({
  page,
}) => {
  const db = await backend(page);
  await page.goto("/");
  await expect(page.getByLabel("Usuário", { exact: true })).toBeVisible();
  await expect(page.getByLabel("E-mail", { exact: true })).toHaveCount(0);
  await login(page);
  const form = await companyForm(page, "Empresa que permanece");
  await form
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(form).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Empresa que permanece", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Empresa que permanece", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page.getByLabel("Usuário", { exact: true })).toBeVisible();
  await login(page);
  await companies(page);
  await expect(
    page.getByRole("heading", { name: "Empresa que permanece", exact: true }),
  ).toBeVisible();
  expect(db.writes).toEqual(["empresas"]);
  expect(db.tables.empresas[0].user_id).toBe(userA);
  expect(db.unexpected).toEqual([]);
});

test("conta antiga define usuário sem trocar UUID nem perder empresas", async ({
  page,
}) => {
  const db = await backend(page, true);
  db.seedCompany(userA, "Empresa antiga preservada");
  await page.goto("/");
  await page
    .getByRole("button", { name: "Entrar com e-mail existente", exact: true })
    .click();
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("primeira@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill("senha-teste-123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("button", { name: "Meu acesso", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Meu acesso", exact: true });
  await dialog
    .getByLabel("Nome de usuário", { exact: true })
    .fill("Minha.Conta");
  await dialog
    .getByRole("button", { name: "Salvar usuário", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(db.users[0].id).toBe(userA);
  expect(db.users[0].username).toBe("minha.conta");
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await login(page, "minha.conta");
  await companies(page);
  await expect(
    page.getByRole("heading", {
      name: "Empresa antiga preservada",
      exact: true,
    }),
  ).toBeVisible();
  expect(db.tables.empresas[0].user_id).toBe(userA);
  expect(db.unexpected).toEqual([]);
});

test("cadastro usa e-mail somente para confirmação e envia o nome solicitado ao Auth", async ({
  page,
}) => {
  const db = await backend(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await page.getByLabel("Usuário", { exact: true }).fill("nova.conta");
  await page
    .getByLabel("E-mail para recuperação", { exact: true })
    .fill("nova@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill("senha-nova-123");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Cadastro solicitado." }),
  ).toContainText("Confira seu e-mail");
  await expect(
    page.getByRole("button", { name: "Meu acesso", exact: true }),
  ).toHaveCount(0);
  expect(db.signups).toHaveLength(1);
  expect(db.signups[0].data).toMatchObject({ username: "nova.conta" });
  expect(db.writes).toEqual([]);
});

test("gravação concluída com falha de recarga fecha formulário e não duplica INSERT", async ({
  page,
}) => {
  const db = await backend(page);
  await login(page);
  const form = await companyForm(page, "Empresa gravada uma vez");
  db.failAfterNextWrite();
  await form
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  // PostgREST retries transient 503 reads; wait for that actual retry policy.
  await expect(form).not.toBeVisible({ timeout: 20000 });
  const readback = page
    .getByRole("alert")
    .filter({ hasText: "Gravação concluída" });
  await expect(readback).toContainText(
    "Gravação concluída; atualização da tela pendente.",
  );
  expect(db.writes).toEqual(["empresas"]);
  await page
    .locator(".page-head")
    .getByRole("button", { name: "Cadastrar nova empresa", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(db.writes).toEqual(["empresas"]);
  const reload = page.getByRole("button", {
    name: "Atualizar dados",
    exact: true,
  });
  await expect(reload).toBeEnabled({ timeout: 15000 });
  db.restoreReadback();
  await reload.click();
  await expect(readback).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Empresa gravada uma vez", exact: true }),
  ).toBeVisible();
  expect(db.tables.empresas).toHaveLength(1);
  expect(db.unexpected).toEqual([]);
});

test("trocar conta não revela as empresas do usuário anterior", async ({
  page,
}) => {
  const db = await backend(page);
  db.seedCompany(userA, "Empresa exclusiva primeira");
  db.seedCompany(userB, "Empresa exclusiva segunda");
  await login(page);
  await companies(page);
  await expect(
    page.getByRole("heading", {
      name: "Empresa exclusiva primeira",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await login(page, "segunda.dp");
  await companies(page);
  await expect(
    page.getByRole("heading", {
      name: "Empresa exclusiva segunda",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Empresa exclusiva primeira", { exact: true }),
  ).toHaveCount(0);
  expect(db.unexpected).toEqual([]);
});

test("demonstração oferece saída explícita para a conta sem manter o marcador demo", async ({
  page,
}) => {
  await backend(page);
  await page.goto("/?demo=1&empresa=demo-company&pagina=escalas&mes=2026-12");
  await page
    .getByRole("button", {
      name: "Usar minha conta com dados salvos",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Usuário", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("demo")).toBe(false);
  await expect(
    page.getByRole("heading", { name: "Aurora Contabilidade", exact: true }),
  ).toHaveCount(0);
});

test("acesso no celular mantém campos, ações e dados da conta sem transbordamento", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const db = await backend(page);
  db.seedCompany(userA, "Empresa móvel preservada");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByLabel("Usuário", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "work/username-login-mobile.png",
    fullPage: true,
  });
  await login(page);
  await page
    .getByRole("button", { name: "Ativar tema escuro", exact: true })
    .click();
  await page.getByRole("button", { name: "Meu acesso", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Meu acesso", exact: true });
  await expect(
    dialog.getByLabel("Nome de usuário", { exact: true }),
  ).toHaveValue("primeira.dp");
  await expect(
    dialog.getByRole("button", { name: "Salvar usuário", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "work/username-access-mobile-dark.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(db.unexpected).toEqual([]);
});
