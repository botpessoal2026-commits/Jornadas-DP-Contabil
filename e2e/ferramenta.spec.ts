import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

const originalHTMLSHA256 =
  "cb05b6f42c9346eadecc93e71471aa1f32fb580e5fe0892a232e23ac3dab46e8";

test("ferramenta: abre diretamente a demonstração sem acessar cadastros do Supabase", async ({
  page,
}) => {
  const calls: string[] = [];
  await page.route(/https:\/\/[^/]*supabase\.(co|in)\//, async (route) => {
    calls.push(route.request().url());
    await route.abort();
  });
  await page.goto("/ferramenta");
  await expect(
    page.getByRole("heading", { name: "Seu mês, bem planejado." }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("demo")).toBe("1");
  await expect(
    page.getByText("Modo demonstração", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Escalas mensais", exact: true })
    .click();
  await expect(page.getByRole("gridcell")).toHaveCount(31);
  expect(calls).toEqual([]);
});

test("ferramenta: entrega HTML original e ZIP com cabeçalho de download", async ({
  request,
}) => {
  const html = await request.get(
    "/arquivos/gerador-de-jornadas-cont-contabil.html",
  );
  expect(html.status()).toBe(200);
  expect(html.headers()["content-disposition"]).toBe(
    'attachment; filename="gerador-de-jornadas-cont-contabil.html"',
  );
  expect(
    createHash("sha256")
      .update(await html.body())
      .digest("hex"),
  ).toBe(originalHTMLSHA256);
  const zip = await request.get(
    "/arquivos/gerador-de-jornadas-cont-contabil.zip",
  );
  expect(zip.status()).toBe(200);
  expect(zip.headers()["content-disposition"]).toBe(
    'attachment; filename="gerador-de-jornadas-cont-contabil.zip"',
  );
  expect((await zip.body()).subarray(0, 4).toString("hex")).toBe("504b0304");
});

test("ferramenta: abertura no celular sem transbordamento horizontal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ferramenta");
  await expect(
    page.getByRole("heading", { name: "Seu mês, bem planejado." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
