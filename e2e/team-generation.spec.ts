import { test, expect, type Page } from "@playwright/test";
import { planningFixture } from "./support/planning-fixture";
import {
  teamFixture,
  teamIds as ids,
  normalTeamSchedule,
} from "../tests/fixtures/team-data";

async function setup(page: Page, data = teamFixture()) {
  const { db } = await planningFixture(page, data);
  await page.goto(
    `/?empresa=${ids.company}&pagina=escalas&mes=2027-01&visao=equipe`,
  );
  await page
    .getByRole("button", { name: "Gerar escalas da equipe", exact: true })
    .click();
  const bulk = page.getByLabel("Operações em lote de escalas", { exact: true });
  await expect(bulk).toBeVisible();
  return { db, bulk };
}
async function generateAuto(page: Page) {
  const result = await setup(page);
  await result.bulk
    .getByRole("checkbox", {
      name: "Distribuir automaticamente os selecionados em 12×36 nos grupos A e B",
      exact: true,
    })
    .check();
  await result.bulk
    .getByLabel("Referência do grupo A no lote", { exact: true })
    .fill("2027-01-01");
  await result.bulk
    .getByRole("button", {
      name: "Gerar todos os funcionários ativos",
      exact: true,
    })
    .click();
  await expect(
    result.bulk
      .getByRole("table", {
        name: "Conferência das prévias selecionadas",
        exact: true,
      })
      .getByRole("row"),
  ).toHaveCount(4);
  return result;
}
const confirm = (bulk: ReturnType<Page["getByLabel"]>) =>
  bulk.getByRole("checkbox", { name: /^Conferi as 3 prévias/ }).check();

