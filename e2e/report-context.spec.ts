import { test, expect } from "@playwright/test";

const reportsURL =
  "/?demo=1&empresa=demo-company&pagina=relatorios&mes=2026-12";

test("prévia PDF é invalidada ao mudar seleção, documento ou empresa", async ({
  page,
}) => {
  await page.goto(reportsURL);
  const reports = page.getByRole("region", {
    name: "Central de relatórios",
    exact: true,
  });
  const preview = reports.getByRole("button", {
    name: "Pré-visualizar PDF",
    exact: true,
  });
  const iframe = reports.locator('iframe[src^="blob:"]');
  const download = reports.getByRole("button", {
    name: "Baixar PDF visualizado",
    exact: true,
  });
  await reports
    .getByRole("button", { name: "Selecionar resultados", exact: true })
    .click();
  await preview.click();
  await expect(iframe).toHaveCount(1);
  await expect(download).toBeVisible();
  await reports
    .getByRole("button", { name: "Limpar seleção", exact: true })
    .click();
  await expect(iframe).toHaveCount(0);
  await expect(download).toHaveCount(0);
  await preview.click();
  await expect(iframe).toHaveCount(1);
  await reports
    .getByRole("combobox", { name: "Documento", exact: true })
    .selectOption("folha");
  await expect(iframe).toHaveCount(0);
  await expect(download).toHaveCount(0);
  await preview.click();
  await expect(iframe).toHaveCount(1);
  await page
    .getByLabel("Empresa ativa", { exact: true })
    .selectOption("demo-company-beta");
  await expect(
    page.getByRole("region", { name: "Central de relatórios", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("empresa") === "demo-company-beta" &&
      url.searchParams.get("pagina") === "relatorios",
  );
  await expect(page.locator('iframe[src^="blob:"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Baixar PDF visualizado", exact: true }),
  ).toHaveCount(0);
});

test("ZIP pendente não dispara download do contexto anterior após trocar empresa", async ({
  page,
}) => {
  await page.goto(reportsURL);
  const reports = page.getByRole("region", {
    name: "Central de relatórios",
    exact: true,
  });
  await reports
    .getByRole("button", { name: "Selecionar resultados", exact: true })
    .click();
  await reports
    .getByRole("combobox", { name: "Documento", exact: true })
    .selectOption("folha");
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  let release!: () => void;
  let intercepted!: () => void;
  let heldUrl = "";
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const interceptedRequest = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  await page.route("**/_next/static/chunks/*.js", async (route) => {
    if (!heldUrl) {
      heldUrl = route.request().url();
      intercepted();
      await gate;
    }
    await route.continue();
  });
  try {
    await reports
      .getByRole("button", {
        name: "Baixar PDFs selecionados (ZIP)",
        exact: true,
      })
      .click();
    await interceptedRequest;
    await page
      .getByLabel("Empresa ativa", { exact: true })
      .selectOption("demo-company-beta");
    await expect(page.getByLabel("Empresa ativa", { exact: true })).toHaveValue(
      "demo-company-beta",
    );
    const resumed = page.waitForResponse(
      (response) => response.url() === heldUrl,
    );
    release();
    await resumed;
    await page.waitForLoadState("networkidle");
    expect(downloads).toEqual([]);
    await expect(
      page.getByRole("region", { name: "Central de relatórios", exact: true }),
    ).not.toContainText("PDF(s) gerado(s) no ZIP");
  } finally {
    release();
  }
});
