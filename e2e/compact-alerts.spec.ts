import { test, expect, type Page } from "@playwright/test";

async function openMonthWithoutOccurrences(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar demonstração" }).click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Empresas", exact: true })
    .click();
  await page
    .locator(".company-card")
    .filter({ hasText: "Aurora Contabilidade" })
    .getByRole("button", { name: "Acessar empresa", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Administração da empresa", exact: true })
    .getByRole("button", { name: "Jornadas e modelos", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Biblioteca de modelos-base", exact: true })
    .locator(".panel")
    .filter({
      has: page.getByRole("heading", {
        name: "5×2 · 42h · seg a sex",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Personalizar nesta empresa", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Nome do modelo", { exact: true })
    .fill("Jornada própria E2E de conferência");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Todas as empresas", exact: true })
    .click();
  await page.getByRole("button", { name: "Escalas mensais" }).click();
  await page.getByLabel("Mês da escala", { exact: true }).fill("2026-11");
  await page.getByRole("button", { name: "Gerar prévia" }).click();
}

test("conferência sem ocorrências ocupa linhas compactas e preserva pendências de fontes", async ({
  page,
}) => {
  await openMonthWithoutOccurrences(page);
  const conference = page.getByRole("region", {
    name: "Conferência da escala",
  });
  await expect(
    conference.getByText("Sem violações impeditivas", { exact: true }),
  ).toBeVisible();
  await expect(
    conference.getByText("Sem alertas de atenção", { exact: true }),
  ).toBeVisible();
  await expect(conference.locator(".alert-section.violation")).toHaveCount(0);
  await expect(conference.locator(".alert-section.attention")).toHaveCount(0);
  await expect(conference.getByText("0 grupos · 0 ocorrências")).toHaveCount(0);
  for (const row of await conference.locator(".alert-clear-row").all())
    expect(
      await row.evaluate((el) => el.getBoundingClientRect().height),
    ).toBeLessThan(64);
  const sources = page.getByTestId("pending-sources");
  await expect(sources).not.toHaveAttribute("open");
  await expect(sources.locator(":scope > summary")).toContainText(
    "Fontes e regras pendentes",
  );
  await expect(sources.locator(":scope > summary")).not.toContainText(
    "0 grupos",
  );
  await sources.locator(":scope > summary").click();
  await expect(sources).toContainText(
    "Fontes e regras não conferidas impedem afirmar conformidade jurídica.",
  );
});

test("impedimentos e atenção abrem ao editar e voltam a compactos ao corrigir por teclado", async ({
  page,
}) => {
  await openMonthWithoutOccurrences(page);
  const cell = page.locator('[data-date="2026-11-03"]');
  await cell.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("dialog")
    .getByLabel("Saída", { exact: true })
    .fill("23:00");
  await page.getByRole("button", { name: "Salvar na prévia" }).click();
  const conference = page.getByRole("region", {
    name: "Conferência da escala",
  });
  await expect(
    conference.getByRole("heading", {
      name: "Violações impeditivas",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    conference.getByRole("heading", {
      name: "Alertas de atenção",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    conference.getByText("Sem violações impeditivas", { exact: true }),
  ).toHaveCount(0);
  await expect(cell).toHaveAttribute("data-problem", "violation");
  const neutralDateColor = await page
    .locator('[data-date="2026-11-16"] .desktop-day')
    .evaluate((element) => getComputedStyle(element).color);
  await expect(cell.locator(".desktop-day")).toHaveCSS(
    "color",
    neutralDateColor,
  );
  await expect(page.getByTestId("pending-sources")).not.toHaveAttribute("open");

  await cell.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("dialog")
    .getByLabel("Saída", { exact: true })
    .fill("17:24");
  await page.getByRole("button", { name: "Salvar na prévia" }).click();
  await expect(
    conference.getByText("Sem violações impeditivas", { exact: true }),
  ).toBeVisible();
  await expect(
    conference.getByText("Sem alertas de atenção", { exact: true }),
  ).toBeVisible();
  await expect(conference.locator(".alert-section.violation")).toHaveCount(0);
  await expect(conference.locator(".alert-section.attention")).toHaveCount(0);
  await expect(cell).not.toHaveAttribute("data-problem");
});
