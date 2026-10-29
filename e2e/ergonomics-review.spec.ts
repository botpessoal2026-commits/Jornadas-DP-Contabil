import { test, expect } from "@playwright/test";

test("tema opcional persiste a preferência e permite retornar ao claro", async ({
  page,
}) => {
  await page.goto("/?demo=1&empresa=demo-company&pagina=escalas&mes=2026-10");
  await page
    .getByRole("button", { name: "Ativar tema escuro", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() =>
      page.getByLabel("Mês da escala", { exact: true }).evaluate((input) => {
        const label = input.closest("label")!;
        let surface: Element | null = label;
        while (
          surface &&
          ["rgba(0, 0, 0, 0)", "transparent"].includes(
            getComputedStyle(surface).backgroundColor,
          )
        )
          surface = surface.parentElement;
        const luminance = (color: string) => {
          const channels = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number);
          const values = channels.map((channel) => {
            const value = channel / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          });
          return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
        };
        const foreground = luminance(getComputedStyle(label).color);
        const background = luminance(
          getComputedStyle(surface!).backgroundColor,
        );
        return (
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05)
        );
      }),
    )
    .toBeGreaterThanOrEqual(4.5);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "Ativar tema claro", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("ações do cadastro continuam visíveis com formulário longo no celular", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/?demo=1&empresa=demo-company&pagina=modelos&mes=2026-10");
  await page.getByRole("button", { name: "Novo modelo", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const save = dialog.getByRole("button", {
    name: "Salvar cadastro",
    exact: true,
  });
  const dimensions = await dialog.locator(".dialog-body").evaluate((body) => ({
    height: body.clientHeight,
    content: body.scrollHeight,
  }));
  expect(dimensions.content).toBeGreaterThan(dimensions.height);
  const box = await save.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(812);
  await dialog
    .getByLabel("Nome do modelo", { exact: true })
    .fill("Cadastro da revisão ergonômica");
  await save.click();
  await expect(dialog).not.toBeVisible();
});

test("editor visual usa os mesmos horários, pausas e virada noturna do modelo", async ({
  page,
}) => {
  await page.goto("/?demo=1&empresa=demo-company&pagina=modelos&mes=2026-10");
  await page.getByRole("button", { name: "Novo modelo", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const editor = dialog.locator(".shift-visual-editor").filter({
    has: page.getByText("Editor visual · Segunda", { exact: true }),
  });
  await editor.locator("summary").click();
  const periods = editor.getByRole("group");
  await periods.nth(0).getByLabel("Início", { exact: true }).fill("22:00");
  await periods.nth(0).getByLabel("Término", { exact: true }).fill("02:00");
  await periods
    .nth(0)
    .getByLabel("Dia do término", { exact: true })
    .selectOption("1");
  await periods.nth(1).getByLabel("Início", { exact: true }).fill("03:00");
  await periods
    .nth(1)
    .getByLabel("Dia do início", { exact: true })
    .selectOption("1");
  await periods.nth(1).getByLabel("Término", { exact: true }).fill("06:00");
  await periods
    .nth(1)
    .getByLabel("Dia do término", { exact: true })
    .selectOption("1");
  await editor
    .getByRole("button", { name: "Aplicar horários de Segunda", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Horários de Segunda", { exact: true }),
  ).toHaveValue("22:00-02:00 +1, 03:00 +1-06:00 +1");
  await expect(
    dialog.getByText("Total semanal: 40h36", { exact: true }),
  ).toBeVisible();
});
