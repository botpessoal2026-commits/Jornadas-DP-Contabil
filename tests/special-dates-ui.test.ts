import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SpecialDates, {
  EstablishmentFields,
  EstablishmentsPanel,
  SpecialDateFields,
} from "../src/components/special-dates";
import { demoData } from "../src/lib/demo";
import type { Establishment, SpecialDate } from "../src/lib/types";

const data = demoData();
const company = data.companies[0];
const employee = data.employees[0];
const special: SpecialDate = {
  id: "event-a",
  empresa_id: company.id,
  estabelecimento_id: null,
  nome: "Recesso da equipe",
  data_inicio: "2026-12-24",
  data_fim: "2026-12-31",
  categoria: "recesso",
  alcance: "empresa",
  funcionario_ids: [],
  recorrencia: "periodo",
  expediente: "sem_expediente",
  intervalos: [],
  observacoes: "Programação administrativa",
  ativo: true,
  data_movel: false,
  uf: null,
  cidade: null,
};
const unit: Establishment = {
  id: "unit-a",
  empresa_id: company.id,
  nome: "Unidade Recife",
  cidade: "Recife",
  uf: "PE",
  ativo: true,
};

test("gerenciamento mostra apenas eventos da empresa e inclui recorrências no mês consultado", () => {
  const html = renderToStaticMarkup(
    createElement(SpecialDates, {
      company,
      employees: data.employees,
      establishments: [unit],
      month: "2026-12",
      events: [
        special,
        {
          ...special,
          id: "fixed",
          nome: "Aniversário fixo anual",
          data_inicio: "2020-12-12",
          data_fim: null,
          recorrencia: "anual",
        },
        {
          ...special,
          id: "old",
          nome: "Evento encerrado de outubro",
          data_inicio: "2026-10-01",
          data_fim: null,
          recorrencia: "unica",
        },
        {
          ...special,
          id: "foreign",
          empresa_id: data.companies[1].id,
          nome: "Evento reservado da outra empresa",
        },
      ],
      onEdit: () => {},
      onDelete: () => {},
    }),
  );
  assert.ok(html.includes("Recesso da equipe"));
  assert.ok(html.includes("Aniversário fixo anual"));
  assert.ok(!html.includes("Evento encerrado de outubro"));
  assert.ok(!html.includes("Evento reservado da outra empresa"));
  assert.ok(html.includes("Todas as datas"));
  assert.ok(html.includes("Inativas"));
  assert.ok(html.includes("Excluir data especial"));
});

test("formulário conserva alcance individual e horários reduzidos sem oferecer vínculo de outra empresa", () => {
  const html = renderToStaticMarkup(
    createElement(SpecialDateFields, {
      company,
      month: "2026-12",
      employees: [
        { ...employee, estabelecimento_id: unit.id },
        data.employees[1],
      ],
      establishments: [
        unit,
        {
          ...unit,
          id: "foreign-unit",
          empresa_id: data.companies[1].id,
          nome: "Unidade reservada",
        },
      ],
      event: {
        ...special,
        categoria: "ponto_facultativo",
        alcance: "funcionario",
        funcionario_ids: [employee.id],
        estabelecimento_id: unit.id,
        expediente: "reduzido",
        intervalos: [{ start: "08:00", end: "12:00" }],
      },
    }),
  );
  assert.ok(html.includes(employee.nome));
  assert.ok(!html.includes(data.employees[1].nome));
  assert.ok(!html.includes("Unidade reservada"));
  assert.ok(html.includes('name="funcionario_ids"'));
  assert.ok(html.includes(employee.id));
  assert.ok(html.includes('value="08:00-12:00"'));
  assert.ok(html.includes("Jornada reduzida: 4h00"));
  assert.ok(html.includes("Configuração individual por funcionário"));
});

test("data móvel não oferece recorrência anual e dispensa não presume efeitos salariais", () => {
  const html = renderToStaticMarkup(
    createElement(SpecialDateFields, {
      company,
      employees: data.employees,
      establishments: [],
      month: "2026-12",
      event: {
        ...special,
        nome: "Carnaval",
        data_movel: true,
        categoria: "ponto_facultativo",
        expediente: "normal",
      },
    }),
  );
  assert.match(html, /value="anual" disabled=""/);
  assert.ok(html.includes("Datas móveis não se repetem por dia e mês"));
  assert.ok(html.includes('value="normal" selected=""'));
  assert.ok(
    html.includes(
      "não aplicam férias, falta, desconto, banco de horas ou pagamento adicional automaticamente",
    ),
  );
});

test("estabelecimentos são opcionais e mantêm localidade principal e isolamento dos registros", () => {
  const html = renderToStaticMarkup(
    createElement(EstablishmentsPanel, {
      company,
      establishments: [
        unit,
        {
          ...unit,
          id: "foreign",
          empresa_id: data.companies[1].id,
          nome: "Unidade reservada",
        },
      ],
      onEdit: () => {},
    }),
  );
  assert.ok(html.includes("Localidade principal"));
  assert.ok(html.includes("Unidade Recife"));
  assert.ok(!html.includes("Unidade reservada"));
  const form = renderToStaticMarkup(
    createElement(EstablishmentFields, { company }),
  );
  assert.ok(form.includes('name="empresa_id"'));
  assert.ok(
    form.includes("funcionários sem vínculo usam a localidade principal"),
  );
  assert.ok(form.includes('value="Recife"'));
  assert.ok(form.includes('value="PE"'));
});
