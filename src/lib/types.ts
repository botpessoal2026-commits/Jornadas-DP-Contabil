export type Shift = {
  start: string;
  end: string;
  startDay?: number;
  endDay?: number;
};
export type WeekPattern = Record<string, Shift[]>;
export type Company = {
  id: string;
  nome: string;
  cnpj: string;
  cidade: string;
  uf: string;
  cct: string;
  permite_6x1: boolean;
  limite_diario_minutos: number | null;
  usa_banco_horas: boolean;
  folgar_feriados?: boolean;
  nome_fantasia?: string;
  codigo_interno?: string;
  situacao?: "ativa" | "inativa" | "arquivada";
  endereco?: string;
  cep?: string;
  responsavel?: string;
  contato?: string;
  observacoes?: string;
  politica_domingo_feriado?: string;
  modelo_padrao_id?: string | null;
  carga_semanal_padrao_minutos?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};
export type Employee = {
  id: string;
  empresa_id: string;
  estabelecimento_id?: string | null;
  nome: string;
  cpf?: string | null;
  cargo: string;
  horario_contratual: string;
  carga_semanal_minutos?: number | null;
  dias_descanso: number[];
  matricula?: string;
  setor?: string;
  admissao?: string | null;
  situacao?: "ativo" | "inativo";
  modelo_padrao_id?: string | null;
  carga_diaria_minutos?: number | null;
  regras_especiais?: string;
  created_at?: string | null;
  updated_at?: string | null;
};
export type Model = {
  id: string;
  empresa_id: string | null;
  nome: string;
  tipo: "5x2" | "6x1" | "12x36" | "turnos" | "personalizado";
  padrao: WeekPattern;
  ciclo_inicio?: string | null;
  turno?: Shift[] | null;
};
export type LegalRule = {
  id: string;
  empresa_id?: string | null;
  nome: string;
  chave: string;
  valor: Record<string, number | boolean | string>;
  inicio_vigencia: string;
  fonte: string;
  observacao: string;
  confirmado: boolean;
};
export type Holiday = {
  id: string;
  empresa_id?: string | null;
  nome: string;
  data: string;
  abrangencia: "nacional" | "estadual" | "municipal";
  uf: string | null;
  cidade: string | null;
};
export type Day = {
  data: string;
  intervalos: Shift[];
  folga: boolean;
  feriado: string | null;
  observacao: string;
  calendario?: {
    base: DayPlan;
    excecao?: DayException | null;
    folgar_feriado?: boolean;
  } | null;
  eventos?: DateOccurrence[];
};
export type Establishment = {
  id: string;
  empresa_id: string;
  nome: string;
  cidade: string;
  uf: string;
  ativo: boolean;
};
export type SpecialDateCategory =
  | "feriado_nacional"
  | "feriado_estadual"
  | "feriado_municipal"
  | "feriado_especifico"
  | "ponto_facultativo"
  | "recesso"
  | "sem_expediente";
export type SpecialDate = {
  id: string;
  empresa_id: string;
  estabelecimento_id: string | null;
  nome: string;
  data_inicio: string;
  data_fim: string | null;
  categoria: SpecialDateCategory;
  alcance: "empresa" | "selecionados" | "funcionario";
  funcionario_ids: string[];
  recorrencia: "unica" | "anual" | "periodo";
  expediente: "sem_expediente" | "normal" | "reduzido" | "individual";
  intervalos: Shift[];
  observacoes: string;
  ativo: boolean;
  data_movel: boolean;
  uf: string | null;
  cidade: string | null;
};
export type DayPlan = {
  intervalos: Shift[];
  folga: boolean;
  feriado: string | null;
  observacao: string;
};
export type DayException = {
  categoria:
    | "trabalho"
    | "folga"
    | "feriado"
    | "ponto_facultativo"
    | "recesso"
    | "sem_expediente";
  nome: string;
  expediente: "normal" | "sem_expediente" | "reduzido";
  intervalos: Shift[];
  observacao: string;
};
export type DateOccurrence = {
  id: string;
  nome: string;
  categoria: SpecialDateCategory;
  origem: "empresa" | "estabelecimento" | "individual" | "oficial";
  expediente: SpecialDate["expediente"];
};
export type Schedule = {
  id: string;
  empresa_id: string;
  funcionario_id: string;
  modelo_id: string | null;
  mes: string;
  dias: Day[];
  nome_funcionario?: string;
  modelo_nome?: string;
  modelo_tipo?: Model["tipo"];
};
export type Alert = {
  ruleId?: string;
  period?: { start: string; end: string };
  date: string;
  code: string;
  message: string;
  rule: string;
  source: string;
  severity: "erro" | "aviso";
};
