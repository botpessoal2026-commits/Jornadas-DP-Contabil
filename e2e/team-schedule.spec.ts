import { test, expect, type Page } from "@playwright/test";

async function openTeam(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar demonstração" }).click();
  if (await page.getByRole("button", { name: "Abrir menu" }).isVisible())
    await page.getByRole("button", { name: "Abrir menu" }).click();
  await page
    .getByRole("button", { name: "Escalas mensais", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Grade da equipe", exact: true })
    .click();
}

test("grade acompanha Empresa ativa e reúne empresas na visão consolidada em dia/semana/mês", async ({
  page,
}) => {
  await openTeam(page);
  const team = page.getByRole("region", {
    name: "Grade da equipe",
    exact: true,
  });
  const switcher = page.getByRole("combobox", {
    name: "Empresa ativa",
    exact: true,
  });
  await expect(switcher).toHaveValue("");
  await expect(
    team.getByRole("button", { name: "Abrir escala de Mariana Costa" }),
  ).toBeVisible();
  await expect(
    team.getByRole("button", { name: "Abrir escala de Rafael Lima" }),
  ).toBeVisible();
  await team.getByRole("button", { name: "Dia", exact: true }).click();
  await expect(team.getByRole("columnheader")).toHaveCount(2);
  await team.getByRole("button", { name: "Mês", exact: true }).click();
  await expect(team.getByRole("columnheader")).toHaveCount(32);
  await switcher.selectOption("demo-company-beta");
  await expect(
    team.getByRole("button", { name: "Abrir escala de Rafael Lima" }),
  ).toBeVisible();
  await expect(
    team.getByRole("button", { name: "Abrir escala de Mariana Costa" }),
  ).toHaveCount(0);
  await expect(team.locator('[data-team-date="2026-12-01"]')).toContainText(
    "13:00–15:00",
  );
  await switcher.selectOption("");
  await expect(
    team.getByRole("button", { name: "Abrir escala de Mariana Costa" }),
  ).toBeVisible();
  await expect(
    team.getByRole("button", { name: "Abrir escala de Rafael Lima" }),
  ).toBeVisible();
  await team.getByRole("button", { name: "Semana", exact: true }).click();
  await team.getByLabel("Data de referência").fill("2026-12-15");
  await expect(team.getByRole("columnheader", { name: "14/12" })).toBeVisible();
  await expect(team.getByRole("columnheader", { name: "20/12" })).toBeVisible();
});

test("grade consulta escalas salvas e preserva prévia até confirmação ao abrir outra pessoa", async ({
  page,
}) => {
  await openTeam(page);
  await page
    .getByRole("button", { name: "Por funcionário", exact: true })
    .click();
  await page.locator('[data-date="2026-12-01"]').click();
  await page
    .getByRole("dialog")
    .getByLabel("Saída", { exact: true })
    .fill("18:00");
  await page.getByRole("button", { name: "Salvar na prévia" }).click();
  await page
    .getByRole("button", { name: "Grade da equipe", exact: true })
    .click();
  const team = page.getByRole("region", {
    name: "Grade da equipe",
    exact: true,
  });
  await expect(team).toContainText("Há alterações não salvas");
  const savedDay = team.locator(
    '[data-team-employee="demo-employee"] [data-team-date="2026-12-01"]',
  );
  await expect(savedDay).toContainText("17:24");
  await expect(savedDay).not.toContainText("18:00");
  await team
    .getByRole("button", { name: "Abrir escala de Rafael Lima" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await expect(team).toBeVisible();
  await team.getByRole("button", { name: "Voltar à prévia" }).click();
  await expect(page.locator('[data-date="2026-12-01"]')).toContainText("18:00");
  await page
    .getByRole("button", { name: "Grade da equipe", exact: true })
    .click();
  await team
    .getByRole("button", { name: "Abrir escala de Rafael Lima" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Empresa ativa", exact: true }),
  ).toHaveValue("demo-company-beta");
  await expect(page.locator('[data-date="2026-12-01"]')).toContainText("15:00");
  await page.locator('[data-date="2026-12-01"]').click();
  await page
    .getByRole("dialog")
    .getByLabel("Saída", { exact: true })
    .fill("16:00");
  await page.getByRole("button", { name: "Salvar na prévia" }).click();
  await page
    .getByRole("button", { name: "Grade da equipe", exact: true })
    .click();
  await page.getByLabel("Mês da escala", { exact: true }).fill("2027-01");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar", exact: true })
    .click();
  await expect(page.getByLabel("Mês da escala", { exact: true })).toHaveValue(
    "2027-01",
  );
  await expect(team).toContainText("janeiro de 2027");
  await expect(team.locator("tbody")).toContainText("Sem escala");
});

for (const width of [375, 390]) {
  test(`grade móvel ${width}px contém a rolagem e não transforma ausência em folga`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await openTeam(page);
    const team = page.getByRole("region", {
      name: "Grade da equipe",
      exact: true,
    });
    await team.getByRole("button", { name: "Mês", exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const region = team.getByRole("region");
    await expect(region).toHaveAttribute("tabindex", "0");
    await region.evaluate((element) => {
      element.scrollLeft = 700;
    });
    expect(
      await region.evaluate((element) => element.scrollLeft),
    ).toBeGreaterThan(0);
    await page.getByLabel("Mês da escala", { exact: true }).fill("2027-01");
    await expect(team.locator("tbody tr")).toHaveCount(2);
    await expect(team.locator("tbody")).toContainText("Sem escala");
    await expect(team.locator("tbody")).not.toContainText("Folga");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}
