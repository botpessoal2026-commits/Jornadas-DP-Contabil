import { test, expect, type Page } from "@playwright/test";

async function openNewModel(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar demonstração" }).click();
  await page
    .getByRole("button", { name: "Modelos de jornada", exact: true })
    .click();
  await page.getByRole("button", { name: "Novo modelo", exact: true }).click();
  return page.getByRole("dialog");
}

test("modelo semanal mostra total ao digitar e copia dias úteis preservando o fim de semana", async ({
  page,
}) => {
  const dialog = await openNewModel(page);
  await expect(
    dialog.getByText("Total semanal: 42h00", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Somente para ciclo 12×36" }),
  ).not.toBeVisible();
  await dialog
    .getByLabel("Nome do modelo", { exact: true })
    .fill("Semana personalizada do DP");
  await dialog
    .getByLabel("Horários de Sábado", { exact: true })
    .fill("09:00-11:00");
  await dialog
    .getByLabel("Horários de Domingo", { exact: true })
    .fill("10:00-11:00");
  await dialog
    .getByLabel("Horários de Segunda", { exact: true })
    .fill("08:00-12:00, 13:00-17:00");
  await expect(
    dialog.getByText("Total semanal: 44h36", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", {
      name: "Copiar segunda para dias úteis",
      exact: true,
    })
    .click();
  for (const day of ["Terça", "Quarta", "Quinta", "Sexta"])
    await expect(
      dialog.getByLabel(`Horários de ${day}`, { exact: true }),
    ).toHaveValue("08:00-12:00, 13:00-17:00");
  await expect(
    dialog.getByLabel("Horários de Sábado", { exact: true }),
  ).toHaveValue("09:00-11:00");
  await expect(
    dialog.getByLabel("Horários de Domingo", { exact: true }),
  ).toHaveValue("10:00-11:00");
  await expect(
    dialog.getByText("Total semanal: 43h00", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const card = page.locator(".panel").filter({
    has: page.getByRole("heading", {
      name: "Semana personalizada do DP",
      exact: true,
    }),
  });
  await card
    .getByRole("button", { name: "Editar modelo", exact: true })
    .click();
  await expect(
    dialog.getByText("Total semanal: 43h00", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Horários de Sábado", { exact: true }),
  ).toHaveValue("09:00-11:00");
  await expect(
    dialog.getByLabel("Horários de Domingo", { exact: true }),
  ).toHaveValue("10:00-11:00");
});

test("total semanal não aparenta valor válido durante entrada parcial ou períodos sobrepostos", async ({
  page,
}) => {
  const dialog = await openNewModel(page);
  const monday = dialog.getByLabel("Horários de Segunda", { exact: true });
  await monday.fill("08:");
  await expect(monday).toBeFocused();
  await expect(monday).toHaveValue("08:");
  await expect(monday).toHaveAttribute("aria-invalid", "true");
  await expect(
    dialog.getByText("Total semanal: confira os horários", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Total semanal: 42h00", { exact: true }),
  ).not.toBeVisible();
  await monday.fill("08:00-12:00, 11:00-17:00");
  await expect(
    dialog.getByText("Total semanal: confira os horários", { exact: true }),
  ).toBeVisible();
  const errorId = await monday.getAttribute("aria-describedby");
  expect(errorId).toBeTruthy();
  const inlineError = dialog.locator(`[id="${errorId}"]`);
  await expect(inlineError).toBeVisible();
  await expect(inlineError).toContainText("os períodos se sobrepõem");
  await dialog
    .getByLabel("Nome do modelo", { exact: true })
    .fill("Modelo com horário a revisar");
  await dialog
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(monday).toHaveValue("08:00-12:00, 11:00-17:00");
  await monday.fill("22:00-02:00 +1, 03:00-06:00 +1");
  await expect(monday).not.toHaveAttribute("aria-invalid");
  await expect(
    dialog.getByText("Total semanal: 40h36", { exact: true }),
  ).toBeVisible();
});

test("12×36 mostra somente os campos do ciclo e preserva valores ao alternar o tipo", async ({
  page,
}) => {
  const dialog = await openNewModel(page);
  const type = dialog.getByRole("combobox", {
    name: "Tipo de jornada",
    exact: true,
  });
  await dialog
    .getByLabel("Nome do modelo", { exact: true })
    .fill("Ciclo individual do DP");
  await dialog
    .getByLabel("Horários de Segunda", { exact: true })
    .fill("08:00-12:00");
  await type.selectOption("12x36");
  await expect(
    dialog.getByRole("heading", { name: "Somente para ciclo 12×36" }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Horários de Segunda", { exact: true }),
  ).not.toBeVisible();
  await expect(dialog.getByText(/Total semanal:/)).not.toBeVisible();
  await expect(
    dialog.getByText(
      "A carga semanal varia conforme o ciclo e a competência.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Primeiro dia de turno", { exact: true }),
  ).toHaveAttribute("type", "date");
  await dialog
    .getByLabel("Primeiro dia de turno", { exact: true })
    .fill("2026-12-03");
  await dialog
    .getByLabel("Turno e pausas", { exact: true })
    .fill("07:00-12:00, 13:00-19:00");
  await type.selectOption("5x2");
  await expect(
    dialog.getByLabel("Primeiro dia de turno", { exact: true }),
  ).not.toBeVisible();
  await expect(
    dialog.getByLabel("Horários de Segunda", { exact: true }),
  ).toHaveValue("08:00-12:00");
  await expect(
    dialog.getByText("Total semanal: 37h36", { exact: true }),
  ).toBeVisible();
  await type.selectOption("12x36");
  await expect(
    dialog.getByLabel("Primeiro dia de turno", { exact: true }),
  ).toHaveValue("2026-12-03");
  await expect(
    dialog.getByLabel("Turno e pausas", { exact: true }),
  ).toHaveValue("07:00-12:00, 13:00-19:00");
  await dialog
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const card = page.locator(".panel").filter({
    has: page.getByRole("heading", {
      name: "Ciclo individual do DP",
      exact: true,
    }),
  });
  await card
    .getByRole("button", { name: "Editar modelo", exact: true })
    .click();
  await expect(type).toHaveValue("12x36");
  await expect(
    dialog.getByLabel("Primeiro dia de turno", { exact: true }),
  ).toHaveValue("2026-12-03");
  await expect(
    dialog.getByLabel("Turno e pausas", { exact: true }),
  ).toHaveValue("07:00-12:00, 13:00-19:00");
});
