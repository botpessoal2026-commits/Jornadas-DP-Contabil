begin;
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
