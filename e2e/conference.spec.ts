import { test, expect, type Page } from "@playwright/test";

async function openSchedule(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar demonstração" }).click();
  if (await page.getByRole("button", { name: "Abrir menu" }).isVisible())
    await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("button", { name: "Escalas mensais" }).click();
}

test("horário inválido preserva texto, mostra erro inline e impede salvar por teclado", async ({
  page,
}) => {
  await openSchedule(page);
  const cell = page.locator('[data-date="2026-12-01"]');
  await cell.click();
  const dialog = page.getByRole("dialog");
  const entry = dialog.getByLabel("Entrada", { exact: true });
  await entry.fill("abc");
  await expect(entry).toBeFocused();
  await expect(entry).toHaveValue("abc");
  await expect(entry).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toContainText("Horário inválido");
  await expect(
    dialog.getByRole("button", { name: "Salvar na prévia" }),
  ).toBeDisabled();
  await entry.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(entry).toHaveValue("abc");
  await entry.fill("08:00");
  await expect(
    dialog.getByRole("button", { name: "Salvar na prévia" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(cell).toBeFocused();
  await expect(cell).toContainText("17:24");
});

test("violação tem prioridade, marca calendário, agrupa ocorrências e abre o editor", async ({
  page,
}) => {
  await openSchedule(page);
  for (const day of ["2026-12-01", "2026-12-03"]) {
    await page.locator(`[data-date="${day}"]`).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Saída", { exact: true }).fill("23:00");
    await expect(dialog.getByLabel("Conferência da edição")).toContainText(
      "supera o limite diário",
    );
    // Alongar hoje também afeta o descanso do próximo dia de trabalho.
    await expect(dialog.getByLabel("Conferência da edição")).toContainText(
      "Descanso de 9h00",
    );
    await dialog.getByRole("button", { name: "Salvar na prévia" }).click();
  }
  const cell = page.locator('[data-date="2026-12-01"]');
  await expect(cell).toHaveAttribute("data-problem", "violation");
  await expect(cell).toContainText("impedimento(s)");
  await expect(page.locator('[data-date="2026-12-02"]')).toHaveAttribute(
    "data-problem",
    "violation",
  );
  const sources = page.getByTestId("pending-sources");
  await expect(sources).not.toHaveAttribute("open");
  const categories = await page
    .locator(".schedule-alerts > .alert-section")
    .evaluateAll((els) => els.map((el) => el.className));
  expect(categories[0]).toContain("violation");
  expect(categories.at(-1)).toContain("pending-source");
  const daily = page.locator('[data-alert-code="diario"]');
  await expect(daily).toHaveCount(1);
  await expect(daily).toContainText("2 ocorrências");
  await daily
    .getByText("Ver 2 ocorrências e períodos", { exact: true })
    .click();
  await daily
    .getByRole("button", { name: "Editar 03/12/2026", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("03/12/2026");
  await expect(page.locator('[data-date="2026-12-03"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("button", { name: "Salvar escala", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Escala salva", exact: true }),
  ).toBeDisabled();
  await cell.click();
  await expect(page.getByLabel("Saída", { exact: true })).toHaveValue("23:00");
});

test("virada de meia-noite tem datas explícitas, duração e pausa antes de salvar", async ({
  page,
}) => {
  await openSchedule(page);
  await page.locator('[data-date="2026-12-01"]').click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Entrada", { exact: true }).fill("22:00");
  await dialog.getByLabel("Início do intervalo", { exact: true }).fill("02:00");
  await dialog.getByLabel("Retorno", { exact: true }).fill("03:00");
  await dialog.getByLabel("Saída", { exact: true }).fill("06:00");
  for (const label of [
    "Data: início do intervalo",
    "Data: retorno",
    "Data: saída",
  ])
    await dialog.getByLabel(label, { exact: true }).selectOption("1");
  await expect(dialog).toContainText("Duração diária: 7h00");
  await expect(dialog).toContainText("Pausas entre períodos: 1h00");
  await dialog.getByRole("button", { name: "Salvar na prévia" }).click();
  const cell = page.locator('[data-date="2026-12-01"]');
  await expect(cell).toContainText("22:00 — 02:00 +1");
  await cell.click();
  await expect(dialog.getByLabel("Retorno", { exact: true })).toHaveValue(
    "03:00",
  );
  await expect(dialog.getByLabel("Data: retorno", { exact: true })).toHaveValue(
    "1",
  );
  // Tab/Shift+Tab ficam no diálogo; Escape devolve o foco à célula.
  await dialog.getByRole("button", { name: "Salvar na prévia" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Fechar", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Salvar na prévia" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(cell).toBeFocused();
});

for (const width of [375, 390]) {
  test(`agenda móvel ${width}px mostra horários completos e foco visível`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await openSchedule(page);
    const cell = page.locator('[data-date="2026-12-01"]');
    await expect(
      cell.getByText("08:00 — 12:00", { exact: true }),
    ).toBeVisible();
    await expect(
      cell.getByText("13:00 — 17:24", { exact: true }),
    ).toBeVisible();
    expect(
      await cell.evaluate((el) => el.getBoundingClientRect().width),
    ).toBeGreaterThan(280);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await cell.click();
    await page.getByLabel("Entrada", { exact: true }).focus();
    const outline = await page
      .getByLabel("Entrada", { exact: true })
      .evaluate((el) => getComputedStyle(el).outlineWidth);
    expect(parseFloat(outline)).toBeGreaterThanOrEqual(3);
  });
}

test("texto dos novos alertas e células atende contraste AA", async ({
  page,
}) => {
  await openSchedule(page);
  await page.locator('[data-date="2026-12-01"]').click();
  await page
    .getByRole("dialog")
    .getByLabel("Saída", { exact: true })
    .fill("23:00");
  await page.getByRole("button", { name: "Salvar na prévia" }).click();
  const measurements = await page
    .locator(
      [
        ".alert-section.violation > .alert-section-heading",
        ".alert-group.violation h4",
        ".alert-section.attention > .alert-section-heading",
        ".pending-source > summary",
        ".day.has-violation .day-time",
        ".day.has-violation .day-problem",
        ".legend",
      ].join(","),
    )
    .evaluateAll((elements) =>
      elements.map((element) => {
        const color = (value: string) =>
          (value.match(/[\d.]+/g) ?? []).map(Number);
        const luminance = (rgb: number[]) =>
          rgb
            .slice(0, 3)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4;
            })
            .reduce(
              (sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i],
              0,
            );
        let ancestor: Element | null = element;
        let background = [255, 255, 255];
        while (ancestor) {
          const value = color(getComputedStyle(ancestor).backgroundColor);
          if (value.length === 3 || value[3] > 0) {
            background = value;
            break;
          }
          ancestor = ancestor.parentElement;
        }
        const foregroundLuminance = luminance(
          color(getComputedStyle(element).color),
        );
        const backgroundLuminance = luminance(background);
        return {
          label: element.className,
          contrast:
            (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
            (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
        };
      }),
    );
  expect(measurements.length).toBeGreaterThanOrEqual(7);
  for (const measurement of measurements)
    expect(measurement.contrast, measurement.label).toBeGreaterThanOrEqual(4.5);
});
