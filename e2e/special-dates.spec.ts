import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { demoData } from "../src/lib/demo";
import type { Data } from "../src/lib/store";

const alpha = "demo-company";
const beta = "demo-company-beta";
const mariana = "demo-employee";
const baseModel = "5×2 · 42h · seg a sex";

async function tab(page: Page, name: string) {
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

async function start(page: Page, month = "2026-12") {
  await page.goto(`/?empresa=${alpha}&pagina=feriados&demo=1&mes=${month}`);
  await expect(
    page.getByRole("heading", {
      name: "Feriados e datas especiais",
      exact: true,
    }),
  ).toBeVisible();
}

function eventCard(page: Page, name: string) {
  return page.getByRole("article", { name, exact: true });
}

async function beginEvent(
  page: Page,
  name: string,
  date: string,
  category = "feriado_especifico",
) {
  await page
    .getByRole("button", { name: "Nova data especial", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await form
    .getByRole("textbox", { name: /^Nome da data especial/ })
    .fill(name);
  await form
    .getByRole("combobox", { name: "Categoria do evento", exact: true })
    .selectOption(category);
  await form.getByLabel("Data inicial", { exact: true }).fill(date);
  return form;
}

async function addEvent(
  page: Page,
  name: string,
  date: string,
  category = "feriado_especifico",
) {
  const form = await beginEvent(page, name, date, category);
  await saveForm(page);
  await expect(eventCard(page, name)).toBeVisible();
  return form;
}

async function editEvent(page: Page, name: string) {
  await eventCard(page, name)
    .getByRole("button", { name: "Editar data especial", exact: true })
    .click();
  return page.getByRole("dialog");
}

async function removeEvent(page: Page, name: string) {
  await eventCard(page, name)
    .getByRole("button", { name: "Excluir data especial", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar", exact: true })
    .click();
  await expect(eventCard(page, name)).toHaveCount(0);
}

async function schedules(page: Page) {
  await tab(page, "Escalas");
  await expect(page.getByRole("gridcell")).toHaveCount(31);
}

function cell(page: Page, date: string) {
  return page.locator(`[data-date="${date}"]`);
}

async function dayForm(page: Page, date: string) {
  await cell(page, date).click();
  return page.getByRole("dialog");
}

async function saveDay(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Salvar na prévia", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}

async function saveSchedule(page: Page) {
  await page
    .getByRole("button", { name: "Salvar escala", exact: true })
    .click();
}

async function copyBaseModel(page: Page, name: string) {
  await tab(page, "Jornadas e modelos");
  const reference = page
    .getByRole("region", { name: "Biblioteca de modelos-base", exact: true })
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: baseModel, exact: true }),
    });
  await reference
    .getByRole("button", { name: "Personalizar nesta empresa", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Nome do modelo", { exact: true })
    .fill(name);
  await saveForm(page);
}

async function setWork(form: Locator, entry: string, exit: string) {
  await form.getByLabel("Entrada", { exact: true }).fill(entry);
  await form.getByLabel("Início do intervalo", { exact: true }).fill("");
  await form.getByLabel("Retorno", { exact: true }).fill("");
  await form.getByLabel("Saída", { exact: true }).fill(exit);
}

async function switchCompany(page: Page, companyId: string) {
  await page
    .getByRole("combobox", { name: "Empresa ativa", exact: true })
    .selectOption(companyId);
  await expect(
    page.getByRole("combobox", { name: "Empresa ativa", exact: true }),
  ).toHaveValue(companyId);
}

test("feriado empresarial altera o calendário existente e permanece isolado da outra empresa", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await start(page);
  const name = "Feriado administrativo exclusivo Aurora";
  await addEvent(page, name, "2026-12-01");
  const dismiss = page.getByRole("button", {
    name: "Fechar mensagem",
    exact: true,
  });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.screenshot({
    path: testInfo.outputPath("datas-especiais-gerenciamento-desktop.png"),
  });
  await schedules(page);
  await expect(cell(page, "2026-12-01")).toContainText(name);
  await expect(cell(page, "2026-12-01")).toHaveAttribute(
    "data-day-kind",
    "feriado",
  );
  await expect(cell(page, "2026-12-01")).not.toContainText("08:00");
  await page
    .getByRole("region", { name: "Calendário da escala", exact: true })
    .evaluate((element) => {
      window.scrollTo({
        top: Math.max(
          0,
          element.getBoundingClientRect().top + window.scrollY - 100,
        ),
        behavior: "instant",
      });
    });
  await page.screenshot({
    path: testInfo.outputPath("datas-especiais-calendario-desktop.png"),
  });
  await switchCompany(page, beta);
  await expect(cell(page, "2026-12-01")).toContainText("15:00");
  await expect(cell(page, "2026-12-01")).not.toContainText(name);
  await tab(page, "Feriados");
  await expect(eventCard(page, name)).toHaveCount(0);
  await switchCompany(page, alpha);
  await expect(eventCard(page, name)).toBeVisible();
});

test("feriado trabalhado individual mantém a natureza e resiste à exclusão do evento empresarial", async ({
  page,
}) => {
  await start(page);
  const name = "Feriado da equipe em dezembro";
  await addEvent(page, name, "2026-12-03");
  await schedules(page);
  const form = await dayForm(page, "2026-12-03");
  await form
    .getByRole("combobox", { name: "Tipo do dia", exact: true })
    .selectOption("feriado_trabalhado");
  await form
    .getByRole("textbox", { name: /^Nome da data especial/ })
    .fill(name);
  await setWork(form, "08:00", "12:00");
  await form
    .getByRole("textbox", { name: "Observação", exact: true })
    .fill("Plantão individual autorizado para conferência");
  await saveDay(page);
  await expect(cell(page, "2026-12-03")).toHaveAttribute(
    "data-day-kind",
    "feriado_trabalhado",
  );
  await expect(cell(page, "2026-12-03")).toContainText("4h00");
  await saveSchedule(page);
  await tab(page, "Feriados");
  await removeEvent(page, name);
  await schedules(page);
  await expect(cell(page, "2026-12-03")).toContainText(name);
  await expect(cell(page, "2026-12-03")).toContainText("08:00");
  await dayForm(page, "2026-12-03");
  await expect(
    form.getByRole("textbox", { name: "Observação", exact: true }),
  ).toHaveValue("Plantão individual autorizado para conferência");
  await form
    .getByRole("button", { name: "Remover exceção individual", exact: true })
    .click();
  await saveDay(page);
  await expect(cell(page, "2026-12-03")).toContainText("17:24");
  await expect(cell(page, "2026-12-03")).not.toContainText(name);
});

test("ponto facultativo depende da decisão da empresa: normal, reduzido ou sem expediente", async ({
  page,
}) => {
  await start(page);
  const name = "Ponto facultativo da empresa";
  const form = await beginEvent(page, name, "2026-12-02", "ponto_facultativo");
  await expect(
    form.getByRole("combobox", { name: "Situação do expediente", exact: true }),
  ).toHaveValue("normal");
  await saveForm(page);
  await schedules(page);
  await expect(cell(page, "2026-12-02")).toContainText(name);
  await expect(cell(page, "2026-12-02")).toContainText("17:24");
  await expect(cell(page, "2026-12-02")).toHaveAttribute(
    "data-day-kind",
    "ponto_facultativo",
  );
  await tab(page, "Feriados");
  await editEvent(page, name);
  await form
    .getByRole("combobox", { name: "Situação do expediente", exact: true })
    .selectOption("reduzido");
  await form
    .getByLabel("Horários do expediente reduzido", { exact: true })
    .fill("09:00-12:00");
  await saveForm(page);
  await schedules(page);
  await expect(cell(page, "2026-12-02")).toContainText("09:00");
  await expect(cell(page, "2026-12-02")).toContainText("3h00");
  await expect(cell(page, "2026-12-02")).not.toContainText("17:24");
  await tab(page, "Feriados");
  await editEvent(page, name);
  await form
    .getByRole("combobox", { name: "Situação do expediente", exact: true })
    .selectOption("sem_expediente");
  await saveForm(page);
  await schedules(page);
  await expect(cell(page, "2026-12-02")).not.toContainText("09:00");
  await expect(cell(page, "2026-12-02")).toContainText(name);
  await expect(cell(page, "2026-12-03")).toContainText("17:24");
});

test("feriado com expediente usa o modelo ao regenerar, preserva folga e restaura a dispensa ao excluir", async ({
  page,
}) => {
  await start(page);
  const name = "Atendimento no Natal conforme modelo";
  const form = await beginEvent(page, name, "2026-12-25");
  await form
    .getByRole("combobox", { name: "Recorrência", exact: true })
    .selectOption("periodo");
  await form.locator('[name="data_fim"]').fill("2026-12-26");
  await form
    .getByRole("combobox", { name: "Situação do expediente", exact: true })
    .selectOption("normal");
  await saveForm(page);
  await schedules(page);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Gerar prévia", exact: true }).click();
  await expect(cell(page, "2026-12-25")).toContainText("17:24");
  await expect(cell(page, "2026-12-25")).toContainText("8h24");
  await expect(cell(page, "2026-12-25")).toHaveAttribute(
    "data-day-kind",
    "feriado_trabalhado",
  );
  await expect(cell(page, "2026-12-26")).not.toContainText("08:00");
  await saveSchedule(page);
  await tab(page, "Feriados");
  await editEvent(page, name);
  await form
    .getByRole("combobox", { name: "Situação do expediente", exact: true })
    .selectOption("reduzido");
  await form
    .getByLabel("Horários do expediente reduzido", { exact: true })
    .fill("09:00-12:00");
  await saveForm(page);
  await schedules(page);
  await expect(cell(page, "2026-12-25")).toContainText("09:00");
  await expect(cell(page, "2026-12-25")).toContainText("3h00");
  await expect(cell(page, "2026-12-26")).not.toContainText("09:00");
  await tab(page, "Feriados");
  await removeEvent(page, name);
  await schedules(page);
  await expect(cell(page, "2026-12-25")).toContainText("Natal");
  await expect(cell(page, "2026-12-25")).not.toContainText("09:00");
  await expect(cell(page, "2026-12-25")).not.toContainText("08:00");
  await expect(cell(page, "2026-12-26")).not.toContainText("08:00");
});

test("recesso em período preserva Natal, folgas e exceções individuais sem presumir férias", async ({
  page,
}) => {
  await start(page);
  const name = "Recesso de final de ano da Aurora";
  const form = await beginEvent(page, name, "2026-12-24", "recesso");
  await form
    .getByRole("combobox", { name: "Recorrência", exact: true })
    .selectOption("periodo");
  await form.locator('[name="data_fim"]').fill("2026-12-31");
  await saveForm(page);
  await schedules(page);
  for (const date of [
    "2026-12-24",
    "2026-12-25",
    "2026-12-26",
    "2026-12-28",
    "2026-12-31",
  ])
    await expect(cell(page, date)).toContainText(name);
  await expect(cell(page, "2026-12-25")).toContainText("Natal");
  await expect(cell(page, "2026-12-26")).not.toContainText("08:00");
  await expect(cell(page, "2026-12-28")).not.toContainText("08:00");
  await dayForm(page, "2026-12-28");
  await form
    .getByRole("combobox", { name: "Tipo do dia", exact: true })
    .selectOption("trabalho");
  await setWork(form, "09:00", "12:00");
  await saveDay(page);
  await expect(cell(page, "2026-12-28")).toContainText("3h00");
  await expect(cell(page, "2026-12-28")).toContainText(name);
  await saveSchedule(page);
  await tab(page, "Feriados");
  await removeEvent(page, name);
  await schedules(page);
  await expect(cell(page, "2026-12-28")).toContainText("09:00");
  await expect(cell(page, "2026-12-29")).toContainText("17:24");
  await expect(cell(page, "2026-12-25")).toContainText("Natal");
  await expect(cell(page, "2026-12-26")).not.toContainText("08:00");
});

test("dia sem expediente individual é editável, removível e preservado ao gerar nova prévia", async ({
  page,
}) => {
  await start(page);
  await schedules(page);
  const form = await dayForm(page, "2026-12-04");
  await form
    .getByRole("combobox", { name: "Tipo do dia", exact: true })
    .selectOption("sem_expediente");
  await form
    .getByRole("textbox", { name: /^Nome da data especial/ })
    .fill("Dispensa individual do expediente");
  await form
    .getByRole("textbox", { name: "Observação", exact: true })
    .fill("Decisão administrativa individual");
  await saveDay(page);
  await expect(cell(page, "2026-12-04")).toHaveAttribute(
    "data-day-kind",
    "sem_expediente",
  );
  await expect(cell(page, "2026-12-04")).not.toContainText("08:00");
  await saveSchedule(page);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Gerar prévia", exact: true }).click();
  await expect(cell(page, "2026-12-04")).toContainText(
    "Dispensa individual do expediente",
  );
  await expect(cell(page, "2026-12-04")).not.toContainText("08:00");
  await dayForm(page, "2026-12-04");
  await form
    .getByRole("button", { name: "Remover exceção individual", exact: true })
    .click();
  await saveDay(page);
  await expect(cell(page, "2026-12-04")).toContainText("17:24");
});

test("abrangência selecionada oferece somente funcionários da empresa e não alcança o outro vínculo", async ({
  page,
}) => {
  await start(page);
  const ownModel = "Modelo da equipe para datas especiais";
  await copyBaseModel(page, ownModel);
  const form = page.getByRole("dialog");
  await tab(page, "Funcionários");
  await page
    .getByRole("button", { name: "Adicionar funcionário", exact: true })
    .click();
  await form
    .getByLabel("Nome do funcionário", { exact: true })
    .fill("Clara da mesma empresa");
  await form
    .getByRole("combobox", {
      name: "Modelo individual de jornada",
      exact: true,
    })
    .selectOption({ label: ownModel });
  await form
    .getByRole("spinbutton", { name: /^Carga semanal contratual/ })
    .fill("42");
  await saveForm(page);
  await tab(page, "Feriados");
  const name = "Dispensa apenas de Mariana";
  await beginEvent(page, name, "2026-12-07");
  await form
    .getByRole("combobox", {
      name: "Abrangência dos funcionários",
      exact: true,
    })
    .selectOption("selecionados");
  const people = form.getByRole("group", {
    name: "Funcionários abrangidos",
    exact: true,
  });
  await expect(people.getByLabel("Rafael Lima", { exact: true })).toHaveCount(
    0,
  );
  await people.getByLabel("Mariana Costa", { exact: true }).check();
  await saveForm(page);
  await schedules(page);
  await expect(cell(page, "2026-12-07")).toContainText(name);
  await page
    .getByRole("combobox", { name: "Funcionário", exact: true })
    .selectOption({ label: "Clara da mesma empresa" });
  await page.getByRole("button", { name: "Gerar prévia", exact: true }).click();
  await expect(cell(page, "2026-12-07")).toContainText("17:24");
  await expect(cell(page, "2026-12-07")).not.toContainText(name);
});

test("recorrência anual atravessa o ano e datas móveis não recebem repetição fixa", async ({
  page,
}) => {
  await start(page);
  const ownModel = "Modelo próprio para calendário anual";
  await copyBaseModel(page, ownModel);
  await tab(page, "Feriados");
  const name = "Aniversário fixo da empresa";
  const form = await beginEvent(page, name, "2026-12-08");
  await form
    .getByRole("combobox", { name: "Recorrência", exact: true })
    .selectOption("anual");
  await saveForm(page);
  await schedules(page);
  await page.getByLabel("Mês da escala", { exact: true }).fill("2027-12");
  await page
    .getByRole("combobox", { name: "Modelo de jornada", exact: true })
    .selectOption({ label: ownModel });
  await page.getByRole("button", { name: "Gerar prévia", exact: true }).click();
  await expect(cell(page, "2027-12-08")).toContainText(name);
  await saveSchedule(page);
  await tab(page, "Feriados");
  await beginEvent(page, "Carnaval", "2027-02-09", "ponto_facultativo");
  await expect(
    form
      .getByRole("combobox", { name: "Recorrência", exact: true })
      .locator('option[value="anual"]'),
  ).toHaveJSProperty("disabled", true);
  await expect(
    form.getByRole("combobox", { name: "Recorrência", exact: true }),
  ).toHaveValue("unica");
  await expect(
    form.getByText(/datas móveis|data móvel/i).first(),
  ).toBeVisible();
  await form.getByRole("button", { name: "Cancelar", exact: true }).click();
});

test("estabelecimentos opcionais mantêm feriados municipais independentes", async ({
  page,
}) => {
  await start(page);
  await tab(page, "Configurações");
  const units = page.getByRole("region", {
    name: "Estabelecimentos e localidades",
    exact: true,
  });
  await units
    .getByRole("button", { name: "Novo estabelecimento", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await form
    .getByLabel("Nome do estabelecimento", { exact: true })
    .fill("Unidade Dormentes");
  await form
    .getByLabel("Município do estabelecimento", { exact: true })
    .fill("Dormentes");
  await form.getByLabel("UF do estabelecimento", { exact: true }).fill("PE");
  await saveForm(page);
  await tab(page, "Funcionários");
  await page
    .locator(".employee-card")
    .getByRole("button", { name: "Editar funcionário", exact: true })
    .click();
  await form
    .getByRole("combobox", { name: "Estabelecimento (opcional)", exact: true })
    .selectOption({ label: "Unidade Dormentes · Dormentes/PE" });
  await saveForm(page);
  await tab(page, "Feriados");
  const dormentes = "Feriado municipal de Dormentes";
  await beginEvent(page, dormentes, "2026-12-09", "feriado_municipal");
  await form.getByLabel("UF do feriado", { exact: true }).fill("PE");
  await form
    .getByLabel("Município do feriado", { exact: true })
    .fill("Dormentes");
  await saveForm(page);
  const petrolina = "Feriado municipal de Petrolina";
  await beginEvent(page, petrolina, "2026-12-10", "feriado_municipal");
  await form.getByLabel("UF do feriado", { exact: true }).fill("PE");
  await form
    .getByLabel("Município do feriado", { exact: true })
    .fill("Petrolina");
  await saveForm(page);
  await schedules(page);
  await expect(cell(page, "2026-12-09")).toContainText(dormentes);
  await expect(cell(page, "2026-12-09")).not.toContainText("08:00");
  await expect(cell(page, "2026-12-10")).not.toContainText(petrolina);
  await expect(cell(page, "2026-12-10")).toContainText("17:24");
});

test("inativar uma data restaura a programação e a interface continua utilizável em 375px", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  const name = "Recesso individual desativável";
  const form = await beginEvent(page, name, "2026-12-11", "recesso");
  await form
    .getByRole("combobox", {
      name: "Abrangência dos funcionários",
      exact: true,
    })
    .selectOption("funcionario");
  await form
    .getByRole("combobox", { name: "Funcionário abrangido", exact: true })
    .selectOption(mariana);
  await page.screenshot({
    path: testInfo.outputPath("datas-especiais-form-desktop.png"),
  });
  await page.setViewportSize({ width: 375, height: 844 });
  await form.evaluate((element) => {
    element.scrollTop = 0;
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: testInfo.outputPath("datas-especiais-form-mobile.png"),
  });
  await saveForm(page);
  await schedules(page);
  await expect(cell(page, "2026-12-11")).toContainText(name);
  await tab(page, "Feriados");
  await editEvent(page, name);
  await form.getByLabel("Data especial ativa", { exact: true }).uncheck();
  await saveForm(page);
  await expect(eventCard(page, name)).toContainText("Inativa");
  await schedules(page);
  await expect(cell(page, "2026-12-11")).not.toContainText(name);
  await expect(cell(page, "2026-12-11")).toContainText("17:24");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await cell(page, "2026-12-11").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("datas-especiais-calendar-mobile.png"),
  });
  expect(errors).toEqual([]);
});

test("exportações levam eventos e feriado trabalhado sem preencher marcações reais da folha", async ({
  page,
}, testInfo) => {
  await start(page);
  await addEvent(page, "Recesso para relatório", "2026-12-14", "recesso");
  await schedules(page);
  const form = await dayForm(page, "2026-12-25");
  await form
    .getByRole("combobox", { name: "Tipo do dia", exact: true })
    .selectOption("feriado_trabalhado");
  await form
    .getByRole("textbox", { name: /^Nome da data especial/ })
    .fill("Natal");
  await setWork(form, "08:00", "12:00");
  await saveDay(page);
  await expect(
    page.getByRole("region", { name: "Conferência da escala", exact: true }),
  ).toBeVisible();
  const downloaded: Record<string, Buffer> = {};
  for (const [label, extension] of [
    ["PDF", "pdf"],
    ["Excel", "xlsx"],
    ["CSV", "csv"],
    ["Folha de ponto", "pdf"],
  ]) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    const file = await pending;
    expect(await file.failure()).toBeNull();
    const path = testInfo.outputPath(`${label}.${extension}`);
    await file.saveAs(path);
    downloaded[label] = await readFile(path);
  }
  const csv = downloaded.CSV.toString("utf8");
  expect(csv).toContain("Recesso para relatório");
  expect(csv).toContain("Natal");
  expect(csv).toContain("Feriado trabalhado");
  expect(csv).toContain("Mariana Costa");
  expect(csv).toContain("Aurora Contabilidade");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(downloaded.Excel).buffer);
  const excel = JSON.stringify(
    workbook.worksheets.map((sheet) => sheet.getSheetValues()),
  );
  expect(excel).toContain("Recesso para relatório");
  expect(excel).toContain("Feriado trabalhado");
  for (const key of ["PDF", "Folha de ponto"])
    expect(downloaded[key].subarray(0, 5).toString()).toBe("%PDF-");
  const point = downloaded["Folha de ponto"].toString("latin1");
  expect(point).toContain("Recesso para");
  expect(point).toContain("Assinatura do funcionário");
  expect(point).not.toContain("Responsável pela empresa");
});

