import { test, expect, type Page } from "@playwright/test";
import { backend, userA, userB } from "./support/persistence-backend";

async function login(page: Page, username = "primeira.dp") {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Entrar com usuário existente", exact: true })
    .click();
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
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Usuário", { exact: true })).toHaveCount(0);
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
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
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

test("cadastro usa nome, e-mail e senha sem depender do gateway de alias", async ({
  page,
}) => {
  const db = await backend(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Nova Conta");
  await page.getByLabel("E-mail", { exact: true }).fill("nova@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill("senha-nova-123");
  await page
    .getByLabel("Confirmar senha", { exact: true })
    .fill("senha-nova-123");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Cadastro solicitado." }),
  ).toContainText("Confira seu e-mail");
  await expect(
    page.getByRole("button", { name: "Meu acesso", exact: true }),
  ).toHaveCount(0);
  expect(db.signups).toHaveLength(1);
  expect(db.signups[0].data).toMatchObject({ nome: "Nova Conta" });
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
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
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
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
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
