import { test, expect, type Page, type TestInfo } from "@playwright/test";

const companyId = "demo-company";
const modelName = "Plantão da equipe operacional";

async function companyTab(page: Page, name: string) {
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

async function captureResponsive(page: Page, info: TestInfo, name: string) {
  const frame = async () => {
    if (name === "regime-config")
      await page.getByRole("dialog").evaluate((element) => {
        element.scrollTop = 0;
      });
    else await page.locator(".calendar").scrollIntoViewIfNeeded();
  };
  await frame();
  await page.screenshot({
    path: info.outputPath(`${name}-desktop.png`),
    fullPage: false,
  });
  await page.setViewportSize({ width: 375, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await frame();
  await page.screenshot({
    path: info.outputPath(`${name}-mobile.png`),
    fullPage: false,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function prepareCycle(
  page: Page,
  {
    night = false,
    proof = true,
    capture,
  }: {
    night?: boolean;
    proof?: boolean;
    capture?: TestInfo;
  } = {},
) {
  await page.goto(`/?empresa=${companyId}&pagina=modelos&mes=2026-10&demo=1`);
  await page.getByRole("button", { name: "Novo modelo", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome do modelo", { exact: true }).fill(modelName);
  await dialog
    .getByRole("combobox", { name: "Tipo de jornada", exact: true })
    .selectOption("12x36");
  await dialog
    .getByLabel("Primeiro dia de turno", { exact: true })
    .fill("2026-10-01");
  await dialog
    .getByLabel("Turno e pausas", { exact: true })
    .fill(
      night ? "19:00-23:00, 00:00 +1-07:00 +1" : "07:00-12:00, 13:00-19:00",
    );
  await expect(dialog.getByRole("status")).toContainText(
    "Duração do plantão: 12h00",
  );
  await expect(dialog.getByRole("status")).toContainText(
    "Horas trabalhadas: 11h00",
  );
  await saveForm(page);

  await companyTab(page, "Configurações");
  await page
    .getByRole("button", {
      name: "Parâmetros legais desta empresa",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Nova regra", exact: true }).click();
  await dialog
    .getByLabel("Nome da regra", { exact: true })
    .fill("Regime próprio da equipe operacional");
  await dialog
    .getByRole("combobox", { name: "Regime de trabalho", exact: true })
    .selectOption("12x36");
  await dialog
    .getByLabel("Início da vigência", { exact: true })
    .fill("2026-10-01");
  await dialog
    .getByLabel("Fonte / publicação oficial", { exact: true })
    .fill(
      "CLT, art. 59-A — https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm",
    );
  if (proof) {
    await dialog
      .getByRole("combobox", {
        name: "Fundamento jurídico do regime",
        exact: true,
      })
      .selectOption("acordo_individual");
    await dialog
      .getByLabel("Referência do instrumento aplicável", { exact: true })
      .fill("Acordo individual escrito do vínculo, assinado em 01/10/2026");
    await dialog
      .getByLabel("Instrumento conferido e aplicável a estes vínculos", {
        exact: true,
      })
      .check();
  }
  await dialog
    .getByLabel("Conferi a fonte, os valores e a vigência desta regra.", {
      exact: true,
    })
    .check();
  if (capture) await captureResponsive(page, capture, "regime-config");
  await saveForm(page);

  await companyTab(page, "Funcionários");
  await page
    .locator(".employee-card")
    .getByRole("button", { name: "Editar funcionário", exact: true })
    .click();
  await dialog
    .getByRole("combobox", {
      name: "Modelo individual de jornada",
      exact: true,
    })
    .selectOption({ label: modelName });
  await dialog
    .getByLabel("Carga diária contratual (horas)", { exact: true })
    .fill("");
  await dialog
    .getByRole("textbox", { name: /^Carga semanal contratual \(horas\)/ })
    .fill("42");
  for (const checkbox of await dialog
    .getByRole("group", { name: "Dias de descanso contratuais", exact: true })
    .getByRole("checkbox")
    .all())
    await checkbox.uncheck();
  await saveForm(page);
  await companyTab(page, "Escalas");
  await expect(
    page.getByRole("combobox", { name: "Modelo de jornada", exact: true }),
  ).toHaveValue(/.+/);
  await expect(
    page.getByRole("combobox", { name: "Modelo de jornada", exact: true }),
  ).toContainText(modelName);
  await page.getByRole("button", { name: "Gerar prévia", exact: true }).click();
  await expect(page.locator('[data-date="2026-10-01"]')).toContainText(
    night ? "19:00" : "07:00",
  );
  if (capture) await captureResponsive(page, capture, "regime-preview");
  return page.getByRole("region", {
    name: "Conferência da escala",
    exact: true,
  });
}

test("12×36 é reconhecido pelo tipo e mantém o validador de excessos e descanso", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const conference = await prepareCycle(page, { capture: testInfo });
  await expect(
    conference.getByText("Sem violações impeditivas", { exact: true }),
  ).toBeVisible();
  for (const code of [
    "diario",
    "semanal",
    "contrato_semanal",
    "sem_fundamento_12x36",
  ])
    await expect(conference.locator(`[data-alert-code="${code}"]`)).toHaveCount(
      0,
    );
  await expect(page.locator('[data-date="2026-10-02"]')).toContainText("Folga");
  await expect(page.locator('[data-date="2026-10-03"]')).toContainText("07:00");

  await page.locator('[data-date="2026-10-03"]').click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Entrada", { exact: true }).fill("06:00");
  await dialog.getByLabel("Início do intervalo", { exact: true }).fill("11:00");
  await dialog.getByLabel("Retorno", { exact: true }).fill("12:00");
  await dialog.getByLabel("Saída", { exact: true }).fill("18:00");
  await dialog
    .getByRole("button", { name: "Salvar na prévia", exact: true })
    .click();
  await expect(
    conference.locator('[data-alert-code="interjornada_12x36"]'),
  ).toContainText("35h00");
  await expect(conference.locator('[data-alert-code="diario"]')).toHaveCount(0);

  await page.locator('[data-date="2026-10-05"]').click();
  await dialog.getByLabel("Saída", { exact: true }).fill("20:00");
  await dialog
    .getByRole("button", { name: "Salvar na prévia", exact: true })
    .click();
  await expect(
    conference.locator('[data-alert-code="plantao_12x36"]'),
  ).toContainText("13h00");
  await expect(conference.locator('[data-alert-code="diario"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("fundamento ausente gera pendência própria sem falso excesso diário", async ({
  page,
}) => {
  const conference = await prepareCycle(page, { proof: false });
  const pending = page.getByTestId("pending-sources");
  await pending.locator(":scope > summary").click();
  await expect(
    pending.locator('[data-alert-code="sem_fundamento_12x36"]'),
  ).toBeVisible();
  for (const code of [
    "diario",
    "semanal",
    "plantao_12x36",
    "interjornada_12x36",
  ])
    await expect(conference.locator(`[data-alert-code="${code}"]`)).toHaveCount(
      0,
    );
});

test("plantão noturno mantém 36 horas de descanso e não aplica hora reduzida ao teto do plantão", async ({
  page,
}) => {
  const conference = await prepareCycle(page, { night: true });
  await expect(
    conference.getByText("Sem violações impeditivas", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-date="2026-10-03"]')).toContainText("19:00");
  for (const code of [
    "diario",
    "semanal",
    "plantao_12x36",
    "interjornada_12x36",
    "sem_fundamento_12x36",
  ])
    await expect(conference.locator(`[data-alert-code="${code}"]`)).toHaveCount(
      0,
    );
  await expect(
    conference.locator('[data-alert-code="noturno"]'),
  ).not.toHaveCount(0);
});
