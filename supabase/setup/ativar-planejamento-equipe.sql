-- ATUALIZAÇÃO INCREMENTAL PARA O BANCO EXISTENTE.
-- Mantém registros, parâmetros legais e RLS. Novos horários continuam opcionais.
-- Reúne somente as migrations operacionais de revezamento, funcionamento e planejamento.
begin;
select pg_advisory_xact_lock(hashtext('cont_contabil_planejamento_equipe'));
do $base_existente$
declare nome text;
begin
 foreach nome in array array['empresas', 'funcionarios', 'modelos_jornada', 'escalas', 'escala_dias', 'feriados', 'parametros_legais', 'log_alteracoes', 'estabelecimentos', 'datas_especiais', 'escala_versoes', 'registros_operacionais', 'nomes_login', 'login_tentativas'] loop
  if to_regclass('public.'||nome) is null then raise exception 'Tabela % ausente. Confira as migrations anteriores antes de ativar o planejamento.',nome; end if;
  if not(select relrowsecurity from pg_class where oid=to_regclass('public.'||nome)) then raise exception 'RLS desativada em %. Revise a configuração antes de continuar.',nome; end if;
 end loop;
end $base_existente$;

-- Migration: 202611180001_rest_rotation.sql


-- Novo RPC apenas. Não altera tabelas, políticas, parâmetros ou registros existentes.
-- Modelos dos grupos, vínculos e escalas são gravados na mesma transação.
create or replace function public.salvar_revezamento_12x36(
 p_empresa uuid, p_mes date, p_referencia date,
 p_modelos jsonb, p_vinculos jsonb, itens jsonb
) returns void language plpgsql security invoker set search_path='' as $$
declare
 entrada jsonb; origem jsonb; destino jsonb; existente jsonb; esperado jsonb;
 vinculo jsonb; escala jsonb; f public.funcionarios; c public.empresas;
 mid uuid; eid uuid; grupo text; ancora date; chave text;