/** Only the transport is mocked here; SQL/RLS roundtrips have separate PGlite tests. */
async function mockAuthenticatedPersistence(page: Page) {
  const source = demoData();
  const remap = new Map<string, string>();
  let number = 1;
  const uuid = (id: string) => {
    if (!remap.has(id))
      remap.set(
        id,
        `91000000-0000-4000-8000-${String(number++).padStart(12, "0")}`,
      );
    return remap.get(id)!;
  };
  for (const key of [
    "companies",
    "employees",
    "models",
    "rules",
    "holidays",
    "schedules",
  ] as const)
    for (const row of source[key]) uuid(row.id);
  const replace = (value: unknown): unknown => {
    if (typeof value === "string") return remap.get(value) ?? value;
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, replace(entry)]),
      );
    return value;
  };
  const data = replace(source) as Data;
  data.specialDates = [];
  data.establishments = [];
  const tables: Record<string, unknown[]> = {
    empresas: data.companies,
    funcionarios: data.employees,
    modelos_jornada: data.models,
    parametros_legais: data.rules,
    feriados: data.holidays,
    escalas: data.schedules,
    log_alteracoes: [],
    datas_especiais: data.specialDates,
    estabelecimentos: data.establishments,
  };
  const mutations: { rpc: string; body: Record<string, unknown> }[] = [];
  const unexpected: string[] = [];
  const userId = "92000000-0000-4000-8000-000000000001";
  const user = {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email: "teste-local@example.invalid",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  };
  const expires = Math.floor(Date.now() / 1000) + 86400;
  const jwt = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: userId,
        aud: "authenticated",
        role: "authenticated",
        exp: expires,
      }),
    ).toString("base64url"),
    "local-test-only",
  ].join(".");
  await page.route(/https?:\/\/[^/]+\.supabase\.(?:co|in)\//, async (route) => {
    unexpected.push(route.request().url());
    await route.abort();
  });
  await page.route("**/auth/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        path.endsWith("/user")
          ? user
          : {
              access_token: jwt,
              refresh_token: "local-test-only",
              token_type: "bearer",
              expires_in: 86400,
              expires_at: expires,
              user,
            },
      ),
    });
  });
  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split("/rest/v1/")[1];
    if (path.startsWith("rpc/")) {
      const rpc = path.slice(4);
      const body = route.request().postDataJSON() as Record<string, unknown>;
      mutations.push({ rpc, body });
      if (rpc === "salvar_registro_empresa") {
        const table = String(body.p_tabela);
        const value = body.p_valores as Record<string, unknown>;
        const id =
          typeof body.p_id === "string" ? body.p_id : uuid(`created-${number}`);
        const index = tables[table].findIndex(
          (entry) => (entry as { id: string }).id === id,
        );
        const next = {
          ...(index >= 0 ? (tables[table][index] as object) : {}),
          ...value,
          id,
        };
        if (index >= 0) tables[table][index] = next;
        else tables[table].push(next);
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(id),
        });
        return;
      }
      if (rpc === "salvar_escalas_empresa" || rpc === "salvar_escalas") {
        for (const item of body.itens as Record<string, unknown>[]) {
          const index = tables.escalas.findIndex((entry) => {
            const schedule = entry as Record<string, unknown>;
            return (
              schedule.funcionario_id === item.funcionario_id &&
              schedule.mes === item.mes
            );
          });
          const next = {
            ...item,
            dias: (item.dias as Record<string, unknown>[]).map((day) =>
              Object.fromEntries(
                [
                  "data",
                  "intervalos",
                  "folga",
                  "feriado",
                  "observacao",
                  "calendario",
                ]
                  .filter((key) => day[key] !== undefined)
                  .map((key) => [key, day[key]]),
              ),
            ),
            id:
              index >= 0
                ? (tables.escalas[index] as { id: string }).id
                : uuid(`schedule-${number}`),
          };
          if (index >= 0) tables.escalas[index] = next;
          else tables.escalas.push(next);
        }
        await route.fulfill({ contentType: "application/json", body: "null" });
        return;
      }
      if (rpc === "excluir_data_especial") {
        const index = tables.datas_especiais.findIndex(
          (entry) => (entry as { id: string }).id === body.p_id,
        );
        if (index >= 0) tables.datas_especiais.splice(index, 1);
        await route.fulfill({ contentType: "application/json", body: "null" });
        return;
      }
      unexpected.push(rpc);
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Unexpected mock RPC" }),
      });
      return;
    }
    let rows = tables[path];
    if (!rows) {
      unexpected.push(path);
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Unexpected mock table" }),
      });
      return;
    }
    for (const [key, value] of url.searchParams)
      if (value.startsWith("eq."))
        rows = rows.filter(
          (row) =>
            String((row as Record<string, unknown>)[key]) === value.slice(3),
        );
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(rows),
    });
  });
  return {
    companyId: uuid(alpha),
    employeeId: uuid(mariana),
    mutations,
    unexpected,
  };
}

