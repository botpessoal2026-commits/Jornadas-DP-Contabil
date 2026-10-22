import {
  initialModels,
  initialRules,
  initialHolidays,
  demonstrationRules,
} from "./presets";
import type { Data } from "./store";
import { generateDays } from "./engine";
export function demoData(): Data {
  const company = {
    id: "demo-company",
    nome: "Aurora Contabilidade",
    cnpj: "11222333000181",
    cidade: "Recife",
    uf: "PE",
    cct: "Exemplo demonstrativo. Nenhuma CCT validada.",
    permite_6x1: false,
    limite_diario_minutos: 504,
    usa_banco_horas: false,
  };
  const employee = {
    id: "demo-employee",
    empresa_id: company.id,
    nome: "Mariana Costa",
    cargo: "Assistente administrativo",
    horario_contratual: "42 horas semanais",
    carga_semanal_minutos: 2520,
    dias_descanso: [0, 6],
  };
  const models = initialModels.map((m, i) => ({ ...m, id: `demo-model-${i}` }));
  const holidays = initialHolidays(2026).map((h, i) => ({
    ...h,
    id: `demo-holiday-${i}`,
  }));
  return {
    companies: [company],
    employees: [employee],
    models,
    rules: [...initialRules, ...demonstrationRules].map((r, i) => ({
      ...r,
      id: `demo-rule-${i}`,
    })),
    holidays,
    schedules: [
      {
        id: "demo-schedule",
        empresa_id: company.id,
        funcionario_id: employee.id,
        modelo_id: models[0].id,
        mes: "2026-12-01",
        nome_funcionario: employee.nome,
        modelo_nome: models[0].nome,
        modelo_tipo: models[0].tipo,
        dias: generateDays("2026-12", models[0], company, holidays),
      },
    ],
    logs: [],
  };
}