begin
 perform public.verificar_empresa_operavel(p_empresa,auth.uid());
 select * into c from public.empresas where id=p_empresa and user_id=auth.uid() for update;
 if not found then raise exception 'Empresa indisponível ou sem permissão'; end if;
 if p_mes is null or extract(day from p_mes)<>1 or p_referencia is null
  or p_referencia>(p_mes+interval '1 month'-interval '1 day')::date then raise exception 'Competência ou data de referência inválida'; end if;
 if p_modelos is null or jsonb_typeof(p_modelos)<>'array' or jsonb_array_length(p_modelos) not between 1 and 200
  or p_vinculos is null or jsonb_typeof(p_vinculos)<>'array' or jsonb_array_length(p_vinculos) not between 2 and 200
  or itens is null or jsonb_typeof(itens)<>'array' or jsonb_array_length(itens)<>jsonb_array_length(p_vinculos)
  then raise exception 'Lote de revezamento inválido'; end if;
 if (select count(distinct value->>'funcionario_id') from jsonb_array_elements(p_vinculos))<>jsonb_array_length(p_vinculos)
  or (select count(distinct value->>'funcionario_id') from jsonb_array_elements(itens))<>jsonb_array_length(itens)
  or (select count(distinct value->'destino'->>'id') from jsonb_array_elements(p_modelos))<>jsonb_array_length(p_modelos)
  or (select count(distinct value->>'grupo') from jsonb_array_elements(p_vinculos))<>2
  then raise exception 'Distribua pessoas diferentes entre os grupos A e B'; end if;

 for entrada in select value from jsonb_array_elements(p_modelos) loop
  origem:=entrada->'origem'; destino:=entrada->'destino'; grupo:=entrada->>'grupo';
  if jsonb_typeof(entrada)<>'object' or jsonb_typeof(origem) is distinct from 'object' or jsonb_typeof(destino) is distinct from 'object'
   or grupo is null or grupo not in ('A','B') then raise exception 'Modelo de revezamento inválido'; end if;
  perform 1 from public.modelos_jornada where id=(origem->>'id')::uuid and user_id=auth.uid() and (empresa_id=p_empresa or empresa_id is null) for share;
  if not found then raise exception 'Modelo de origem indisponível para esta empresa'; end if;
  select jsonb_build_object('id',m.id,'empresa_id',m.empresa_id,'nome',m.nome,'tipo',m.tipo,'padrao',m.padrao,'ciclo_inicio',m.ciclo_inicio,'turno',m.turno)
   into esperado from public.modelos_jornada m where id=(origem->>'id')::uuid and user_id=auth.uid();
  if origem is distinct from esperado or origem->>'tipo'<>'12x36' then raise exception 'O modelo de origem foi alterado. Atualize antes de revezar'; end if;
  ancora:=p_referencia+case when grupo='B' then 1 else 0 end;
  mid:=(destino->>'id')::uuid;
  if mid is null or nullif(btrim(destino->>'nome'),'') is null or destino->>'tipo' is distinct from '12x36'
   or (destino->>'empresa_id')::uuid is distinct from p_empresa or (destino->>'ciclo_inicio')::date is distinct from ancora
   or destino->'padrao' is distinct from origem->'padrao' or destino->'turno' is distinct from origem->'turno'
   then raise exception 'O revezamento deve preservar os horários e usar âncoras consecutivas'; end if;
  for chave in select jsonb_object_keys(destino) loop
   if not chave=any(array['id','empresa_id','nome','tipo','padrao','ciclo_inicio','turno']) then raise exception 'Campo não permitido no modelo do grupo'; end if;
  end loop;
  if not exists(select 1 from jsonb_array_elements(p_vinculos) v where v->>'modelo_id'=mid::text and v->>'grupo'=grupo)
   then raise exception 'Modelo de grupo sem funcionário selecionado'; end if;
  select jsonb_build_object('id',m.id,'empresa_id',m.empresa_id,'nome',m.nome,'tipo',m.tipo,'padrao',m.padrao,'ciclo_inicio',m.ciclo_inicio,'turno',m.turno)
   into existente from public.modelos_jornada m where id=mid and user_id=auth.uid() for share;
  if existente is not null then
   if existente is distinct from destino then raise exception 'O modelo do grupo foi alterado. Atualize os dados'; end if;
  else
   insert into public.modelos_jornada(id,empresa_id,nome,tipo,padrao,ciclo_inicio,turno)
   values(mid,p_empresa,destino->>'nome','12x36',origem->'padrao',ancora,origem->'turno');
  end if;
 end loop;

 -- Deterministic row order avoids overlapping batches locking employees in opposite order.
 for vinculo in select value from jsonb_array_elements(p_vinculos) order by value->>'funcionario_id' loop
  if jsonb_typeof(vinculo)<>'object' then raise exception 'Vínculo inválido'; end if;
  for chave in select jsonb_object_keys(vinculo) loop
   if not chave=any(array['funcionario_id','grupo','modelo_id','modelo_origem_id','modelo_padrao_esperado_id']) then raise exception 'Campo não permitido no vínculo'; end if;
  end loop;
  eid:=(vinculo->>'funcionario_id')::uuid; mid:=(vinculo->>'modelo_id')::uuid; grupo:=vinculo->>'grupo';
  if eid is null or mid is null or grupo is null or grupo not in ('A','B') or not(vinculo ? 'modelo_padrao_esperado_id')
   then raise exception 'Distribuição de grupo inválida'; end if;
  select * into f from public.funcionarios where id=eid and empresa_id=p_empresa and user_id=auth.uid() for update;
  if not found or f.situacao='inativo' then raise exception 'Funcionário indisponível ou inativo nesta empresa'; end if;
  if f.modelo_padrao_id is distinct from (vinculo->>'modelo_padrao_esperado_id')::uuid
   then raise exception 'O modelo individual foi alterado. Atualize antes de salvar'; end if;
  if not exists(select 1 from public.modelos_jornada m where m.id=(vinculo->>'modelo_origem_id')::uuid and m.user_id=auth.uid() and m.tipo='12x36' and (m.empresa_id=p_empresa or m.empresa_id is null))
   or (coalesce(f.modelo_padrao_id,c.modelo_padrao_id) is not null and coalesce(f.modelo_padrao_id,c.modelo_padrao_id)<>(vinculo->>'modelo_origem_id')::uuid)
   then raise exception 'Modelo de origem incompatível com o vínculo atual'; end if;
  if not exists(select 1 from jsonb_array_elements(p_modelos) m where m->'destino'->>'id'=mid::text and m->>'grupo'=grupo
    and m->'destino'->'turno'=(select turno from public.modelos_jornada where id=(vinculo->>'modelo_origem_id')::uuid)
    and m->'destino'->'padrao'=(select padrao from public.modelos_jornada where id=(vinculo->>'modelo_origem_id')::uuid))
   then raise exception 'O grupo não corresponde ao modelo selecionado'; end if;
  select value into escala from jsonb_array_elements(itens) where value->>'funcionario_id'=eid::text;
  if escala is null or (escala->>'empresa_id')::uuid is distinct from p_empresa or (escala->>'modelo_id')::uuid is distinct from mid
   or (escala->>'mes')::date is distinct from p_mes or escala->>'modelo_tipo' is distinct from '12x36'
   or escala->>'modelo_nome' is distinct from (select nome from public.modelos_jornada where id=mid)
   or escala->>'nome_funcionario' is distinct from f.nome
   or not(escala ? 'revisao_esperada') then raise exception 'Escala incompatível com o revezamento'; end if;
  update public.funcionarios set modelo_padrao_id=mid where id=eid and empresa_id=p_empresa and user_id=auth.uid();
 end loop;
 perform public.salvar_escalas_empresa(p_empresa,itens);