test("um comando gera todos os ativos da empresa, mesmo fora do filtro, e salva em uma requisição", async ({
  page,
}) => {
  const { db, bulk } = await setup(page);
  const calls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/salvar_escalas_empresa"))
      calls.push(request.url());
  });
  await bulk
    .getByLabel("Pesquisar funcionários do lote", { exact: true })
    .fill("Ana");
  await bulk
    .getByRole("button", {
      name: "Gerar todos os funcionários ativos",
      exact: true,
    })
    .click();
  const table = bulk.getByRole("table", {
    name: "Conferência das prévias selecionadas",
    exact: true,
  });
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table).toContainText("Ana");
  await expect(table).toContainText("Bruna");
  await expect(table).toContainText("Carla");
  await expect(table).not.toContainText("Inativa");
  await confirm(bulk);
  await bulk
    .getByRole("button", { name: "Salvar lote sem aprovar", exact: true })
    .click();
  await expect(
    bulk.getByRole("status").filter({ hasText: "Lote salvo" }),
  ).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(db.tables.escalas).toHaveLength(3);
  expect(db.plans).toHaveLength(0);
  expect(
    db.tables.escalas.every((schedule) => schedule.empresa_id === ids.company),
  ).toBe(true);
});
test("equipe mista gera e salva os grupos A/B junto com o regime comum e mantém a fase em fevereiro", async ({
  page,
}) => {
  test.setTimeout(60000);
  const { db, bulk } = await generateAuto(page);
  expect(db.writes).toEqual([]);
  const coverage = bulk.getByLabel("Cobertura do horário de funcionamento", {
    exact: true,
  });
  await expect(coverage.getByRole("status")).toContainText(
    "0 dia(s) com cobertura abaixo da meta",
  );
  await confirm(bulk);
  await bulk
    .getByRole("button", { name: "Salvar lote sem aprovar", exact: true })
    .click();
  await expect(
    bulk.getByRole("status").filter({ hasText: "Lote salvo" }),
  ).toBeVisible();
  expect(db.plans).toHaveLength(1);
  expect(db.rotations).toHaveLength(0);
  expect(db.tables.escalas).toHaveLength(3);
  expect(db.tables.modelos_jornada).toHaveLength(4);
  expect(
    db.tables.funcionarios.find((employee) => employee.id === ids.normal)
      ?.modelo_padrao_id,
  ).toBe(ids.normalModel);
  await page.reload();
  await page.goto(
    `/?empresa=${ids.company}&pagina=escalas&mes=2027-02&visao=equipe`,
  );
  await page
    .getByRole("button", { name: "Gerar escalas da equipe", exact: true })
    .click();
  await bulk
    .getByRole("button", {
      name: "Gerar todos os funcionários ativos",
      exact: true,
    })
    .click();
  await expect(coverage.getByRole("status")).toContainText(
    "0 dia(s) com cobertura abaixo da meta",
  );
  await coverage
    .getByText("01/02/2027 · Cobertura mínima atendida", { exact: true })
    .click();
  await expect(coverage).toContainText(
    "07:00–08:00 · 1/1 funcionário(s) · Bruna",
  );
  expect(db.plans).toHaveLength(1);
});
test("edição e desfazer/refazer do lote preservam o revezamento e enviam os dias exibidos", async ({
  page,
}) => {
  const { db, bulk } = await generateAuto(page);
  await bulk
    .getByText("Editar dias das prévias em lote", { exact: true })
    .click();
  await bulk
    .getByRole("combobox", { name: "Aplicar", exact: true })
    .selectOption("rest");
  await bulk
    .getByRole("button", { name: "Aplicar aos dias escolhidos", exact: true })
    .click();
  await bulk
    .getByRole("button", { name: "Desfazer no lote", exact: true })
    .click();
  await bulk
    .getByRole("button", { name: "Refazer no lote", exact: true })
    .click();
  await confirm(bulk);
  await bulk
    .getByRole("button", { name: "Salvar lote sem aprovar", exact: true })
    .click();
  await expect(
    bulk.getByRole("status").filter({ hasText: "Lote salvo" }),
  ).toBeVisible();
  expect(db.plans).toHaveLength(1);
  for (const schedule of db.tables.escalas)
    expect(
      (schedule.dias as { data: string; intervalos: unknown[] }[]).find(
        (day) => day.data === "2027-01-01",
      )?.intervalos,
    ).toEqual([]);
});
test("planejamento sem migration mantém prévias e não grava parte da equipe", async ({
  page,
}) => {
  const { db, bulk } = await generateAuto(page);
  db.setTeamUnavailable(true);
  await confirm(bulk);
  await bulk
    .getByRole("button", { name: "Salvar lote sem aprovar", exact: true })
    .click();
  await expect(bulk.getByRole("alert")).toContainText(
    "ativar-planejamento-equipe.sql",
  );
  await expect(
    bulk
      .getByRole("table", {
        name: "Conferência das prévias selecionadas",
        exact: true,
      })
      .getByRole("row"),
  ).toHaveCount(4);
  expect(db.tables.escalas).toHaveLength(0);
  expect(db.tables.modelos_jornada).toHaveLength(2);
});
test("gravação confirmada e falha de recarga bloqueiam repetição do lote", async ({
  page,
}) => {
  const { db, bulk } = await generateAuto(page);
  db.failAfterNextWrite();
  await confirm(bulk);
  await bulk
    .getByRole("button", { name: "Salvar lote sem aprovar", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Gravação da equipe concluída" }),
  ).toBeVisible({ timeout: 12000 });
  await expect(
    bulk.getByRole("button", {
      name: "Gerar todos os funcionários ativos",
      exact: true,
    }),
  ).toBeDisabled();
  expect(db.plans).toHaveLength(1);
  expect(db.tables.modelos_jornada).toHaveLength(4);
  expect(db.tables.escalas).toHaveLength(3);
});
test("gerar toda a empresa preserva escala aprovada e funciona no celular", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const data = teamFixture();
  data.schedules.push({
    ...normalTeamSchedule(data),
    id: "protected",
    status: "aprovada",
    revisao: 1,
  });
  const { db, bulk } = await setup(page, data);
  await bulk
    .getByRole("button", {
      name: "Gerar todos os funcionários ativos",
      exact: true,
    })
    .click();
  await expect(bulk.getByRole("alert")).toContainText("reabra a escala");
  expect(db.writes).toEqual([]);
  expect(db.tables.escalas).toHaveLength(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
});
