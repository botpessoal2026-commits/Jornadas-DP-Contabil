import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWorkspaceLocation,
  workspaceHref,
} from "../src/lib/workspace-navigation";

const parseHref = (href: string) =>
  parseWorkspaceLocation(new URL(href, "https://example.invalid").search);

test("links individuais preservam empresa, funcionário, competência e visão após reabertura", () => {
  for (const companyId of ["demo-company", "demo-company-beta"]) {
    const link = workspaceHref({
      page: "escalas",
      companyId,
      employeeId: `${companyId}-employee`,
      month: "2026-12",
      scheduleView: "team",
      demo: true,
    });
    const location = parseHref(link);
    assert.deepEqual(location, {
      page: "escalas",
      companyId,
      employeeId: `${companyId}-employee`,
      month: "2026-12",
      scheduleView: "team",
      demo: true,
    });
  }
  assert.notEqual(
    workspaceHref({ page: "modelos", companyId: "demo-company" }),
    workspaceHref({ page: "modelos", companyId: "demo-company-beta" }),
  );
});

test("endereços de empresa abrem sua visão geral e o retorno à lista remove o contexto", () => {
  assert.equal(
    parseWorkspaceLocation("?empresa=alpha").page,
    "company-overview",
  );
  assert.equal(
    parseWorkspaceLocation("?empresa=alpha&pagina=inicio").page,
    "company-overview",
  );
  const directory = parseHref(
    workspaceHref({
      page: "empresas",
      companyId: "alpha",
      employeeId: "person-a",
    }),
  );
  assert.equal(directory.page, "empresas");
  assert.equal(directory.companyId, null);
  assert.equal(directory.employeeId, null);
  assert.equal(workspaceHref({ page: "inicio" }), "/");
  assert.deepEqual(parseWorkspaceLocation(""), {
    page: "inicio",
    companyId: null,
    employeeId: null,
    scheduleView: "individual",
    demo: false,
  });
});

test("URLs incompletas ou ambíguas não selecionam uma pessoa ou empresa por suposição", () => {
  for (const search of [
    "?pagina=company-settings",
    "?pagina=employee-detail&funcionario=person-a",
    "?pagina=escalas&funcionario=person-a",
    "?pagina=escalas&empresa=",
    "?pagina=escalas&empresa=alpha&empresa=beta",
    `?pagina=escalas&empresa=${"a".repeat(201)}`,
    "?empresa=alpha&pagina=unknown-page",
    "?empresa=alpha&pagina=modelos&pagina=escalas",
  ]) {
    const location = parseWorkspaceLocation(search);
    assert.equal(location.page, "empresas", search);
    assert.equal(location.companyId, null, search);
    assert.equal(location.employeeId, null, search);
  }
  const withoutEmployee = parseWorkspaceLocation(
    "?empresa=alpha&pagina=employee-detail",
  );
  assert.equal(withoutEmployee.page, "funcionarios");
  assert.equal(withoutEmployee.companyId, "alpha");
  assert.equal(withoutEmployee.employeeId, null);
});

test("páginas gerais continuam no mesmo módulo após reabrir um endereço sem seleção de funcionário", () => {
  for (const page of ["inicio", "escalas", "regras", "historico"]) {
    const reopened = parseHref(
      workspaceHref({
        page,
        companyId: null,
        employeeId: "",
        month: "2026-12",
        scheduleView: "team",
        demo: true,
      }),
    );
    assert.equal(reopened.page, page);
    assert.equal(reopened.companyId, null);
    assert.equal(reopened.employeeId, null);
    assert.equal(reopened.scheduleView, "team");
  }
});

test("competência inválida não chega à geração e modo de demonstração exige escolha explícita", () => {
  for (const month of ["2026-00", "2026-13", "2026-1", "2026-12-01", "abc"])
    assert.equal(
      parseWorkspaceLocation(`?empresa=alpha&pagina=escalas&mes=${month}`)
        .month,
      undefined,
    );
  assert.equal(
    parseWorkspaceLocation("?empresa=alpha&pagina=escalas&mes=2028-02").month,
    "2028-02",
  );
  for (const query of ["", "?demo=true", "?demo=1&demo=0"])
    assert.equal(parseWorkspaceLocation(query).demo, false);
  assert.equal(parseWorkspaceLocation("?demo=1").demo, true);
});

test("identificadores são codificados no endereço e continuam referências sem autorização implícita", () => {
  const companyId = "empresa & filial/á?";
  const employeeId = "pessoa + cadastro #2";
  const href = workspaceHref({
    page: "employee-detail",
    companyId,
    employeeId,
  });
  assert.ok(href.startsWith("/?"));
  assert.ok(!href.includes("#2"));
  const location = parseHref(href);
  assert.equal(location.companyId, companyId);
  assert.equal(location.employeeId, employeeId);
  // The caller must check existence/ownership; an unknown ID is not replaced.
  assert.equal(
    parseWorkspaceLocation("?empresa=unavailable&pagina=escalas").companyId,
    "unavailable",
  );
  assert.equal(
    parseWorkspaceLocation("?empresa=alpha%00beta&pagina=escalas").page,
    "empresas",
  );
});
