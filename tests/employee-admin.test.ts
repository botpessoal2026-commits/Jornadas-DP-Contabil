import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EmployeeDetails,
  EmployeeDirectory,
} from "../src/components/employee-admin";
import { demoData } from "../src/lib/demo";
import type { Data } from "../src/lib/store";
import type { Model } from "../src/lib/types";
import CompanyFields from "../src/components/company-fields";
import EmployeeFields from "../src/components/employee-fields";

const noop = () => {};
function twoCompanies() {
  const data = demoData();
  const company = data.companies[0];
  data.companies.push({ ...company, id: "company-beta", nome: "Empresa Beta" });
  data.employees.push({
    ...data.employees[0],
    id: "employee-beta",
    empresa_id: "company-beta",
    nome: "Pessoa exclusiva Beta",
  });
  return data;
}

test("diretório contextual mostra somente vínculos da empresa selecionada", () => {
  const data = twoCompanies();
  const html = renderToStaticMarkup(
    createElement(EmployeeDirectory, {
      data,
      companyId: data.companies[0].id,
      month: "2026-12",
      onEdit: noop,
      onOpen: noop,
      onSchedules: noop,
      onToggleStatus: noop,
    }),
  );
  assert.ok(html.includes("Mariana Costa"));
  assert.ok(!html.includes("Pessoa exclusiva Beta"));
  assert.ok(!html.includes("Empresa Beta"));
});

test("detalhe mantém modelo e carga individuais ao trocar padrão da empresa", () => {
  const data = demoData();
  const employee = {
    ...data.employees[0],
    modelo_padrao_id: data.models[1].id,
    carga_semanal_minutos: 1800,
  };
  const render = (modelId: string) =>
    renderToStaticMarkup(
      createElement(EmployeeDetails, {
        data,
        employee,
        company: { ...data.companies[0], modelo_padrao_id: modelId },
        month: "2026-12",
        onEdit: noop,
        onSchedules: noop,
        onClose: noop,
      }),
    );
  for (const modelId of [data.models[0].id, data.models[2].id]) {
    const html = render(modelId);
    assert.ok(html.includes(`${data.models[1].nome} · individual`));
    assert.ok(html.includes("30h00"));
  }
  assert.equal(employee.carga_semanal_minutos, 1800);
  assert.equal(employee.modelo_padrao_id, data.models[1].id);
});

test("detalhe não associa histórico legado ou eventos de outra empresa por suposição", () => {
  const data = twoCompanies();
  const employee = data.employees[0],
    company = data.companies[0];
  data.logs = [
    {
      id: "own",
      tabela: "funcionarios",
      acao: "UPDATE",
      alterado_em: "2026-12-01T12:00:00Z",
      empresa_id: company.id,
      registro_id: employee.id,
      ator_id: "ator-empresa-correta",
    },
    {
      id: "wrong-company",
      tabela: "funcionarios",
      acao: "UPDATE",
      alterado_em: "2026-12-01T12:00:00Z",
      empresa_id: "company-beta",
      registro_id: employee.id,
      ator_id: "ator-empresa-incorreta",
    },
    {
      id: "legacy",
      tabela: "funcionarios",
      acao: "UPDATE",
      alterado_em: "2026-12-01T12:00:00Z",
      ator_id: "ator-legado-sem-contexto",
    },
  ] as Data["logs"];
  const html = renderToStaticMarkup(
    createElement(EmployeeDetails, {
      data,
      employee,
      company,
      month: "2026-12",
      onEdit: noop,
      onSchedules: noop,
      onClose: noop,
    }),
  );
  assert.ok(html.includes("ator-empresa-correta"));
  assert.ok(!html.includes("ator-empresa-incorreta"));
  assert.ok(!html.includes("ator-legado-sem-contexto"));
  const rejected = renderToStaticMarkup(
    createElement(EmployeeDetails, {
      data,
      employee: data.employees[1],
      company,
      month: "2026-12",
      onEdit: noop,
      onSchedules: noop,
      onClose: noop,
    }),
  );
  assert.ok(rejected.includes("não pertence à empresa selecionada"));
  assert.ok(!rejected.includes("Pessoa exclusiva Beta"));
});

