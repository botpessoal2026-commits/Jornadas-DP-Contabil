begin;

-- A preferência anterior do gerador era folgar; preserva esse padrão no legado
-- e permite configurar cada empresa sem transportar a seleção entre ambientes.
alter table public.empresas add column folgar_feriados boolean not null default true;

-- Legado e referências gerais permanecem no escopo NULL. Nenhuma regra,
-- jornada, configuração ou escala é copiada ou alterada automaticamente.
alter table public.feriados
 add column empresa_id uuid,
 add constraint feriados_empresa_fk foreign key (empresa_id,user_id) references public.empresas(id,user_id);
alter table public.parametros_legais
 add column empresa_id uuid,
 add constraint parametros_legais_empresa_fk foreign key (empresa_id,user_id) references public.empresas(id,user_id);

alter table public.feriados drop constraint feriados_user_id_nome_data_abrangencia_key;
create unique index feriados_gerais_unicos on public.feriados(user_id,nome,data,abrangencia) where empresa_id is null;
create unique index feriados_empresa_unicos on public.feriados(user_id,empresa_id,nome,data,abrangencia) where empresa_id is not null;
create index feriados_empresa_data on public.feriados(user_id,empresa_id,data);

alter table public.parametros_legais drop constraint parametros_legais_user_id_chave_inicio_vigencia_key;
create unique index parametros_gerais_unicos on public.parametros_legais(user_id,chave,inicio_vigencia) where empresa_id is null;
create unique index parametros_empresa_unicos on public.parametros_legais(user_id,empresa_id,chave,inicio_vigencia) where empresa_id is not null;

-- O mesmo validador cobre chamadas REST diretas e os RPCs contextuais.
create function public.validar_recurso_empresa() returns trigger
 language plpgsql security invoker set search_path='' as $$
