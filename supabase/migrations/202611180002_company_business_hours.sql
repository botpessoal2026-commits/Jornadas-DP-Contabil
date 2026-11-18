begin;
-- Configuração operacional opcional. Nenhum contrato, regra legal ou escala é reescrito.
alter table public.empresas add column if not exists horario_funcionamento jsonb;
create or replace function public.validar_horario_funcionamento(p_valor jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare dia integer; periodo jsonb; chave text; a integer; b integer; deslocamento integer;
 inicios integer[]:=array[]::integer[]; finais integer[]:=array[]::integer[]; i integer; j integer; semana jsonb; minimo numeric;
begin
 if p_valor is null or p_valor='null'::jsonb then return true; end if;
 if jsonb_typeof(p_valor)<>'object' then raise exception 'Horário de funcionamento inválido'; end if;
 for chave in select jsonb_object_keys(p_valor) loop
  if not chave=any(array['semana','minimo_funcionarios','feriados']) then raise exception 'Campo desconhecido no horário de funcionamento'; end if;
 end loop;
 if jsonb_typeof(p_valor->'minimo_funcionarios') is distinct from 'number' then raise exception 'Informe a cobertura mínima de funcionários'; end if;
 minimo:=(p_valor->>'minimo_funcionarios')::numeric;
 if minimo<>trunc(minimo) or minimo<1 or minimo>200 then raise exception 'A cobertura mínima deve ser inteira, entre 1 e 200'; end if;
 if coalesce(p_valor->>'feriados','') not in ('fechado','seguir_semana') then raise exception 'Escolha o funcionamento nos feriados'; end if;
 semana:=p_valor->'semana';
 if jsonb_typeof(semana) is distinct from 'object' then raise exception 'Informe os sete dias de funcionamento'; end if;
 if (select count(*) from jsonb_object_keys(semana))<>7 then raise exception 'Informe exatamente os sete dias da semana'; end if;
 for dia in 0..6 loop
  if jsonb_typeof(semana->dia::text) is distinct from 'array' then raise exception 'Períodos de funcionamento inválidos no dia %',dia; end if;
  if jsonb_array_length(semana->dia::text)>2 then raise exception 'Informe até dois períodos de funcionamento por dia'; end if;
  for periodo in select value from jsonb_array_elements(semana->dia::text) loop
   if jsonb_typeof(periodo)<>'object' then raise exception 'Período de funcionamento inválido'; end if;
   for chave in select jsonb_object_keys(periodo) loop
    if not chave=any(array['start','end','startDay','endDay']) then raise exception 'Campo desconhecido no período de funcionamento'; end if;
   end loop;
   if jsonb_typeof(periodo->'start') is distinct from 'string' or jsonb_typeof(periodo->'end') is distinct from 'string'
    or (periodo->>'start')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or (periodo->>'end')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Confira os horários de abertura e fechamento'; end if;
   if periodo ? 'startDay' and (jsonb_typeof(periodo->'startDay') is distinct from 'number' or (periodo->>'startDay')::numeric<>0) then raise exception 'A abertura deve pertencer ao dia informado'; end if;
   a:=split_part(periodo->>'start',':',1)::integer*60+split_part(periodo->>'start',':',2)::integer;
   b:=split_part(periodo->>'end',':',1)::integer*60+split_part(periodo->>'end',':',2)::integer;
   if periodo ? 'endDay' then
    if jsonb_typeof(periodo->'endDay') is distinct from 'number' or (periodo->>'endDay')::numeric not in (0,1) then raise exception 'O fechamento deve ocorrer no mesmo dia ou no seguinte'; end if;
    deslocamento:=(periodo->>'endDay')::integer;
   else deslocamento:=case when b<=a then 1 else 0 end;
   end if;
   b:=b+deslocamento*1440;
   if b<=a or b-a>1440 then raise exception 'Cada período de funcionamento deve ter duração positiva de até 24 horas'; end if;
   inicios:=array_append(inicios,dia*1440+a); finais:=array_append(finais,dia*1440+b);
  end loop;
 end loop;
 if coalesce(array_length(inicios,1),0)>1 then
  for i in 1..array_length(inicios,1) loop
   for j in 1..array_length(inicios,1) loop
    if i=j then continue; end if;
    foreach deslocamento in array array[-10080,0,10080] loop
     if inicios[i]<finais[j]+deslocamento and inicios[j]+deslocamento<finais[i] then raise exception 'Há períodos de funcionamento sobrepostos, inclusive na virada do dia'; end if;
    end loop;
   end loop;
  end loop;
 end if;
 return true;
end $$;
revoke all on function public.validar_horario_funcionamento(jsonb) from public,anon,authenticated;
grant execute on function public.validar_horario_funcionamento(jsonb) to authenticated;
do $constraint$
begin
 if not exists(select 1 from pg_constraint where conrelid='public.empresas'::regclass and conname='empresas_horario_funcionamento_valido') then
  alter table public.empresas add constraint empresas_horario_funcionamento_valido check(public.validar_horario_funcionamento(horario_funcionamento));
 end if;
end $constraint$;

-- Mantém as permissões, campos e validações anteriores; acrescenta somente o campo operacional.
create or replace function public.salvar_registro_empresa(p_empresa uuid,p_tabela text,p_valores jsonb,p_id uuid default null)
 returns uuid language plpgsql security invoker set search_path='' as $$
declare permitidos text[]; chave text; valores jsonb; anterior jsonb;
 colunas text; expressoes text; predicado text; resultado uuid; estado text;
begin
 if auth.uid() is null or p_empresa is null then raise exception 'Empresa indisponível ou sem permissão'; end if;
 if p_valores is null or jsonb_typeof(p_valores)<>'object' or p_valores='{}'::jsonb then raise exception 'Dados inválidos para o cadastro'; end if;
 select e.situacao into estado from public.empresas e where e.id=p_empresa and e.user_id=auth.uid() for share;
 if not found then raise exception 'Empresa indisponível ou sem permissão'; end if;
 if estado<>'ativa' and not (p_tabela='empresas' and p_id=p_empresa and p_valores='{"situacao":"ativa"}'::jsonb) then
  raise exception 'Empresa inativa ou arquivada: reative antes de novas operações';
 end if;
 case p_tabela
  when 'empresas' then permitidos:=array['nome','cnpj','cidade','uf','cct','permite_6x1','limite_diario_minutos','usa_banco_horas','folgar_feriados','nome_fantasia','codigo_interno','situacao','endereco','cep','responsavel','contato','observacoes','politica_domingo_feriado','modelo_padrao_id','carga_semanal_padrao_minutos','horario_funcionamento'];
  when 'funcionarios' then permitidos:=array['empresa_id','estabelecimento_id','nome','cpf','cargo','horario_contratual','carga_semanal_minutos','dias_descanso','matricula','setor','admissao','situacao','modelo_padrao_id','carga_diaria_minutos','regras_especiais'];
  when 'modelos_jornada' then permitidos:=array['empresa_id','nome','tipo','padrao','ciclo_inicio','turno'];
  when 'estabelecimentos' then permitidos:=array['empresa_id','nome','cidade','uf','ativo'];
  when 'datas_especiais' then permitidos:=array['empresa_id','estabelecimento_id','nome','data_inicio','data_fim','categoria','alcance','funcionario_ids','recorrencia','expediente','intervalos','observacoes','ativo','data_movel','uf','cidade'];
  when 'feriados' then permitidos:=array['empresa_id','nome','data','abrangencia','uf','cidade'];
  when 'parametros_legais' then permitidos:=array['empresa_id','nome','chave','valor','inicio_vigencia','fonte','observacao','confirmado'];
  else raise exception 'Cadastro não permitido neste contexto';
 end case;
 for chave in select jsonb_object_keys(p_valores) loop
  if not (chave=any(permitidos)) then raise exception 'Campo não permitido neste cadastro: %',chave; end if;
 end loop;
 if p_tabela='empresas' then
  if p_id is null or p_id<>p_empresa then raise exception 'A empresa do registro deve corresponder ao contexto'; end if;
  valores:=p_valores;
  predicado:='t.id=$3';
 else
  if p_valores ? 'empresa_id' and (p_valores->>'empresa_id')::uuid is distinct from p_empresa then
   raise exception 'A empresa dos dados deve corresponder ao contexto';
  end if;
  valores:=p_valores || jsonb_build_object('empresa_id',p_empresa);
  predicado:='t.empresa_id=$3';
 end if;
 if p_id is not null then
  execute format('select to_jsonb(t) from public.%I t where t.id=$1 and t.user_id=auth.uid() and %s for update',p_tabela,replace(predicado,'$3','$2'))
   into anterior using p_id,p_empresa;
  if anterior is null then raise exception 'Registro indisponível para esta empresa'; end if;
 end if;
 select string_agg(format('%I',k),',' order by k),string_agg(format('v.%I',k),',' order by k)
  into colunas,expressoes from jsonb_object_keys(valores) as k;
 if p_id is null then
  execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) v returning id',p_tabela,colunas,expressoes,p_tabela)
   into resultado using valores;
 else
  execute format('update public.%I t set (%s)=(select %s from jsonb_populate_record(null::public.%I,$1) v) where t.id=$2 and t.user_id=auth.uid() and %s returning t.id',p_tabela,colunas,expressoes,p_tabela,predicado)
   into resultado using valores,p_id,p_empresa;
 end if;
 if resultado is null then raise exception 'Registro indisponível para esta empresa'; end if;
 return resultado;
end $$;
revoke all on function public.salvar_registro_empresa(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.salvar_registro_empresa(uuid,text,jsonb,uuid) to authenticated;


commit;