test("detalhe identifica o CPF do vínculo e oferece folha apenas com escala da competência", () => {
  const data = demoData();
  const company = data.companies[0];
  const employee = { ...data.employees[0], cpf: "01234567890" };
  data.employees[1].cpf = "98765432100";
  const render = (month: string, cpf?: string | null) =>
    renderToStaticMarkup(
      createElement(EmployeeDetails, {
        data,
        company,
        employee: { ...employee, cpf },
        month,
        onEdit: noop,
        onSchedules: noop,
        onTimesheet: noop,
        onClose: noop,
      }),
    );
  const saved = render("2026-12", employee.cpf);
  assert.ok(saved.includes("<dt>CPF</dt><dd>012.345.678-90</dd>"));
  assert.ok(!saved.includes("987.654.321-00"));
  assert.ok(saved.includes("Emitir folha de ponto"));
  const absent = render("2027-01", null);
  assert.ok(absent.includes("<dt>CPF</dt><dd>Não informado</dd>"));
  assert.match(
    absent,
    /<button[^>]*disabled=""[^>]*>[\s\S]*?Emitir folha de ponto/,
  );
});

function formModels() {
  const data = demoData();
  const company = data.companies[0];
  const models: Model[] = [
    {
      ...data.models[0],
      id: "base",
      empresa_id: null,
      nome: "Biblioteca-base",
    },
    {
      ...data.models[0],
      id: "proprio",
      empresa_id: company.id,
      nome: "Modelo próprio Alfa",
    },
    {
      ...data.models[0],
      id: "outra-empresa",
      empresa_id: data.companies[1].id,
      nome: "Modelo exclusivo Beta",
    },
  ];
  return { data, company, models };
}

test("formulário da empresa oferece modelos próprios e preserva somente biblioteca já vinculada", () => {
  const { company, models } = formModels();
  const own = renderToStaticMarkup(
    createElement(CompanyFields, { company, models }),
  );
  assert.ok(own.includes('value="proprio"'));
  assert.ok(!own.includes('value="base"'));
  assert.ok(!own.includes("Modelo exclusivo Beta"));
  const fresh = renderToStaticMarkup(createElement(CompanyFields, { models }));
  assert.ok(!fresh.includes('value="proprio"'));
  assert.ok(!fresh.includes('value="base"'));
  const legacy = renderToStaticMarkup(
    createElement(CompanyFields, {
      company: { ...company, modelo_padrao_id: "base" },
      models,
    }),
  );
  assert.ok(legacy.includes('value="base"'));
  assert.ok(legacy.includes("biblioteca vinculada (legado)"));
  assert.ok(!legacy.includes("Modelo exclusivo Beta"));
});

test("formulário do funcionário bloqueia nova vinculação global e mantém padrão legado existente", () => {
  const { data, company, models } = formModels();
  const companies = [{ ...company, modelo_padrao_id: "base" }];
  const fresh = renderToStaticMarkup(
    createElement(EmployeeFields, {
      companies,
      models,
      companyId: company.id,
    }),
  );
  assert.ok(fresh.includes('value="proprio"'));
  assert.ok(!fresh.includes("Modelo exclusivo Beta"));
  assert.match(fresh, /<option[^>]*value="base"[^>]*disabled=""/);
  const legacy = renderToStaticMarkup(
    createElement(EmployeeFields, {
      companies,
      models,
      employee: { ...data.employees[0], modelo_padrao_id: "base" },
    }),
  );
  const option = legacy.match(/<option[^>]*value="base"[^>]*>/)?.[0];
  assert.ok(option?.includes("selected"));
  assert.ok(!option?.includes("disabled"));
  assert.ok(legacy.includes("biblioteca vinculada (legado)"));
});
