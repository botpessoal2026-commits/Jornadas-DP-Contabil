begin;
-- Evolução aditiva: cadastros e vínculos existentes são preservados.
alter table public.empresas
 add column nome_fantasia text not null default '',
 add column codigo_interno text not null default '',
 add column situacao text not null default 'ativa' check (situacao in ('ativa','inativa','arquivada')),
 add column endereco text not null default '',
 add column cep text not null default '' check (cep='' or cep ~ '^\d{8}$'),
 add column responsavel text not null default '',
 add column contato text not null default '',
 add column observacoes text not null default '',
 add column politica_domingo_feriado text not null default '',
 add column modelo_padrao_id uuid,
 add column carga_semanal_padrao_minutos integer check (carga_semanal_padrao_minutos between 1 and 10080),
 add column updated_at timestamptz,
 add constraint empresas_modelo_padrao_fk foreign key (modelo_padrao_id,user_id) references public.modelos_jornada(id,user_id);
-- Identificação mínima: razão social obrigatória; CNPJ e localização podem ser completados depois.
-- A unicidade continua obrigatória para CNPJs informados, sem colidir registros sem CNPJ.
alter table public.empresas drop constraint empresas_cnpj_check;
alter table public.empresas add constraint empresas_cnpj_check check (cnpj='' or cnpj ~ '^\d{14}$');
alter table public.empresas alter column cnpj set default '';
alter table public.empresas drop constraint empresas_user_id_cnpj_key;
create unique index empresas_cnpj_preenchido on public.empresas(user_id,cnpj) where cnpj<>'';
alter table public.empresas drop constraint empresas_uf_check;
alter table public.empresas add constraint empresas_uf_check check (uf='' or uf ~ '^[A-Z]{2}$');
alter table public.empresas alter column uf set default '';
alter table public.empresas alter column cidade set default '';

alter table public.funcionarios
 add column matricula text not null default '',
 add column setor text not null default '',
 add column admissao date,
 add column situacao text not null default 'ativo' check (situacao in ('ativo','inativo')),
 add column modelo_padrao_id uuid,
 add column carga_diaria_minutos integer check (carga_diaria_minutos between 1 and 1440),
 add column regras_especiais text not null default '',
 add column created_at timestamptz,
 add column updated_at timestamptz,
 add constraint funcionarios_modelo_padrao_fk foreign key (modelo_padrao_id,user_id) references public.modelos_jornada(id,user_id);
-- Datas de inclusão/última alteração de registros legados desconhecidas permanecem NULL.
-- Somente novos registros recebem os defaults; updates são carimbados pelo trigger.
alter table public.empresas alter column updated_at set default now();
alter table public.funcionarios alter column created_at set default now();
alter table public.funcionarios alter column updated_at set default now();
create index funcionarios_empresa_situacao on public.funcionarios(user_id,empresa_id,situacao);
create index escalas_empresa_competencia on public.escalas(user_id,empresa_id,mes);

-- As FKs por usuário já existentes continuam sendo a fronteira do escritório.
-- Estes validadores invoker também rejeitam modelos de OUTRA empresa do MESMO usuário.
create function public.verificar_empresa_operavel(empresa uuid, dono uuid) returns void
 language plpgsql security invoker set search_path='' as $$
declare estado text;
begin
 if auth.uid() is null or dono is distinct from auth.uid() then
  raise exception 'Empresa indisponível ou sem permissão';
 end if;
 select e.situacao into estado from public.empresas e where e.id=empresa and e.user_id=dono for share;
 if not found then raise exception 'Empresa indisponível ou sem permissão'; end if;
 if estado<>'ativa' then raise exception 'Empresa inativa ou arquivada: reative antes de novas operações'; end if;
end $$;
revoke all on function public.verificar_empresa_operavel(uuid,uuid) from public;
grant execute on function public.verificar_empresa_operavel(uuid,uuid) to authenticated;

create function public.verificar_modelo_empresa(modelo uuid, empresa uuid, dono uuid) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 if modelo is null then return; end if;
 if auth.uid() is null or dono is distinct from auth.uid() then
  raise exception 'Modelo indisponível para esta empresa';
 end if;
 perform 1 from public.modelos_jornada m where m.id=modelo and m.user_id=dono
  and (m.empresa_id is null or m.empresa_id=empresa) for share;
 if not found then raise exception 'Modelo indisponível para esta empresa'; end if;
end $$;
revoke all on function public.verificar_modelo_empresa(uuid,uuid,uuid) from public;
grant execute on function public.verificar_modelo_empresa(uuid,uuid,uuid) to authenticated;

create function public.validar_contexto_empresarial() returns trigger
 language plpgsql security invoker set search_path='' as $$
