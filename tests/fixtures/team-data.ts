import { generateCalendarDays } from "../../src/lib/special-dates";
import { rotationFixture, rotationIds } from "./rotation-data";
import type { Data } from "../../src/lib/store";
import type { Schedule } from "../../src/lib/types";
export const teamIds = {
  ...rotationIds,
  normal: "81000000-0000-4000-8000-000000000009",
  normalModel: "81000000-0000-4000-8000-000000000010",
  inactive: "81000000-0000-4000-8000-000000000011",
  foreignModel: "81000000-0000-4000-8000-000000000012",
};
export const selectedTeam = [
  teamIds.employee,
  teamIds.colleague,
  teamIds.normal,
];
export function teamFixture() {
  const data = rotationFixture();
  data.models.push({
    ...data.models[0],
    id: teamIds.normalModel,
    tipo: "5x2",
    nome: "Administrativo 40h",
    padrao: Object.fromEntries(
      [1, 2, 3, 4, 5].map((day) => [
        String(day),
        [
          { start: "08:00", end: "12:00" },
          { start: "13:00", end: "17:00" },
        ],
      ]),
    ),
    ciclo_inicio: null,
    turno: null,
  });
  data.employees.push(
    {
      ...data.employees[0],
      id: teamIds.normal,
      nome: "Carla",
      modelo_padrao_id: teamIds.normalModel,
      carga_semanal_minutos: 2400,
      dias_descanso: [0, 6],
    },
    {
      ...data.employees[0],
      id: teamIds.inactive,
      nome: "Inativa",
      situacao: "inativo",
    },
  );
  data.companies[0].horario_funcionamento = {
    semana: Object.fromEntries(
      Array.from({ length: 7 }, (_, day) => [
        String(day),
        [
          { start: "07:00", end: "12:00" },
          { start: "13:00", end: "19:00" },
        ],
      ]),
    ),
    minimo_funcionarios: 1,
    feriados: "seguir_semana",
  };
  return data;
}
export function normalTeamSchedule(data: Data, month = "2027-01"): Schedule {
  const employee = data.employees.find((item) => item.id === teamIds.normal)!,
    model = data.models.find((item) => item.id === teamIds.normalModel)!;
  const previous = data.schedules.find(
    (item) =>
      item.funcionario_id === employee.id && item.mes.slice(0, 7) === month,
  );
  return {
    id: previous?.id ?? "",
    revisao: previous?.revisao,
    status: previous?.status ?? "rascunho",
    empresa_id: teamIds.company,
    funcionario_id: employee.id,
    mes: `${month}-01`,
    modelo_id: model.id,
    modelo_nome: model.nome,
    modelo_tipo: model.tipo,
    nome_funcionario: employee.nome,
    dias: generateCalendarDays(month, model, data.companies[0], [], false),
  };
}
