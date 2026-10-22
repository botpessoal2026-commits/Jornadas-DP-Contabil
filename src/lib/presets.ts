import type { LegalRule, Model, WeekPattern, Holiday } from './types';
// Dados de cadastro editáveis. O motor não importa este arquivo: só consome linhas do banco.
const proposed='Hipótese fornecida no pedido. EC nº 141/2026 e vigências NÃO verificadas. Conferir publicação oficial e CCT antes de confirmar.';
export const initialRules: Omit<LegalRule,'id'>[] = [
 {nome:'Regime de referência — 44h',chave:'regime',valor:{limite_semanal_minutos:2640,limite_diario_minutos:480,descansos_semanais:1,preferir_domingo:true},inicio_vigencia:'1988-10-05',fonte:'CF, art. 7º, XIII e XV — https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm',observacao:'Conferir versão vigente, compensação e instrumento coletivo.',confirmado:false},
 {nome:'Proposta 42h / 5x2 — conferir vigência',chave:'regime',valor:{limite_semanal_minutos:2520,limite_diario_minutos:480,descansos_semanais:2,preferir_domingo:true},inicio_vigencia:'2026-12-15',fonte:'Informação do solicitante — publicação oficial ainda não verificada.',observacao:proposed+' Há divergência entre 15 e 16/12. 8h24 exige limite diário e CCT compatíveis.',confirmado:false},
 {nome:'Proposta 40h / 5x2 — data estimada',chave:'regime',valor:{limite_semanal_minutos:2400,limite_diario_minutos:480,descansos_semanais:2,preferir_domingo:true},inicio_vigencia:'2027-12-01',fonte:'Informação do solicitante — data estimada, não confirmada.',observacao:proposed+' 01/12/2027 é apenas uma referência editável, não uma data legal validada.',confirmado:false},
 {nome:'Intervalo intrajornada — referência CLT',chave:'intervalo',valor:{acima_minutos:360,entre_inicio_minutos:240,intervalo_longo_minutos:60,intervalo_curto_minutos:15},inicio_vigencia:'1943-05-01',fonte:'CLT, art. 71 — https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm',observacao:'Conferir exceções, categoria e negociação coletiva.',confirmado:false},
 {nome:'Interjornada — referência CLT',chave:'interjornada',valor:{minutos:660},inicio_vigencia:'1943-05-01',fonte:'CLT, art. 66 — https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm',observacao:'Conferir aplicação à categoria.',confirmado:false},
 {nome:'Noturno urbano — referência CLT',chave:'noturno',valor:{inicio_minutos:1320,fim_minutos:300,hora_reduzida_segundos:3150,adicional_percentual:20},inicio_vigencia:'1943-05-01',fonte:'CLT, art. 73 — https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm',observacao:'Referência urbana. Não cobre regime rural, prorrogação, remuneração ou exceções de CCT.',confirmado:false},
 {nome:'Divisor mensal de referência',chave:'divisor',valor:{fator:5},inicio_vigencia:'1988-10-05',fonte:'Fórmula solicitada: horas semanais × 5. Conferir categoria e CCT.',observacao:'Divisor não corresponde ao total efetivamente trabalhado no calendário.',confirmado:false}
];
const standard:WeekPattern=Object.fromEntries([1,2,3,4,5].map(d=>[String(d),[{start:'08:00',end:'12:00'},{start:'13:00',end:'17:24'}]]));
export const initialModels:Omit<Model,'id'>[]=[
 {empresa_id:null,nome:'5×2 · 42h · seg a sex',tipo:'5x2',padrao:standard},
 {empresa_id:null,nome:'5×2 · 4 dias de 8h + 1 de 10h',tipo:'5x2',padrao:Object.fromEntries([1,2,3,4,5].map(d=>[String(d),[{start:'08:00',end:'12:00'},{start:'13:00',end:d===5?'19:00':'17:00'}]]))},
 {empresa_id:null,nome:'6×1 · 42h · depende de CCT',tipo:'6x1',padrao:Object.fromEntries([1,2,3,4,5,6].map(d=>[String(d),[{start:'08:00',end:'12:00'},{start:'13:00',end:'16:00'}]]))}
];
export function initialHolidays(year:number):Omit<Holiday,'id'>[] {
 const fixed=[['01-01','Confraternização Universal'],['04-21','Tiradentes'],['05-01','Dia do Trabalho'],['09-07','Independência do Brasil'],['10-12','Nossa Senhora Aparecida'],['11-02','Finados'],['11-15','Proclamação da República'],['11-20','Consciência Negra'],['12-25','Natal']];
 return [...fixed.map(([date,nome])=>({nome,data:`${year}-${date}`,abrangencia:'nacional' as const,uf:null,cidade:null})),{nome:'Data Magna de Pernambuco — conferir calendário local',data:`${year}-03-06`,abrangencia:'estadual',uf:'PE',cidade:null}];
}