declare linha jsonb; empresa uuid; dono uuid; escala uuid; pessoa uuid; estado text;
begin
 -- Papel administrativo/bypass já é privilegiado no PostgreSQL. Preserva manutenção de conta pelo servidor.
 -- Aplicações autenticadas permanecem sujeitas a RLS, FKs e validação, inclusive em chamadas diretas.
 if exists (select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
  if TG_OP='DELETE' then return OLD; end if; return NEW;
 end if;
 linha:=case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
 dono:=(linha->>'user_id')::uuid;
 if auth.uid() is null or dono is distinct from auth.uid() then raise exception 'Operação sem permissão'; end if;
 if TG_TABLE_NAME='empresas' then
  perform public.verificar_modelo_empresa(NEW.modelo_padrao_id,NEW.id,NEW.user_id);
  -- Configurar o padrão não reescreve nenhum funcionário nem escala.
  return NEW;
 end if;
 empresa:=(linha->>'empresa_id')::uuid;
 if TG_TABLE_NAME='escala_dias' then
  escala:=(linha->>'escala_id')::uuid;
  select s.empresa_id,s.funcionario_id into empresa,pessoa from public.escalas s
   where s.id=escala and s.user_id=dono for share;
  if not found then raise exception 'Escala indisponível para esta empresa'; end if;
 end if;
 if empresa is not null then perform public.verificar_empresa_operavel(empresa,dono); end if;
 if TG_OP='UPDATE' and TG_TABLE_NAME='funcionarios' and linha->>'empresa_id' is distinct from to_jsonb(OLD)->>'empresa_id' then
  raise exception 'Transferência exige fluxo próprio com preservação do vínculo anterior';
 end if;
 if TG_OP='UPDATE' and TG_TABLE_NAME='modelos_jornada' and linha->>'empresa_id' is distinct from to_jsonb(OLD)->>'empresa_id' then
  raise exception 'O escopo do modelo é imutável; crie uma cópia na empresa de destino';
 end if;
 if TG_OP='UPDATE' and TG_TABLE_NAME='escalas' and
  (linha->>'empresa_id' is distinct from to_jsonb(OLD)->>'empresa_id' or linha->>'funcionario_id' is distinct from to_jsonb(OLD)->>'funcionario_id') then
  raise exception 'Empresa e funcionário da escala não podem ser reatribuídos';
 end if;
 if TG_OP='UPDATE' and TG_TABLE_NAME='escala_dias' and
  linha->>'escala_id' is distinct from to_jsonb(OLD)->>'escala_id' then
  raise exception 'A escala do dia não pode ser reatribuída';
 end if;
 if TG_OP<>'DELETE' and TG_TABLE_NAME='funcionarios' then
  perform public.verificar_modelo_empresa(NEW.modelo_padrao_id,NEW.empresa_id,NEW.user_id);
 end if;
 if TG_TABLE_NAME='escalas' then
  pessoa:=(linha->>'funcionario_id')::uuid;
  if TG_OP<>'DELETE' then perform public.verificar_modelo_empresa(NEW.modelo_id,NEW.empresa_id,NEW.user_id); end if;
 end if;
 if TG_TABLE_NAME in ('escalas','escala_dias') then
  select f.situacao into estado from public.funcionarios f where f.id=pessoa and f.empresa_id=empresa and f.user_id=dono for share;
  if not found or estado<>'ativo' then raise exception 'Funcionário indisponível ou com vínculo inativo'; end if;
 end if;
 if TG_OP='DELETE' then return OLD; end if; return NEW;
end $$;
revoke all on function public.validar_contexto_empresarial() from public;
create trigger validar_contexto before insert or update on public.empresas for each row execute function public.validar_contexto_empresarial();
create trigger validar_contexto before insert or update or delete on public.funcionarios for each row execute function public.validar_contexto_empresarial();
create trigger validar_contexto before insert or update or delete on public.modelos_jornada for each row execute function public.validar_contexto_empresarial();
create trigger validar_contexto before insert or update or delete on public.escalas for each row execute function public.validar_contexto_empresarial();
create trigger validar_contexto before insert or update or delete on public.escala_dias for each row execute function public.validar_contexto_empresarial();

create function public.registrar_atualizacao() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin NEW.updated_at:=now(); return NEW; end $$;
revoke all on function public.registrar_atualizacao() from public;
create trigger registrar_atualizacao before update on public.empresas for each row execute function public.registrar_atualizacao();
create trigger registrar_atualizacao before update on public.funcionarios for each row execute function public.registrar_atualizacao();
-- Sem exclusão em cascata pelo cliente: desativar/arquivar mantém os vínculos e documentos.
revoke delete on public.empresas,public.funcionarios,public.escalas from authenticated;

-- Histórico preserva linhas antigas e passa a registrar contexto, autor e antes/depois.
-- Não há endpoint de escrita de auditoria para clientes; RLS de leitura por proprietário permanece.
alter table public.log_alteracoes
 add column empresa_id uuid,
 add column ator_id uuid,
 add column antes jsonb,
 add column depois jsonb;
create index log_alteracoes_empresa_data on public.log_alteracoes(user_id,empresa_id,alterado_em desc);
create or replace function public.auditar_alteracao() returns trigger language plpgsql security definer set search_path='' as $$
declare linha jsonb; anterior jsonb; seguinte jsonb; empresa uuid; campos_alterados text[];
begin
 linha:=case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
 if not exists(select 1 from auth.users where id=(linha->>'user_id')::uuid) then
  if TG_OP='DELETE' then return OLD; end if; return NEW;
 end if;
 anterior:=case when TG_OP='INSERT' then null else to_jsonb(OLD) end;
 seguinte:=case when TG_OP='DELETE' then null else to_jsonb(NEW) end;
 if TG_TABLE_NAME='empresas' then empresa:=(linha->>'id')::uuid;
 elsif TG_TABLE_NAME='escala_dias' then
  select s.empresa_id into empresa from public.escalas s where s.id=(linha->>'escala_id')::uuid and s.user_id=(linha->>'user_id')::uuid;
 else empresa:=(linha->>'empresa_id')::uuid; end if;
 campos_alterados:=array(select chave from jsonb_object_keys(linha) as chave where TG_OP<>'UPDATE' or anterior->chave is distinct from seguinte->chave);
 insert into public.log_alteracoes(user_id,tabela,registro_id,acao,campos,empresa_id,ator_id,antes,depois)
 values((linha->>'user_id')::uuid,TG_TABLE_NAME,(linha->>'id')::uuid,TG_OP,campos_alterados,empresa,auth.uid(),anterior,seguinte);
 if TG_OP='DELETE' then return OLD; end if; return NEW;
end $$;
revoke all on function public.auditar_alteracao() from public;
commit;
