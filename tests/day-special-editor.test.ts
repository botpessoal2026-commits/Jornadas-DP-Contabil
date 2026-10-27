import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DayEditor, {
  dayEditorSource,
  individualDay,
} from "../src/components/day-editor";
import type { Day, DayException } from "../src/lib/types";
import { demoData } from "../src/lib/demo";
import { projectSchedule } from "../src/lib/special-dates";
import { computeDay } from "../src/lib/engine";

const planned: Day = {
  data: "2026-12-25",
  intervalos: [
    { start: "08:00", end: "12:00" },
    { start: "13:00", end: "17:24" },
  ],
  folga: false,
  feriado: null,
  observacao: "Programação original",
};

const exception: DayException = {
  categoria: "ponto_facultativo",
  nome: "Dispensa administrativa",
  expediente: "sem_expediente",
  intervalos: [],
  observacao: "Aplicável somente a este vínculo",
};
const originalPlan = {
  intervalos: planned.intervalos,
  folga: planned.folga,
  feriado: planned.feriado,
  observacao: planned.observacao,
};

test("editor oferece as sete classificações mantendo trabalho e folga legados", () => {
  const html = renderToStaticMarkup(
    createElement(DayEditor, { day: planned, onChange: () => {} }),
  );
  for (const [value, label] of [
    ["trabalho", "Trabalho"],
    ["folga", "Folga"],
    ["feriado", "Feriado"],
    ["feriado_trabalhado", "Feriado trabalhado"],
    ["ponto_facultativo", "Ponto facultativo"],
    ["recesso", "Recesso"],
    ["sem_expediente", "Dia sem expediente"],
  ]) {
    assert.ok(html.includes(`value="${value}"`));
    assert.ok(html.includes(`>${label}</option>`));
  }
  assert.ok(html.includes('value="trabalho" selected=""'));
  assert.ok(html.includes("Entrada"));
  assert.ok(html.includes("Início do intervalo"));
  assert.ok(html.includes("Retorno"));
  assert.ok(html.includes("Saída"));
  assert.ok(!html.includes("Remover exceção individual"));
});