end $$;
revoke all on function public.salvar_revezamento_12x36(uuid,date,date,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.salvar_revezamento_12x36(uuid,date,date,jsonb,jsonb,jsonb) to authenticated;



-- Migration: 202611180002_company_business_hours.sql

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




-- Migration: 202611180003_team_planning.sql

-- Uma operação para a equipe inteira, com ou sem revezamento 12x36.
-- Reutiliza RLS, auditoria, bloqueios e revisões dos RPCs existentes.
create or replace function public.salvar_planejamento_equipe(p_empresa uuid,itens jsonb,p_revezamento jsonb default null)
returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb; chave text; competencia date; ids uuid[]; grupo jsonb; demais jsonb;
begin
 perform public.verificar_empresa_operavel(p_empresa,auth.uid());
 perform 1 from public.empresas where id=p_empresa and user_id=auth.uid() for update;
 if not found then raise exception 'Empresa indisponível ou sem permissão'; end if;
 if itens is null or jsonb_typeof(itens)<>'array' or jsonb_array_length(itens) not between 1 and 200 then raise exception 'Selecione entre 1 e 200 escalas por planejamento'; end if;
 competencia:=(itens->0->>'mes')::date;
 if competencia is null or extract(day from competencia)<>1 then raise exception 'Competência inválida'; end if;
 if (select count(distinct value->>'funcionario_id') from jsonb_array_elements(itens))<>jsonb_array_length(itens) then raise exception 'O planejamento contém funcionários repetidos'; end if;
 for item in select value from jsonb_array_elements(itens) loop
  if jsonb_typeof(item)<>'object' or (item->>'empresa_id')::uuid is distinct from p_empresa or (item->>'mes')::date is distinct from competencia
   or not(item ? 'revisao_esperada') then raise exception 'Todas as escalas devem corresponder à empresa, competência e revisão da prévia'; end if;
  perform 1 from public.funcionarios where id=(item->>'funcionario_id')::uuid and empresa_id=p_empresa and user_id=auth.uid() and situacao='ativo' for share;
  if not found then raise exception 'Funcionário indisponível ou inativo nesta empresa'; end if;
 end loop;
 if p_revezamento is null or p_revezamento='null'::jsonb then
  perform public.salvar_escalas_empresa(p_empresa,itens);
  return;
 end if;
 if jsonb_typeof(p_revezamento)<>'object' then raise exception 'Configuração de revezamento inválida'; end if;
 for chave in select jsonb_object_keys(p_revezamento) loop
  if not chave=any(array['mes','referencia','modelos','vinculos']) then raise exception 'Campo desconhecido na configuração de revezamento'; end if;
 end loop;
 if (p_revezamento->>'mes')::date is distinct from competencia or jsonb_typeof(p_revezamento->'vinculos') is distinct from 'array'
  or jsonb_typeof(p_revezamento->'modelos') is distinct from 'array' then raise exception 'O revezamento deve pertencer à competência e aos funcionários selecionados'; end if;
 select array_agg((value->>'funcionario_id')::uuid) into ids from jsonb_array_elements(p_revezamento->'vinculos');
 if coalesce(array_length(ids,1),0)<2 then raise exception 'Selecione pelo menos dois funcionários para revezar'; end if;
 select coalesce(jsonb_agg(value),'[]'::jsonb) into grupo from jsonb_array_elements(itens) where (value->>'funcionario_id')::uuid=any(ids);
 select coalesce(jsonb_agg(value),'[]'::jsonb) into demais from jsonb_array_elements(itens) where not((value->>'funcionario_id')::uuid=any(ids));
 if jsonb_array_length(grupo)<>array_length(ids,1) then raise exception 'O revezamento contém funcionário fora do planejamento'; end if;
 if to_regprocedure('public.salvar_revezamento_12x36(uuid,date,date,jsonb,jsonb,jsonb)') is null then raise exception 'Ative o revezamento no banco executando 202611180001_rest_rotation.sql'; end if;
 perform public.salvar_revezamento_12x36(p_empresa,competencia,(p_revezamento->>'referencia')::date,p_revezamento->'modelos',p_revezamento->'vinculos',grupo);
 if jsonb_array_length(demais)>0 then perform public.salvar_escalas_empresa(p_empresa,demais); end if;
end $$;
revoke all on function public.salvar_planejamento_equipe(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.salvar_planejamento_equipe(uuid,jsonb,jsonb) to authenticated;

commit;
