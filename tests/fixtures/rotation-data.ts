import { demoData } from "../../src/lib/demo";
export const rotationIds = {
  owner: "81000000-0000-4000-8000-000000000001",
  other: "81000000-0000-4000-8000-000000000002",
  company: "81000000-0000-4000-8000-000000000003",
  second: "81000000-0000-4000-8000-000000000004",
  employee: "81000000-0000-4000-8000-000000000005",
  colleague: "81000000-0000-4000-8000-000000000006",
  foreign: "81000000-0000-4000-8000-000000000007",
  model: "81000000-0000-4000-8000-000000000008",
};
export const rotationSelection = [
  { employeeId: rotationIds.employee, group: "A" as const },
  { employeeId: rotationIds.colleague, group: "B" as const },
];
export function rotationFixture() {
  const data = demoData();
  data.companies = [
    {
      ...data.companies[0],
      id: rotationIds.company,
      nome: "Empresa Revezamento",
      situacao: "ativa",
      folgar_feriados: false,
    },
    { ...data.companies[1], id: rotationIds.second, modelo_padrao_id: null },
  ];
  data.models = [
    {
      ...data.models[0],
      id: rotationIds.model,
      empresa_id: rotationIds.company,
      nome: "Plantão diurno",
      tipo: "12x36",
      ciclo_inicio: "2027-01-01",
      padrao: {},
      turno: [
        { start: "07:00", end: "12:00" },
        { start: "13:00", end: "19:00" },
      ],
    },
  ];
  data.employees = [
    {
      ...data.employees[0],
      id: rotationIds.employee,
      empresa_id: rotationIds.company,
      nome: "Ana",
      dias_descanso: [],
      modelo_padrao_id: rotationIds.model,
    },
    {
      ...data.employees[0],
      id: rotationIds.colleague,
      empresa_id: rotationIds.company,
      nome: "Bruna",
      dias_descanso: [],
      modelo_padrao_id: rotationIds.model,
    },
    {
      ...data.employees[1],
      id: rotationIds.foreign,
      empresa_id: rotationIds.second,
      modelo_padrao_id: null,
    },
  ];
  data.schedules = [];
  data.logs = [];
  data.holidays = [];
  data.specialDates = [];
  data.establishments = [];
  return data;
}