declare linha jsonb; empresa uuid; dono uuid;
begin
 if exists (select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
  if TG_OP='DELETE' then return OLD; end if; return NEW;
 end if;
 linha:=case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
 dono:=(linha->>'user_id')::uuid;
 empresa:=(linha->>'empresa_id')::uuid;
 if auth.uid() is null or dono is distinct from auth.uid() then raise exception 'Operação sem permissão'; end if;
 if TG_OP='UPDATE' and linha->>'empresa_id' is distinct from to_jsonb(OLD)->>'empresa_id' then
  raise exception 'O escopo do cadastro é imutável; crie uma cópia na empresa de destino';
 end if;
 if empresa is not null then perform public.verificar_empresa_operavel(empresa,dono); end if;
 if TG_OP='DELETE' then return OLD; end if; return NEW;
end $$;
revoke all on function public.validar_recurso_empresa() from public,anon,authenticated;
create trigger validar_contexto before insert or update or delete on public.feriados for each row execute function public.validar_recurso_empresa();
create trigger validar_contexto before insert or update or delete on public.parametros_legais for each row execute function public.validar_recurso_empresa();

-- Vínculos antigos com a biblioteca continuam válidos, mas estáveis. Novos
-- vínculos exigem um modelo próprio e não passam a acompanhar uma base ao vivo.
create function public.validar_vinculo_modelo_proprio() returns trigger
 language plpgsql security invoker set search_path='' as $$
declare linha jsonb; anterior jsonb; campo text; modelo uuid; escopo uuid;
begin
 if exists (select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then return NEW; end if;
 linha:=to_jsonb(NEW);
 campo:=case when TG_TABLE_NAME='escalas' then 'modelo_id' else 'modelo_padrao_id' end;
 modelo:=(linha->>campo)::uuid;
 if modelo is null then return NEW; end if;
 if TG_OP='UPDATE' then
  anterior:=to_jsonb(OLD);
  if linha->>campo is not distinct from anterior->>campo then return NEW; end if;
 end if;
 select m.empresa_id into escopo from public.modelos_jornada m
  where m.id=modelo and m.user_id=auth.uid() for share;
 if not found then raise exception 'Modelo indisponível para esta empresa'; end if;
 -- salvar_escalas usa INSERT ... ON CONFLICT: o BEFORE INSERT também roda
 -- na regravação. Somente o mesmo vínculo legado já existente é preservado.
 if escopo is null and TG_TABLE_NAME='escalas' and TG_OP='INSERT' then
  perform 1 from public.escalas s where s.user_id=auth.uid()
   and s.empresa_id=(linha->>'empresa_id')::uuid
   and s.funcionario_id=(linha->>'funcionario_id')::uuid
   and s.mes=(linha->>'mes')::date and s.modelo_id=modelo for share;
  if found then return NEW; end if;
 end if;
 if escopo is null then raise exception 'Copie o modelo da biblioteca para a empresa antes de vinculá-lo'; end if;
 return NEW;
end $$;
revoke all on function public.validar_vinculo_modelo_proprio() from public,anon,authenticated;
create trigger validar_vinculo_proprio before insert or update on public.empresas for each row execute function public.validar_vinculo_modelo_proprio();
create trigger validar_vinculo_proprio before insert or update on public.funcionarios for each row execute function public.validar_vinculo_modelo_proprio();
create trigger validar_vinculo_proprio before insert or update on public.escalas for each row execute function public.validar_vinculo_modelo_proprio();

create index empresas_modelo_referenciado on public.empresas(user_id,modelo_padrao_id) where modelo_padrao_id is not null;
create index funcionarios_modelo_referenciado on public.funcionarios(user_id,modelo_padrao_id) where modelo_padrao_id is not null;
create index escalas_modelo_referenciado on public.escalas(user_id,modelo_id) where modelo_id is not null;

create function public.proteger_modelo_base_vinculado() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if exists (select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
  if TG_OP='DELETE' then return OLD; end if; return NEW;
 end if;
 if OLD.empresa_id is null and (TG_OP='DELETE' or to_jsonb(NEW) is distinct from to_jsonb(OLD)) and (
  exists(select 1 from public.empresas e where e.user_id=OLD.user_id and e.modelo_padrao_id=OLD.id)
  or exists(select 1 from public.funcionarios f where f.user_id=OLD.user_id and f.modelo_padrao_id=OLD.id)
  or exists(select 1 from public.escalas s where s.user_id=OLD.user_id and s.modelo_id=OLD.id)
 ) then
  raise exception 'Modelo da biblioteca vinculado: crie uma cópia; a base usada por empresas permanece preservada';
 end if;
 if TG_OP='DELETE' then return OLD; end if; return NEW;
end $$;
revoke all on function public.proteger_modelo_base_vinculado() from public,anon,authenticated;
create trigger proteger_base before update or delete on public.modelos_jornada for each row execute function public.proteger_modelo_base_vinculado();

-- Escrita com contexto explícito, sem SECURITY DEFINER. RLS, FKs, defaults e
-- triggers continuam ativos. Identificadores e colunas nunca vêm livres do JSON.
create function public.salvar_registro_empresa(p_empresa uuid,p_tabela text,p_valores jsonb,p_id uuid default null)
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
  when 'empresas' then permitidos:=array['nome','cnpj','cidade','uf','cct','permite_6x1','limite_diario_minutos','usa_banco_horas','folgar_feriados','nome_fantasia','codigo_interno','situacao','endereco','cep','responsavel','contato','observacoes','politica_domingo_feriado','modelo_padrao_id','carga_semanal_padrao_minutos'];
  when 'funcionarios' then permitidos:=array['empresa_id','nome','cpf','cargo','horario_contratual','carga_semanal_minutos','dias_descanso','matricula','setor','admissao','situacao','modelo_padrao_id','carga_diaria_minutos','regras_especiais'];
  when 'modelos_jornada' then permitidos:=array['empresa_id','nome','tipo','padrao','ciclo_inicio','turno'];
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

create function public.excluir_modelo_empresa(p_empresa uuid,p_modelo uuid)
 returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.verificar_empresa_operavel(p_empresa,auth.uid());
 perform 1 from public.modelos_jornada m where m.id=p_modelo and m.empresa_id=p_empresa and m.user_id=auth.uid() for update;
 if not found then raise exception 'Modelo próprio indisponível para esta empresa'; end if;
 delete from public.modelos_jornada where id=p_modelo and empresa_id=p_empresa and user_id=auth.uid();
exception when foreign_key_violation then
 raise exception 'Modelo vinculado a empresa, funcionário ou escala; preserve os vínculos antes de excluir' using errcode='23503';
end $$;
revoke all on function public.excluir_modelo_empresa(uuid,uuid) from public,anon,authenticated;
grant execute on function public.excluir_modelo_empresa(uuid,uuid) to authenticated;

-- O contexto também acompanha lotes de escalas. Primeiro valida o lote inteiro;
-- a função existente continua responsável pela gravação atômica e pelos dias.
create function public.salvar_escalas_empresa(p_empresa uuid,itens jsonb)
 returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb; chave text; escala uuid;
begin
 perform public.verificar_empresa_operavel(p_empresa,auth.uid());
 if itens is null or jsonb_typeof(itens)<>'array' then raise exception 'Escalas inválidas para esta empresa'; end if;
 for item in select value from jsonb_array_elements(itens) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Escala inválida para esta empresa'; end if;
  for chave in select jsonb_object_keys(item) loop
   if not (chave=any(array['id','empresa_id','funcionario_id','modelo_id','mes','nome_funcionario','modelo_nome','modelo_tipo','dias'])) then
    raise exception 'Campo não permitido na escala: %',chave;
   end if;
  end loop;
  if (item->>'empresa_id')::uuid is distinct from p_empresa then raise exception 'A empresa da escala deve corresponder ao contexto'; end if;
  escala:=nullif(item->>'id','')::uuid;
  if escala is not null then
   perform 1 from public.escalas s where s.id=escala and s.empresa_id=p_empresa and s.user_id=auth.uid()
    and s.funcionario_id=(item->>'funcionario_id')::uuid and s.mes=(item->>'mes')::date for share;
   if not found then raise exception 'Escala indisponível para esta empresa'; end if;
  end if;
 end loop;
 perform public.salvar_escalas(itens);
end $$;
revoke all on function public.salvar_escalas_empresa(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.salvar_escalas_empresa(uuid,jsonb) to authenticated;

commit;
