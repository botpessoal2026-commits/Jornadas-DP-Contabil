import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyShiftFields,
  fieldsFromShifts,
  shiftEditorText,
  validateShiftFields,
  validateShiftText,
  type ShiftFields,
} from "../src/lib/shift-editor";
import type { Shift } from "../src/lib/types";
const standard: ShiftFields = {
  ...emptyShiftFields,
  entry: "08:00",
  breakStart: "12:00",
  breakEnd: "13:00",
  exit: "17:24",
};

test("campos separados calculam 8h24 de trabalho e 1h de intervalo", () => {
  const result = validateShiftFields(standard);
  assert.equal(result.worked, 504);
  assert.equal(result.pause, 60);
  assert.equal(result.shifts?.length, 2);
  assert.deepEqual(result.errors, {});
});

test("abc e horários fora de faixa retornam erro específico no campo sem alterar a entrada", () => {
  for (const value of ["abc", "24:00", "12:60", "8:00", ""]) {
    const input = { ...standard, entry: value };
    const result = validateShiftFields(input);
    assert.equal(result.shifts, null);
    assert.ok(result.errors.entry);
    assert.equal(input.entry, value);
  }
});

test("saída antes da entrada e pausa incompleta ou invertida são inválidas", () => {
  for (const values of [
    { ...standard, exit: "07:00" },
    { ...standard, breakStart: "07:00" },
    { ...standard, breakEnd: "11:00" },
    { ...standard, breakEnd: "" },
    { ...standard, exit: "12:30" },
  ])
    assert.equal(validateShiftFields(values).shifts, null);
});

test("jornada noturna exige indicação de data e preserva pausa depois de meia-noite", () => {
  const overnight: ShiftFields = {
    ...emptyShiftFields,
    entry: "22:00",
    breakStart: "02:00",
    breakEnd: "03:00",
    exit: "06:00",
    breakStartDay: 1,
    breakEndDay: 1,
    exitDay: 1,
  };
  const result = validateShiftFields(overnight);
  assert.equal(result.worked, 420);
  assert.equal(result.pause, 60);
  assert.equal(result.shifts?.[1].startDay, 1);
  assert.deepEqual(fieldsFromShifts(result.shifts!), overnight);
  assert.equal(validateShiftFields({ ...overnight, exitDay: 0 }).shifts, null);
});

test("mesmo horário não vira 24h silenciosamente; data explícita distingue as situações", () => {
  const values = { ...emptyShiftFields, entry: "08:00", exit: "08:00" };
  assert.equal(validateShiftFields(values).shifts, null);
  assert.equal(validateShiftFields({ ...values, exitDay: 1 }).worked, 1440);
});

test("horário válido com duração irregular pode seguir para conferência como rascunho", () => {
  const result = validateShiftFields({ ...standard, exit: "23:00" });
  assert.equal(result.worked, 840);
  assert.ok(result.shifts);
});

test("jornada sem intervalo não exige preenchimento artificial de pausa", () => {
  const result = validateShiftFields({
    ...emptyShiftFields,
    entry: "08:00",
    exit: "12:00",
  });
  assert.equal(result.worked, 240);
  assert.equal(result.pause, 0);
  assert.equal(result.shifts?.length, 1);
});

test("editor avançado rejeita texto inválido e sobreposição, mas permite vazio como folga", () => {
  assert.equal(validateShiftText("abc").shifts, null);
  assert.match(validateShiftText("abc").errors.intervals!, /Período 1/);
  assert.equal(validateShiftText("08:00-12:00, 11:00-17:00").shifts, null);
  assert.equal(validateShiftText("22:00-06:00").shifts, null);
  assert.deepEqual(validateShiftText("").shifts, []);
});

test("texto avançado preserva todos os períodos e datas num roundtrip", () => {
  const shifts: Shift[] = [
    { start: "22:00", end: "01:00", endDay: 1 },
    { start: "02:00", end: "04:00", startDay: 1, endDay: 1 },
    { start: "05:00", end: "06:00", startDay: 1, endDay: 1 },
  ];
  const text = shiftEditorText(shifts);
  const result = validateShiftText(text);
  assert.equal(result.shifts?.length, 3);
  assert.equal(result.worked, 360);
  assert.equal(result.pause, 120);
  assert.equal(shiftEditorText(result.shifts!), text);
  assert.equal(validateShiftText("22:00-02:00 +1, 03:00-06:00 +1").worked, 420);
});

test("primeiro período já no dia seguinte é preservado sem inferência", () => {
  const shifts: Shift[] = [
    { start: "02:00", end: "06:00", startDay: 1, endDay: 1 },
  ];
  const text = shiftEditorText(shifts);
  assert.equal(text, "02:00 +1-06:00 +1");
  assert.equal(validateShiftText(text).worked, 240);
  assert.deepEqual(fieldsFromShifts(shifts).entryDay, 1);
});

test("texto noturno legado infere apenas início do segundo período já no dia seguinte", () => {
  const result = validateShiftText("22:00-02:00 +1, 03:00-05:00 +1");
  assert.equal(result.worked, 360);
  assert.equal(result.pause, 60);
  assert.equal(result.shifts?.[0].startDay, 0);
  assert.equal(result.shifts?.[0].endDay, 1);
  assert.equal(result.shifts?.[1].startDay, 1);
  assert.equal(result.shifts?.[1].endDay, 1);
  const fields = fieldsFromShifts(result.shifts!);
  assert.equal(
    shiftEditorText(validateShiftFields(fields).shifts!),
    shiftEditorText(result.shifts!),
  );
});
