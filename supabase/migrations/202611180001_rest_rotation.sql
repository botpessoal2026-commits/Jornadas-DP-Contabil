begin;

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

commit;
