import type { LegalRule, Model, WeekPattern, Holiday } from "./types";
import { default12x36Values } from "./work-regime";
import {
  commonTransitionReferences,
  constitutionalReference,
} from "./legal-reference";
// Dados de cadastro editáveis. O motor não importa este arquivo: só consome linhas do banco.
export const initialRules: Omit<LegalRule, "id">[] = [
  {
    nome: "Regime de referência — 44h",
    chave: "regime",
    valor: {
      limite_semanal_minutos: 2640,
      limite_diario_minutos: 480,
      permite_limite_empresa: true,
      descansos_semanais: 1,
      preferir_domingo: true,
    },
    inicio_vigencia: "1988-10-05",
    fonte:
      "CF, art. 7º, XIII e XV — https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm",
    observacao: "Conferir versão vigente, compensação e instrumento coletivo.",
    confirmado: false,
  },
  {
    nome: "Intervalo intrajornada — referência CLT",
    chave: "intervalo",
    valor: {
      acima_minutos: 360,
      entre_inicio_minutos: 240,
      intervalo_longo_minutos: 60,
      intervalo_curto_minutos: 15,
    },
    inicio_vigencia: "1943-05-01",
    fonte:
      "CLT, art. 71 — https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm",
    observacao: "Conferir exceções, categoria e negociação coletiva.",
    confirmado: false,
  },
  {
    nome: "Interjornada — referência CLT",
    chave: "interjornada",
    valor: { minutos: 660 },
    inicio_vigencia: "1943-05-01",
    fonte:
      "CLT, art. 66 — https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm",
    observacao: "Conferir aplicação à categoria.",
    confirmado: false,
  },
  {
    nome: "Noturno urbano — referência CLT",
    chave: "noturno",
    valor: {
      inicio_minutos: 1320,
      fim_minutos: 300,
      hora_reduzida_segundos: 3150,
      adicional_percentual: 20,
    },
    inicio_vigencia: "1943-05-01",
    fonte:
      "CLT, art. 73 — https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm",
    observacao:
      "Referência urbana. Não cobre regime rural, prorrogação, remuneração ou exceções de CCT.",
    confirmado: false,
  },
  {
    nome: "Divisor mensal de referência",
    chave: "divisor",
    valor: { fator: 5 },
    inicio_vigencia: "1988-10-05",
    fonte: "Fórmula solicitada: horas semanais × 5. Conferir categoria e CCT.",
    observacao:
      "Divisor não corresponde ao total efetivamente trabalhado no calendário.",
    confirmado: false,
  },
  {
    nome: "Regime 12×36 — referência do art. 59-A",
    chave: "regime",
    valor: { ...default12x36Values },
    inicio_vigencia: "2017-11-11",
    fonte:
      "CLT, art. 59-A — https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm; EC 141/2026 — https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc141.htm",
    observacao:
      "Referência para conferência. Registre o acordo individual escrito, CCT ou ACT e sua comprovação. Adeque a média e os repousos às vigências de 16/12/2026 e 16/12/2027; esta referência não comprova o instrumento aplicável.",
    confirmado: false,
  },
  ...commonTransitionReferences,
  ...commonTransitionReferences.map((reference) => ({
    ...reference,
    nome: `Regime 12×36 — referência ${Number(reference.valor.limite_semanal_minutos) / 60}h / dois repousos`,
    valor: {
      ...default12x36Values,
      limite_media_semanal_minutos: Number(
        reference.valor.limite_semanal_minutos,
      ),
      descansos_semanais: 2,
      fonte_versao: constitutionalReference.version,
      fonte_consultada_em: constitutionalReference.reviewedAt,
      escopo: "referencia_geral",
    },
    fonte: `CLT, art. 59-A — https://www2.camara.leg.br/legin/fed/declei/1940-1949/decreto-lei-5452-1-maio-1943-415500-normaatualizada-pe.html; ${reference.fonte}`,
    observacao:
      "Comprove o acordo individual escrito, CCT ou ACT do plantão. O fundamento do 12×36 não comprova dispensa dos limites constitucionais. Para compensar os dois repousos na média mensal, o art. 7º, § 2º, da CF exige CCT/ACT aplicável e conferido. " +
      constitutionalReference.salaryReference,
  })),
];
// Compatibilidade de importação: exemplos atuais, sem conferência do vínculo.
export const demonstrationRules: Omit<LegalRule, "id">[] =
  commonTransitionReferences.map((rule) => ({
    ...structuredClone(rule),
    nome: `Demonstração — ${Number(rule.valor.limite_semanal_minutos) / 60}h / conferir enquadramento`,
    confirmado: false,
  }));
const standard: WeekPattern = Object.fromEntries(
  [1, 2, 3, 4, 5].map((d) => [
    String(d),
    [
      { start: "08:00", end: "12:00" },
      { start: "13:00", end: "17:24" },
    ],
  ]),
);
export const initialModels: Omit<Model, "id">[] = [
  {
    empresa_id: null,
    nome: "5×2 · 42h · seg a sex",
    tipo: "5x2",
    padrao: standard,
  },
  {
    empresa_id: null,
    nome: "5×2 · 4 dias de 8h + 1 de 10h",
    tipo: "5x2",
    padrao: Object.fromEntries(
      [1, 2, 3, 4, 5].map((d) => [
        String(d),
        [
          { start: "08:00", end: "12:00" },
          { start: "13:00", end: d === 5 ? "19:00" : "17:00" },
        ],
      ]),
    ),
  },
  {
    empresa_id: null,
    nome: "6×1 · 42h · depende de CCT",
    tipo: "6x1",
    padrao: Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((d) => [
        String(d),
        [
          { start: "08:00", end: "12:00" },
          { start: "13:00", end: "16:00" },
        ],
      ]),
    ),
  },
];
export function initialHolidays(year: number): Omit<Holiday, "id">[] {
  const fixed = [
    ["01-01", "Confraternização Universal"],
    ["04-21", "Tiradentes"],
    ["05-01", "Dia do Trabalho"],
    ["09-07", "Independência do Brasil"],
    ["10-12", "Nossa Senhora Aparecida"],
    ["11-02", "Finados"],
    ["11-15", "Proclamação da República"],
    ["11-20", "Consciência Negra"],
    ["12-25", "Natal"],
  ];
  return [
    ...fixed.map(([date, nome]) => ({
      nome,
      data: `${year}-${date}`,
      abrangencia: "nacional" as const,
      uf: null,
      cidade: null,
    })),
    {
      nome: "Data Magna de Pernambuco — conferir calendário local",
      data: `${year}-03-06`,
      abrangencia: "estadual",
      uf: "PE",
      cidade: null,
    },
  ];
}
