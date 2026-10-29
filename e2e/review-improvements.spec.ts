import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

const scheduleURL =
  "/?demo=1&empresa=demo-company&pagina=escalas&funcionario=demo-employee&mes=2026-12";
const remoteCalls = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  remoteCalls.set(page, []);
  await page.route(/https:\/\/[^/]*supabase\.(co|in)\//, async (route) => {
    remoteCalls.get(page)!.push(route.request().url());
    await route.abort();
  });
});
test.afterEach(async ({ page }) => {
  expect(remoteCalls.get(page)).toEqual([]);
});

const editor = (page: Page) =>
  page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Editar dia da escala",
      exact: true,
    }),
  });
const discardDialog = (page: Page) =>
  page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Descartar edição do formulário?",
      exact: true,
    }),
  });
async function openSchedule(page: Page) {
  await page.goto(scheduleURL);
  await expect(page.locator('[data-date="2026-12-01"]')).toBeVisible();
}

test("revisão: Esc preserva formulário até confirmar descarte", async ({
  page,
}) => {
  await openSchedule(page);
  const cell = page.locator('[data-date="2026-12-01"]');
  await page
    .getByRole("button", { name: "Ir ao calendário", exact: true })
    .click();
  await expect(cell).toBeInViewport();
  await cell.click();
  await editor(page).getByLabel("Saída", { exact: true }).fill("18:18");
  await page.keyboard.press("Escape");
  await expect(discardDialog(page)).toBeVisible();
  await discardDialog(page)
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await expect(editor(page).getByLabel("Saída", { exact: true })).toHaveValue(
    "18:18",
  );
  await page.keyboard.press("Escape");
  await discardDialog(page)
    .getByRole("button", { name: "Confirmar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await cell.click();
  await expect(editor(page).getByLabel("Saída", { exact: true })).toHaveValue(
    "17:24",
  );
});

test("revisão: carga HH:MM salva e reabre sem interpretar minutos como decimal", async ({
  page,
}) => {
  await page.goto(
    "/?demo=1&empresa=demo-company&pagina=funcionarios&mes=2026-12",
  );
  const row = page
    .locator(".employee-card")
    .filter({ hasText: "Mariana Costa" });
  await row
    .getByRole("button", { name: "Editar funcionário", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Carga diária contratual (horas)", { exact: true })
    .fill("08:24");
  await dialog
    .getByRole("textbox", { name: /^Carga semanal contratual \(horas\)/ })
    .fill("42h00");
  await dialog
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(row).toContainText("42h00 / semana");
  await row
    .getByRole("button", { name: "Editar funcionário", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Carga diária contratual (horas)", { exact: true }),
  ).toHaveValue("08:24");
  await expect(
    dialog.getByRole("textbox", {
      name: /^Carga semanal contratual \(horas\)/,
    }),
  ).toHaveValue("42:00");
});

test("revisão: grade filtra equipe e abre diretamente o dia selecionado", async ({
  page,
}) => {
  await page.goto(`${scheduleURL}&visao=equipe`);
  const section = page.getByLabel("Grade da equipe", { exact: true });
  await expect(
    section.getByRole("heading", { name: "Grade da equipe", exact: true }),
  ).toBeVisible();
  await section
    .getByLabel("Pesquisar equipe", { exact: true })
    .fill("Pessoa inexistente");
  await expect(section.locator("[data-team-employee]")).toHaveCount(0);
  await section.getByLabel("Pesquisar equipe", { exact: true }).fill("Mariana");
  await expect(section.locator("[data-team-employee]")).toHaveCount(1);
  await section
    .getByRole("combobox", { name: "Pendência da escala", exact: true })
    .selectOption("missing");
  await expect(section.locator("[data-team-employee]")).toHaveCount(0);
  await section
    .getByRole("combobox", { name: "Pendência da escala", exact: true })
    .selectOption("all");
  await section
    .getByRole("button", { name: /^Abrir dia 01\/12\/2026 de Mariana Costa:/ })
    .click();
  await expect(editor(page)).toContainText("01/12/2026 · Mariana Costa");
  await expect(editor(page).getByLabel("Entrada", { exact: true })).toHaveValue(
    "08:00",
  );
});

test("revisão: importação CSV confere sem gravar e cria vínculo somente na empresa ativa", async ({
  page,
}) => {
  await page.goto(
    "/?demo=1&empresa=demo-company&pagina=funcionarios&mes=2026-12",
  );
  await page
    .getByText("Importar funcionários de CSV ou Excel", { exact: true })
    .click();
  const importer = page.getByLabel("Importar funcionários por planilha", {
    exact: true,
  });
  await importer.locator('input[type="file"]').setInputFiles({
    name: "funcionarios.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "nome;cpf;matricula;cargo;setor;carga diaria;carga semanal\nLuana Importada;529.982.247-25;IMP-01;Analista;Fiscal;08:24;42:00",
      "utf8",
    ),
  });
  await importer
    .getByRole("button", { name: "Conferir importação", exact: true })
    .click();
  await expect(importer.getByLabel("Prévia da importação")).toContainText(
    "1 válido(s) de 1",
  );
  await expect(
    page.locator(".employee-card").filter({ hasText: "Luana Importada" }),
  ).toHaveCount(0);
  await importer
    .getByRole("button", {
      name: "Confirmar importação de 1 funcionário(s)",
      exact: true,
    })
    .click();
  const row = page
    .locator(".employee-card")
    .filter({ hasText: "Luana Importada" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("42h00 / semana");
  await expect(row).toContainText("Aurora Contabilidade");
  await page
    .getByLabel("Empresa ativa", { exact: true })
    .selectOption("demo-company-beta");
  await expect(
    page.locator(".employee-card").filter({ hasText: "Luana Importada" }),
  ).toHaveCount(0);
});

test("revisão: central exporta ZIP com PDF identificado e pré-visualização", async ({
  page,
}) => {
  await page.goto(
    "/?demo=1&empresa=demo-company&pagina=relatorios&mes=2026-12",
  );
  const reports = page.getByLabel("Central de relatórios", { exact: true });
  await reports
    .getByRole("button", { name: "Selecionar resultados", exact: true })
    .click();
  await expect(reports).toContainText("1 selecionado(s)");
  await reports
    .getByRole("combobox", { name: "Documento", exact: true })
    .selectOption("folha");
  const downloadEvent = page.waitForEvent("download");
  await reports
    .getByRole("button", {
      name: "Baixar PDFs selecionados (ZIP)",
      exact: true,
    })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(
    "cont-contabil-folhas-aurora-contabilidade-2026-12.zip",
  );
  const archive = await JSZip.loadAsync(
    await readFile((await download.path())!),
  );
  const files = Object.keys(archive.files).filter(
    (name) => !archive.files[name].dir,
  );
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(
    /aurora-contabilidade.*mariana-costa.*2026-12.*\.pdf$/,
  );
  const pdf = await archive.file(files[0])!.async("uint8array");
  expect(new TextDecoder().decode(pdf.slice(0, 4))).toBe("%PDF");
  await reports
    .getByRole("button", { name: "Pré-visualizar PDF", exact: true })
    .click();
  await expect(reports).toContainText("Pré-visualização: Mariana Costa");
  await expect(reports.locator('iframe[src^="blob:"]')).toHaveCount(1);
});

test("revisão: recuperação opcional restaura prévia após reload sem substituir escala salva", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openSchedule(page);
  const saveBar = page.locator(".schedule-save-bar");
  await expect(saveBar).toBeInViewport();
  const barBox = await saveBar.boundingBox();
  expect(barBox!.height).toBeLessThanOrEqual(120);
  await page
    .getByLabel("Recuperar prévias neste navegador por até 7 dias", {
      exact: true,
    })
    .check();
  await page.locator('[data-date="2026-12-01"]').click();
  await editor(page).getByLabel("Saída", { exact: true }).fill("18:18");
  await editor(page)
    .getByRole("button", { name: "Salvar na prévia", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const databases = await indexedDB.databases();
        if (
          !databases.some(
            (database) => database.name === "cont-contabil-drafts",
          )
        )
          return false;
        return new Promise<boolean>((resolve) => {
          const request = indexedDB.open("cont-contabil-drafts", 1);
          request.onerror = () => resolve(false);
          request.onsuccess = () => {
            const db = request.result;
            const get = db
              .transaction("drafts", "readonly")
              .objectStore("drafts")
              .get(
                JSON.stringify([
                  "demo",
                  "demo-company",
                  "demo-employee",
                  "2026-12",
                ]),
              );
            get.onsuccess = () => {
              resolve(Boolean(get.result));
              db.close();
            };
            get.onerror = () => {
              resolve(false);
              db.close();
            };
          };
        });
      }),
    )
    .toBe(true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Recuperar prévia", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-date="2026-12-01"]')).toContainText("17:24");
  await page
    .getByRole("button", { name: "Recuperar prévia", exact: true })
    .click();
  await expect(page.locator('[data-date="2026-12-01"]')).toContainText("18:18");
  await expect(
    page.getByRole("button", { name: "Salvar escala", exact: true }),
  ).toBeEnabled();
});