test("editor preserva informações coincidentes e mostra a origem sem confundir recesso com feriado", () => {
  const holiday: Day = {
    ...planned,
    intervalos: [],
    folga: true,
    feriado: "Natal",
    eventos: [
      {
        id: "natal",
        nome: "Natal",
        categoria: "feriado_nacional",
        origem: "oficial",
        expediente: "sem_expediente",
      },
      {
        id: "recesso",
        nome: "Recesso de final de ano",
        categoria: "recesso",
        origem: "empresa",
        expediente: "sem_expediente",
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(DayEditor, { day: holiday, onChange: () => {} }),
  );
  assert.ok(html.includes("Natal"));
  assert.ok(html.includes("Recesso de final de ano"));
  assert.ok(html.includes("Calendário oficial"));
  assert.ok(html.includes("Empresa"));
  assert.ok(html.includes("Duração diária: 0h00"));
  assert.ok(html.includes("Nome da data especial"));
});

test("ponto facultativo com trabalho mantém editor de horários e escolha independente de expediente", () => {
  const optional: Day = {
    ...planned,
    calendario: {
      base: originalPlan,
      excecao: {
        ...exception,
        expediente: "normal",
        intervalos: planned.intervalos,
      },
    },
    eventos: [
      {
        id: "pf",
        nome: exception.nome,
        categoria: "ponto_facultativo",
        origem: "individual",
        expediente: "normal",
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(DayEditor, {
      day: optional,
      inheritedDay: planned,
      onChange: () => {},
    }),
  );
  assert.ok(html.includes('value="ponto_facultativo" selected=""'));
  assert.ok(html.includes("Situação do expediente"));
  assert.ok(html.includes("Expediente normal"));
  assert.ok(html.includes("Expediente reduzido"));
  assert.ok(html.includes("Duração diária: 8h24"));
  assert.ok(html.includes("Remover exceção individual"));
});

test("exceção individual guarda a programação original e não modifica os objetos recebidos", () => {
  const before = structuredClone({ planned, exception });
  const result = individualDay(planned, exception);
  assert.deepEqual(result.calendario?.base, originalPlan);
  assert.deepEqual(result.calendario?.excecao, exception);
  assert.deepEqual(result.intervalos, []);
  assert.equal(result.folga, true);
  assert.equal(result.feriado, null);
  assert.equal(result.observacao, exception.observacao);
  assert.notEqual(result.intervalos, exception.intervalos);
  assert.notEqual(result.calendario?.excecao, exception);
  assert.deepEqual({ planned, exception }, before);
});

test("trabalho em feriado mantém a natureza herdada e editar exceção não transforma a base em programação derivada", () => {
  const original = { ...originalPlan, feriado: "Natal" };
  const corporate = {
    ...planned,
    feriado: "Natal",
    intervalos: [],
    folga: true,
    calendario: { base: original, excecao: null },
  };
  const working: DayException = {
    ...exception,
    categoria: "trabalho",
    nome: "",
    expediente: "normal",
    intervalos: planned.intervalos,
  };
  const result = individualDay(corporate, working, corporate);
  assert.equal(result.feriado, "Natal");
  assert.equal(result.folga, false);
  assert.deepEqual(result.calendario?.base, original);
  const changed = individualDay(
    result,
    { ...working, observacao: "Nova justificativa" },
    corporate,
  );
  assert.deepEqual(changed.calendario?.base, original);
  assert.equal(changed.calendario?.excecao?.observacao, "Nova justificativa");
});

test("retirar feriado individual usa a natureza herdada e preserva horários noturnos", () => {
  const first = individualDay(planned, {
    ...exception,
    categoria: "feriado",
    nome: "Data específica",
  });
  const night = [{ start: "22:00", end: "06:00", endDay: 1 }];
  const result = individualDay(
    first,
    {
      ...exception,
      categoria: "trabalho",
      nome: "",
      expediente: "normal",
      intervalos: night,
    },
    planned,
  );
  assert.equal(result.feriado, null);
  assert.deepEqual(result.intervalos, night);
  assert.deepEqual(result.calendario?.base, originalPlan);
});

test("abrir uma exceção noturna projetada mantém seu horário original e suas observações individuais", () => {
  const original: DayException = {
    categoria: "trabalho",
    nome: "",
    expediente: "normal",
    intervalos: [{ start: "22:00", end: "06:00", endDay: 1 }],
    observacao: "Plantão individual autorizado",
  };
  const projected: Day = {
    ...planned,
    intervalos: [{ start: "22:00", end: "00:00", endDay: 1 }],
    observacao: "Plantão individual autorizado · Recesso da empresa",
    calendario: { base: originalPlan, excecao: original },
  };
  const before = structuredClone(projected);
  const source = dayEditorSource(projected);
  assert.deepEqual(source.intervals, original.intervalos);
  assert.equal(source.notes, original.observacao);
  const html = renderToStaticMarkup(
    createElement(DayEditor, { day: projected, onChange: () => {} }),
  );
  assert.ok(html.includes('value="06:00"'));
  assert.ok(html.includes("Duração diária: 8h00"));
  assert.ok(
    !html.includes("Plantão individual autorizado · Recesso da empresa"),
  );
  assert.deepEqual(projected, before);
});

test("feriado empresarial não promove uma exceção de trabalho a feriado individual", () => {
  const original: DayException = {
    categoria: "trabalho",
    nome: "",
    expediente: "normal",
    intervalos: planned.intervalos,
    observacao: "Horário específico",
  };
  const projected: Day = {
    ...planned,
    feriado: "Natal",
    observacao: "Horário específico · Informações corporativas",
    calendario: { base: originalPlan, excecao: original },
    eventos: [
      {
        id: "natal",
        nome: "Natal",
        categoria: "feriado_nacional",
        origem: "empresa",
        expediente: "sem_expediente",
      },
    ],
  };
  const source = dayEditorSource(projected);
  assert.equal(source.kind, "trabalho");
  assert.equal(source.name, "");
  assert.equal(source.notes, "Horário específico");
  const html = renderToStaticMarkup(
    createElement(DayEditor, { day: projected, onChange: () => {} }),
  );
  assert.ok(html.includes('value="trabalho" selected=""'));
  assert.ok(!html.includes('value="feriado_trabalhado" selected=""'));
  assert.ok(html.includes("Feriado nacional: Natal"));
});

test("nova observação individual começa com a observação base sem copiar avisos de eventos empresariais", () => {
  const projected: Day = {
    ...planned,
    observacao: "Programação original · Fechamento administrativo",
    calendario: { base: originalPlan, excecao: null },
  };
  assert.equal(dayEditorSource(projected).notes, originalPlan.observacao);
});

test("anotar um feriado ocupado pela continuação noturna preserva o trabalho do dia anterior", () => {
  const data = demoData();
  const previous: Day = {
    ...planned,
    data: "2026-12-24",
    intervalos: [{ start: "22:00", end: "02:00", endDay: 1 }],
  };
  const carried: Day = {
    ...planned,
    intervalos: [],
    folga: true,
    feriado: "Natal",
  };
  const source = dayEditorSource(carried, [previous, carried]);
  assert.equal(source.kind, "feriado_trabalhado");
  assert.equal(source.expedient, "normal");
  const edited = individualDay(
    carried,
    {
      categoria: "feriado",
      nome: source.name,
      expediente: source.expedient,
      intervalos: source.intervals,
      observacao: "Anotação do plantão anterior",
    },
    carried,
  );
  const projected = projectSchedule(
    { ...data.schedules[0], dias: [previous, edited] },
    data.companies[0],
    data.employees[0],
    [],
    [],
    [],
  );
  const target = projected.dias.find((day) => day.data === carried.data)!;
  assert.equal(computeDay(target, [], projected.dias).worked, 120);
  assert.equal(target.calendario?.excecao?.expediente, "normal");
  assert.deepEqual(previous.intervalos, [
    { start: "22:00", end: "02:00", endDay: 1 },
  ]);
});
