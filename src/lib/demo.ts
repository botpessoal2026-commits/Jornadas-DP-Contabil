import { initialModels, initialRules, initialHolidays } from "./presets";
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
  const otherCompany = {
    ...company,
    id: "demo-company-beta",
    nome: "Horizonte Serviços",
    cnpj: "04252011000110",
    cidade: "São Paulo",
    uf: "SP",
    modelo_padrao_id: "demo-model-beta",
    carga_semanal_padrao_minutos: 1800,
    situacao: "ativa" as const,
  };
  const otherEmployee = {
    ...employee,
    id: "demo-employee-beta",
    empresa_id: otherCompany.id,
    nome: "Rafael Lima",
    cargo: "Analista de operações",
    horario_contratual: "30 horas semanais",
    carga_semanal_minutos: 1800,
    setor: "Operações",
  };
  const otherModel = {
    ...models[0],
    id: "demo-model-beta",
    empresa_id: otherCompany.id,
    nome: "Administrativo · 30h",
    padrao: Object.fromEntries(
      [1, 2, 3, 4, 5].map((d) => [
        String(d),
        [
          { start: "08:00", end: "12:00" },
          { start: "13:00", end: "15:00" },
        ],
      ]),
    ),
  };
  const holidays = initialHolidays(2026).map((h, i) => ({
    ...h,
    id: `demo-holiday-${i}`,
  }));
  return {
    companies: [company, otherCompany],
    employees: [employee, otherEmployee],
    models: [...models, otherModel],
    rules: initialRules.map((r, i) => ({
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
      {
        id: "demo-schedule-beta",
        empresa_id: otherCompany.id,
        funcionario_id: otherEmployee.id,
        modelo_id: otherModel.id,
        mes: "2026-12-01",
        nome_funcionario: otherEmployee.nome,
        modelo_nome: otherModel.nome,
        modelo_tipo: otherModel.tipo,
        dias: generateDays("2026-12", otherModel, otherCompany, holidays),
      },
    ],
    logs: [],
  };
}
