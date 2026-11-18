import type { Schedule } from "./types";
export type ScheduleWriteItem = Pick<
  Schedule,
  | "empresa_id"
  | "funcionario_id"
  | "modelo_id"
  | "mes"
  | "nome_funcionario"
  | "modelo_nome"
  | "modelo_tipo"
  | "dias"
> & { id: string | null; revisao_esperada?: number | null };
/** Only the fields consumed by the existing scoped persistence RPC. */
export function scheduleWriteItems(schedules: Schedule[]): ScheduleWriteItem[] {
  return schedules.map((schedule) => ({
    id: schedule.id || null,
    empresa_id: schedule.empresa_id,
    funcionario_id: schedule.funcionario_id,
    modelo_id: schedule.modelo_id,
    mes: schedule.mes,
    nome_funcionario: schedule.nome_funcionario,
    modelo_nome: schedule.modelo_nome,
    modelo_tipo: schedule.modelo_tipo,
    dias: schedule.dias,
    ...(schedule.revisao !== undefined
      ? { revisao_esperada: schedule.revisao }
      : !schedule.id
        ? { revisao_esperada: null }
        : {}),
  }));
}