test("modo autenticado com transporte simulado recarrega eventos e exceções salvos sem armazenamento de demonstração", async ({
  page,
}) => {
  const mock = await mockAuthenticatedPersistence(page);
  await page.goto(`/?empresa=${mock.companyId}&pagina=feriados&mes=2026-12`);
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("teste-local@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill("somente-teste-local");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Feriados e datas especiais",
      exact: true,
    }),
  ).toBeVisible();
  const name = "Feriado persistido pela API simulada";
  await addEvent(page, name, "2026-12-15");
  await schedules(page);
  const form = await dayForm(page, "2026-12-15");
  await form
    .getByRole("combobox", { name: "Tipo do dia", exact: true })
    .selectOption("feriado_trabalhado");
  await form
    .getByRole("textbox", { name: /^Nome da data especial/ })
    .fill(name);
  await setWork(form, "08:00", "12:00");
  await saveDay(page);
  await saveSchedule(page);
  await page.reload();
  await expect(cell(page, "2026-12-15")).toContainText(name);
  await expect(cell(page, "2026-12-15")).toContainText("08:00");
  await expect(cell(page, "2026-12-15")).toHaveAttribute(
    "data-day-kind",
    "feriado_trabalhado",
  );
  await tab(page, "Feriados");
  await removeEvent(page, name);
  await schedules(page);
  await page.reload();
  await expect(cell(page, "2026-12-15")).toContainText(name);
  await expect(cell(page, "2026-12-15")).toContainText("08:00");
  const eventWrite = mock.mutations.find(
    (entry) =>
      entry.rpc === "salvar_registro_empresa" &&
      entry.body.p_tabela === "datas_especiais",
  );
  expect(eventWrite?.body.p_empresa).toBe(mock.companyId);
  const scheduleWrite = mock.mutations.find(
    (entry) => entry.rpc === "salvar_escalas_empresa",
  );
  expect(scheduleWrite?.body.p_empresa).toBe(mock.companyId);
  expect(JSON.stringify(scheduleWrite?.body)).toContain("calendario");
  expect(mock.unexpected).toEqual([]);
  await expect(
    page.getByText("Modo demonstração", { exact: true }),
  ).toHaveCount(0);
});
