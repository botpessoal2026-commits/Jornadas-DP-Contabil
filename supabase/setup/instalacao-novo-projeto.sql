-- Gerado de migrations versionadas. SOMENTE PARA PROJETO NOVO.
-- Não apaga dados. Recusa banco com tabelas existentes do aplicativo.
-- Projeto existente: execute verificar-banco-existente.sql e não este arquivo.
-- Senhas e e-mails ficam exclusivamente em Supabase Auth; nome em user_metadata.
begin;
select pg_advisory_xact_lock(hashtext('cont_contabil_instalacao_inicial'));
do $instalacao_segura$
declare existentes text;
begin
 select string_agg(nome, ', ') into existentes from unnest(array['empresas', 'funcionarios', 'modelos_jornada', 'escalas', 'escala_dias', 'feriados', 'parametros_legais', 'log_alteracoes', 'estabelecimentos', 'datas_especiais', 'escala_versoes', 'registros_operacionais', 'nomes_login', 'login_tentativas']) nome where to_regclass('public.'||nome) is not null;
 if existentes is not null then
  raise exception 'Banco já contém tabelas do Gerador de Jornadas (%). Instalação interrompida sem alterar dados. Use verificar-banco-existente.sql e migrações incrementais.', existentes;
 end if;
end $instalacao_segura$;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);

-- Migration: 202610220001_schema.sql

create table public.empresas (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 nome text not null check (length(trim(nome))>0), cnpj text not null check (cnpj ~ '^\d{14}$'), cidade text not null, uf text not null check(uf ~ '^[A-Z]{2}$'), cct text not null default '',
 permite_6x1 boolean not null default false, limite_diario_minutos integer check(limite_diario_minutos between 1 and 1440), usa_banco_horas boolean not null default false,
 created_at timestamptz not null default now(), unique(id,user_id), unique(user_id,cnpj)
);
create table public.funcionarios (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 empresa_id uuid not null, nome text not null check(length(trim(nome))>0), cargo text not null default '', horario_contratual text not null default '', dias_descanso integer[] not null default '{0,6}' check(dias_descanso <@ array[0,1,2,3,4,5,6]),
 unique(id,user_id), unique(id,empresa_id,user_id), foreign key(empresa_id,user_id) references public.empresas(id,user_id) on delete cascade
);
create table public.modelos_jornada (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 empresa_id uuid, nome text not null check(length(trim(nome))>0), tipo text not null check(tipo in ('5x2','6x1','12x36','turnos','personalizado')),
 padrao jsonb not null default '{}', ciclo_inicio date, turno jsonb,
 unique(id,user_id), foreign key(empresa_id,user_id) references public.empresas(id,user_id) on delete cascade,
 check(jsonb_typeof(padrao)='object'), check(tipo <> '12x36' or (ciclo_inicio is not null and jsonb_typeof(turno)='array'))
);
create table public.escalas (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 empresa_id uuid not null, funcionario_id uuid not null, modelo_id uuid, mes date not null check(extract(day from mes)=1),
 nome_funcionario text not null, modelo_nome text not null default '', modelo_tipo text not null default 'personalizado',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,user_id), unique(funcionario_id,mes), foreign key(empresa_id,user_id) references public.empresas(id,user_id) on delete cascade,
 foreign key(funcionario_id,empresa_id,user_id) references public.funcionarios(id,empresa_id,user_id) on delete cascade,
 foreign key(modelo_id,user_id) references public.modelos_jornada(id,user_id)
);
create table public.escala_dias (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 escala_id uuid not null, data date not null, intervalos jsonb not null default '[]' check(jsonb_typeof(intervalos)='array'), folga boolean not null default false,
 feriado text, observacao text not null default '', unique(escala_id,data), foreign key(escala_id,user_id) references public.escalas(id,user_id) on delete cascade
);
create table public.feriados (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 nome text not null, data date not null, abrangencia text not null check(abrangencia in ('nacional','estadual','municipal')), uf text, cidade text,
 check(abrangencia='nacional' or uf is not null), check(abrangencia<>'municipal' or cidade is not null), unique(user_id,nome,data,abrangencia)
);
create table public.parametros_legais (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 nome text not null, chave text not null check(chave in ('regime','intervalo','interjornada','noturno','divisor')), valor jsonb not null check(jsonb_typeof(valor)='object'),
 inicio_vigencia date not null, fonte text not null check(length(trim(fonte))>0), observacao text not null default '', confirmado boolean not null default false,
 unique(user_id,chave,inicio_vigencia)
);
create table public.log_alteracoes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 tabela text not null, registro_id uuid not null, acao text not null, alterado_em timestamptz not null default now(), campos text[] not null default '{}'
);
-- Usuários só leem/escrevem suas próprias linhas; FKs compostas bloqueiam referências entre contas.
do $$ declare t text; begin
 foreach t in array array['empresas','funcionarios','modelos_jornada','escalas','escala_dias','feriados','parametros_legais'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy dono on public.%I for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
  execute format('create index on public.%I(user_id)',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
 end loop;
end $$;
alter table public.log_alteracoes enable row level security;
create policy leitura_dono on public.log_alteracoes for select to authenticated using((select auth.uid())=user_id);
revoke all on public.log_alteracoes from anon,authenticated;
grant select on public.log_alteracoes to authenticated;
-- Registra nomes dos campos, sem duplicar dados pessoais no log.
create or replace function public.auditar_alteracao() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb; begin
 row_data:=case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
 -- Exclusão da conta remove dados e logs por cascata; não recriar logs órfãos.
 if not exists(select 1 from auth.users where id=(row_data->>'user_id')::uuid) then
  if TG_OP='DELETE' then return OLD; end if; return NEW;
 end if;
 insert into public.log_alteracoes(user_id,tabela,registro_id,acao,campos) values((row_data->>'user_id')::uuid,TG_TABLE_NAME,(row_data->>'id')::uuid,TG_OP,array(select jsonb_object_keys(row_data)));
 if TG_OP='DELETE' then return OLD; end if; return NEW;
end $$;
revoke all on function public.auditar_alteracao() from public;
do $$ declare t text; begin
 foreach t in array array['empresas','funcionarios','modelos_jornada','escalas','escala_dias','feriados','parametros_legais'] loop
 execute format('create trigger auditar after insert or update or delete on public.%I for each row execute function public.auditar_alteracao()',t);
 end loop;
end $$;
-- Gravação e duplicação em lote são atômicas. SECURITY INVOKER mantém RLS.
create function public.salvar_escalas(itens jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb; dia jsonb; sid uuid; begin
 if auth.uid() is null then raise exception 'Autenticação necessária'; end if;
 for item in select value from jsonb_array_elements(itens) loop
 sid:=coalesce(nullif(item->>'id','')::uuid,gen_random_uuid());
 insert into public.escalas(id,empresa_id,funcionario_id,modelo_id,mes,nome_funcionario,modelo_nome,modelo_tipo)
 values(sid,(item->>'empresa_id')::uuid,(item->>'funcionario_id')::uuid,nullif(item->>'modelo_id','')::uuid,(item->>'mes')::date,item->>'nome_funcionario',coalesce(item->>'modelo_nome',''),coalesce(item->>'modelo_tipo','personalizado'))
 on conflict(funcionario_id,mes) do update set modelo_id=excluded.modelo_id,modelo_nome=excluded.modelo_nome,modelo_tipo=excluded.modelo_tipo,nome_funcionario=excluded.nome_funcionario,updated_at=now()
 returning id into sid;
 delete from public.escala_dias where escala_id=sid;
 for dia in select value from jsonb_array_elements(item->'dias') loop
 insert into public.escala_dias(escala_id,data,intervalos,folga,feriado,observacao) values(sid,(dia->>'data')::date,dia->'intervalos',(dia->>'folga')::boolean,dia->>'feriado',coalesce(dia->>'observacao',''));
 end loop;
 end loop;
end $$;
revoke all on function public.salvar_escalas(jsonb) from public;
grant execute on function public.salvar_escalas(jsonb) to authenticated;

insert into supabase_migrations.schema_migrations(version,name) values('202610220001','schema') on conflict(version) do nothing;

-- Migration: 20261022172216_structured_contract.sql

-- Aditiva: preserva observações e exige revisão explícita dos cadastros antigos.
-- Nenhum backfill por regex: '30h + extras', turnos e CCT podem ser ambíguos.
alter table public.funcionarios
  add column carga_semanal_minutos integer
    check (carga_semanal_minutos between 1 and 10080);
comment on column public.funcionarios.carga_semanal_minutos is
  'Carga semanal do contrato em minutos. NULL exige revisão; não inferir do teto legal nem das observações. Não constitui aprovação jurídica.';
-- RLS e auditoria existentes também protegem a nova coluna.

insert into supabase_migrations.schema_migrations(version,name) values('20261022172216','structured_contract') on conflict(version) do nothing;

-- Migration: 20261022191148_company_administration.sql

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

insert into supabase_migrations.schema_migrations(version,name) values('20261022191148','company_administration') on conflict(version) do nothing;

-- Migration: 20261023175301_employee_cpf.sql

-- Campo opcional: o legado continua sem CPF, sem preencher ou alterar vínculos.
alter table public.funcionarios
 add column cpf text,
 add constraint funcionarios_cpf_formato check (cpf is null or cpf ~ '^[0-9]{11}$');

comment on column public.funcionarios.cpf is
 'CPF opcional do funcionário, armazenado com 11 dígitos; a máscara pertence à apresentação.';

insert into supabase_migrations.schema_migrations(version,name) values('20261023175301','employee_cpf') on conflict(version) do nothing;

-- Migration: 20261023184038_company_isolation.sql


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


insert into supabase_migrations.schema_migrations(version,name) values('20261023184038','company_isolation') on conflict(version) do nothing;

-- Migration: 20261026115657_regime_12x36_scope.sql


-- Mantém as regras comuns existentes e permite que o regime 12x36 tenha
-- parâmetros próprios na mesma data, sem duplicar o grupo no cadastro.
-- Apenas o tipo estruturado 12x36 abre outro escopo; valores ausentes,
-- "comum" ou desconhecidos continuam no escopo comum, como no motor.
drop index public.parametros_gerais_unicos;
drop index public.parametros_empresa_unicos;

create unique index parametros_gerais_unicos
 on public.parametros_legais (
  user_id,
  chave,
  (case when chave='regime' and valor->>'tipo_regime'='12x36'
    then '12x36' else 'comum' end),
  inicio_vigencia
 ) where empresa_id is null;

create unique index parametros_empresa_unicos
 on public.parametros_legais (
  user_id,
  empresa_id,
  chave,
  (case when chave='regime' and valor->>'tipo_regime'='12x36'
    then '12x36' else 'comum' end),
  inicio_vigencia
 ) where empresa_id is not null;

-- Não modifica valores, vínculos, políticas de acesso nem regras de cálculo.

insert into supabase_migrations.schema_migrations(version,name) values('20261026115657','regime_12x36_scope') on conflict(version) do nothing;

-- Migration: 20261026173250_special_dates_calendar.sql


-- Novos cadastros opcionais: nenhum vínculo ou dia legado é reescrito.
create table public.estabelecimentos (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 empresa_id uuid not null,
 nome text not null check(length(trim(nome))>0),
 cidade text not null check(length(trim(cidade))>0),
 uf text not null check(uf ~ '^[A-Z]{2}$'),
 ativo boolean not null default true,
 unique(id,empresa_id,user_id),
 foreign key(empresa_id,user_id) references public.empresas(id,user_id)
);
create unique index estabelecimentos_nome on public.estabelecimentos(user_id,empresa_id,lower(trim(nome)));

alter table public.funcionarios
 add column estabelecimento_id uuid,
 add constraint funcionarios_estabelecimento_fk foreign key(estabelecimento_id,empresa_id,user_id)
  references public.estabelecimentos(id,empresa_id,user_id);
create index funcionarios_estabelecimento on public.funcionarios(user_id,empresa_id,estabelecimento_id) where estabelecimento_id is not null;

create table public.datas_especiais (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 empresa_id uuid not null,
 estabelecimento_id uuid,
 nome text not null check(length(trim(nome))>0),
 data_inicio date not null,
 data_fim date,
 categoria text not null check(categoria in ('feriado_nacional','feriado_estadual','feriado_municipal','feriado_especifico','ponto_facultativo','recesso','sem_expediente')),
 alcance text not null default 'empresa' check(alcance in ('empresa','selecionados','funcionario')),
 funcionario_ids uuid[] not null default '{}',
 recorrencia text not null default 'unica' check(recorrencia in ('unica','anual','periodo')),
 expediente text not null default 'normal' check(expediente in ('sem_expediente','normal','reduzido','individual')),
 intervalos jsonb not null default '[]' check(jsonb_typeof(intervalos)='array'),
 observacoes text not null default '',
 ativo boolean not null default true,
 data_movel boolean not null default false,
 uf text check(uf is null or uf ~ '^[A-Z]{2}$'),
 cidade text,
 foreign key(empresa_id,user_id) references public.empresas(id,user_id),
 foreign key(estabelecimento_id,empresa_id,user_id) references public.estabelecimentos(id,empresa_id,user_id),
 check(data_fim is null or data_fim>=data_inicio),
 check(coalesce(data_fim,data_inicio)-data_inicio<=case when recorrencia='anual' then 366 else 3660 end),
 check(recorrencia<>'unica' or data_fim is null or data_fim=data_inicio),
 check(recorrencia<>'periodo' or data_fim is not null),
 check(recorrencia<>'anual' or not data_movel),
 check(categoria<>'sem_expediente' or expediente='sem_expediente'),
 check(categoria not in ('feriado_estadual','feriado_municipal') or uf is not null),
 check(categoria<>'feriado_municipal' or coalesce(length(trim(cidade)),0)>0),
 check((alcance='empresa' and cardinality(funcionario_ids)=0) or
       (alcance='funcionario' and cardinality(funcionario_ids)=1) or
       (alcance='selecionados' and cardinality(funcionario_ids)>0)),
 check((expediente='reduzido' and jsonb_array_length(intervalos)>0) or
       (expediente<>'reduzido' and jsonb_array_length(intervalos)=0))
);
create index datas_especiais_empresa_data on public.datas_especiais(user_id,empresa_id,data_inicio);
create index datas_especiais_estabelecimento on public.datas_especiais(user_id,empresa_id,estabelecimento_id) where estabelecimento_id is not null;
-- UUID[] tem representação determinística; a chave fixa evita o limite de
-- tamanho da entrada B-tree em grupos com centenas de funcionários.
create function public.chave_funcionarios_calendario(p_ids uuid[]) returns bytea
 language sql immutable strict parallel safe security invoker set search_path='' as $$
 select sha256(convert_to(p_ids::text,'UTF8'))
$$;
revoke all on function public.chave_funcionarios_calendario(uuid[]) from public,anon;
grant execute on function public.chave_funcionarios_calendario(uuid[]) to authenticated;
create unique index datas_especiais_sem_duplicidade on public.datas_especiais(
 user_id,empresa_id,coalesce(estabelecimento_id,'00000000-0000-0000-0000-000000000000'::uuid),
 lower(regexp_replace(trim(nome),'\s+',' ','g')),
 (case when recorrencia='anual' then make_date(2000,extract(month from data_inicio)::integer,extract(day from data_inicio)::integer) else data_inicio end),
 (case when recorrencia='anual' then make_date(2000,extract(month from coalesce(data_fim,data_inicio))::integer,extract(day from coalesce(data_fim,data_inicio))::integer) else coalesce(data_fim,data_inicio) end),
 (case when recorrencia='anual' then extract(year from coalesce(data_fim,data_inicio))::integer-extract(year from data_inicio)::integer else 0 end),
 (case when categoria in ('feriado_estadual','feriado_municipal') then coalesce(uf,'') else '' end),
 (case when categoria='feriado_municipal' then translate(lower(regexp_replace(trim(coalesce(cidade,'')),'\s+',' ','g')),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc') else '' end),
 categoria,alcance,public.chave_funcionarios_calendario(funcionario_ids),recorrencia
) where ativo;

do $$ declare tabela text; begin
 foreach tabela in array array['estabelecimentos','datas_especiais'] loop
  execute format('alter table public.%I enable row level security',tabela);
  execute format('create policy dono on public.%I for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',tabela);
  execute format('revoke all on public.%I from public,anon,authenticated',tabela);
  execute format('grant select,insert,update,delete on public.%I to authenticated',tabela);
  execute format('create trigger validar_contexto before insert or update or delete on public.%I for each row execute function public.validar_recurso_empresa()',tabela);
  execute format('create trigger auditar after insert or update or delete on public.%I for each row execute function public.auditar_alteracao()',tabela);
 end loop;
end $$;

-- Forma dos períodos, sem substituir o validador trabalhista de irregularidades.
create function public.validar_intervalos_calendario(periodos jsonb, conferir_sobreposicao boolean default false)
 returns void language plpgsql security invoker set search_path='' as $$
declare periodo jsonb; chave text; inicio integer; termino integer; dia_inicio integer; dia_fim integer; anterior integer:=-1;
begin
 if periodos is null or jsonb_typeof(periodos)<>'array' or jsonb_array_length(periodos)>100 then raise exception 'Intervalos de calendário inválidos'; end if;
 for periodo in select value from jsonb_array_elements(periodos) loop
  if jsonb_typeof(periodo)<>'object' then raise exception 'Período de calendário inválido'; end if;
  for chave in select jsonb_object_keys(periodo) loop
   if not chave=any(array['start','end','startDay','endDay']) then raise exception 'Campo inválido no período de calendário'; end if;
  end loop;
  if coalesce(periodo->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(periodo->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Horário de calendário inválido'; end if;
  foreach chave in array array['startDay','endDay'] loop
   if periodo ? chave then
    if jsonb_typeof(periodo->chave) is distinct from 'number' then raise exception 'Data do período inválida'; end if;
    if (periodo->>chave)::numeric not in (0,1) then raise exception 'Data do período inválida'; end if;
   end if;
  end loop;
  inicio:=split_part(periodo->>'start',':',1)::integer*60+split_part(periodo->>'start',':',2)::integer;
  termino:=split_part(periodo->>'end',':',1)::integer*60+split_part(periodo->>'end',':',2)::integer;
  dia_inicio:=coalesce((periodo->>'startDay')::numeric::integer,0);
  dia_fim:=coalesce((periodo->>'endDay')::numeric::integer,dia_inicio+case when termino<=inicio then 1 else 0 end);
  inicio:=inicio+dia_inicio*1440; termino:=termino+dia_fim*1440;
  if dia_fim<dia_inicio or dia_fim>1 or termino<=inicio or termino-inicio>1440 then raise exception 'Duração do período inválida'; end if;
  if conferir_sobreposicao and inicio<anterior then raise exception 'Períodos reduzidos sobrepostos ou fora de ordem'; end if;
  anterior:=termino;
 end loop;
end $$;
revoke all on function public.validar_intervalos_calendario(jsonb,boolean) from public,anon;
grant execute on function public.validar_intervalos_calendario(jsonb,boolean) to authenticated;

create function public.validar_dados_calendario_empresa() returns trigger
 language plpgsql security invoker set search_path='' as $$
declare unidade public.estabelecimentos; ids uuid[]; nome_normalizado text;
begin
 if TG_TABLE_NAME='funcionarios' then
  if NEW.estabelecimento_id is not null and (TG_OP='INSERT' or NEW.estabelecimento_id is distinct from OLD.estabelecimento_id) then
   select * into unidade from public.estabelecimentos e where e.id=NEW.estabelecimento_id and e.empresa_id=NEW.empresa_id and e.user_id=NEW.user_id for share;
   if not found or not unidade.ativo then raise exception 'Estabelecimento indisponível para este vínculo'; end if;
  end if;
  return NEW;
 end if;
 if NEW.estabelecimento_id is not null then
  select * into unidade from public.estabelecimentos e where e.id=NEW.estabelecimento_id and e.empresa_id=NEW.empresa_id and e.user_id=NEW.user_id for share;
  if not found or (NEW.ativo and not unidade.ativo) then raise exception 'Estabelecimento indisponível para esta data especial'; end if;
 end if;
 if NEW.funcionario_ids is null or array_position(NEW.funcionario_ids,null) is not null then raise exception 'Funcionário inválido no alcance da data especial'; end if;
 select coalesce(array_agg(distinct pessoa order by pessoa),'{}'::uuid[]) into ids from unnest(NEW.funcionario_ids) pessoa;
 if cardinality(ids)<>cardinality(NEW.funcionario_ids) then raise exception 'Funcionários duplicados no alcance da data especial'; end if;
 if exists(select 1 from unnest(ids) pessoa where not exists(
  select 1 from public.funcionarios f where f.id=pessoa and f.empresa_id=NEW.empresa_id and f.user_id=NEW.user_id
   and (NEW.estabelecimento_id is null or f.estabelecimento_id=NEW.estabelecimento_id)
 )) then raise exception 'Funcionários devem pertencer à empresa e ao estabelecimento da data especial'; end if;
 NEW.funcionario_ids:=ids;
 nome_normalizado:=translate(lower(NEW.nome),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc');
 if NEW.recorrencia='anual' and nome_normalizado ~ 'carnaval|sexta.*santa|paixao|corpus\s+christi|pascoa|quarta.*cinzas' then raise exception 'Data móvel não pode repetir anualmente em dia fixo'; end if;
 perform public.validar_intervalos_calendario(NEW.intervalos,true);
 return NEW;
end $$;
revoke all on function public.validar_dados_calendario_empresa() from public,anon,authenticated;
create trigger validar_dados before insert or update on public.datas_especiais for each row execute function public.validar_dados_calendario_empresa();
create trigger validar_estabelecimento before insert or update on public.funcionarios for each row execute function public.validar_dados_calendario_empresa();

-- A programação original e a exceção individual pertencem ao dia, não ao evento.
-- Excluir um evento não apaga essa informação nem altera dias/horários salvos.
alter table public.escala_dias add column calendario jsonb;
create function public.validar_calendario_dia() returns trigger
 language plpgsql security invoker set search_path='' as $$
declare valor jsonb; chave text; plano jsonb;
begin
 valor:=NEW.calendario;
 if valor is null or valor='null'::jsonb then NEW.calendario:=null; return NEW; end if;
 if jsonb_typeof(valor)<>'object' or not (valor ? 'base') then raise exception 'Metadados do dia inválidos'; end if;
 for chave in select jsonb_object_keys(valor) loop
  if not chave=any(array['base','excecao','folgar_feriado']) then raise exception 'Campo inválido nos metadados do dia'; end if;
 end loop;
 if valor ? 'folgar_feriado' and jsonb_typeof(valor->'folgar_feriado') is distinct from 'boolean' then
  raise exception 'A decisão de folga no feriado deve ser booleana';
 end if;
 plano:=valor->'base';
 if jsonb_typeof(plano)<>'object' or jsonb_typeof(plano->'folga') is distinct from 'boolean'
  or jsonb_typeof(plano->'observacao') is distinct from 'string'
  or not (plano ? 'feriado') or (plano->'feriado'<>'null'::jsonb and jsonb_typeof(plano->'feriado') is distinct from 'string') then raise exception 'Programação original do dia inválida'; end if;
 for chave in select jsonb_object_keys(plano) loop
  if not chave=any(array['intervalos','folga','feriado','observacao']) then raise exception 'Campo inválido na programação original'; end if;
 end loop;
 perform public.validar_intervalos_calendario(plano->'intervalos');
 plano:=valor->'excecao';
 if plano is not null and plano<>'null'::jsonb then
  if jsonb_typeof(plano)<>'object' or coalesce(plano->>'categoria','') not in ('trabalho','folga','feriado','ponto_facultativo','recesso','sem_expediente')
   or coalesce(plano->>'expediente','') not in ('normal','sem_expediente','reduzido')
   or jsonb_typeof(plano->'nome') is distinct from 'string' or jsonb_typeof(plano->'observacao') is distinct from 'string' then raise exception 'Exceção individual do dia inválida'; end if;
  for chave in select jsonb_object_keys(plano) loop
   if not chave=any(array['categoria','nome','expediente','intervalos','observacao']) then raise exception 'Campo inválido na exceção individual'; end if;
  end loop;
  perform public.validar_intervalos_calendario(plano->'intervalos');
  if plano->>'expediente'='sem_expediente' and jsonb_array_length(plano->'intervalos')<>0 then raise exception 'Exceção sem expediente não pode conter horários'; end if;
 end if;
 return NEW;
end $$;
revoke all on function public.validar_calendario_dia() from public,anon,authenticated;
create trigger validar_calendario before insert or update on public.escala_dias for each row execute function public.validar_calendario_dia();

create function public.excluir_data_especial(p_empresa uuid,p_id uuid)
 returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.verificar_empresa_operavel(p_empresa,auth.uid());
 perform 1 from public.datas_especiais d where d.id=p_id and d.empresa_id=p_empresa and d.user_id=auth.uid() for update;
 if not found then raise exception 'Data especial indisponível para esta empresa'; end if;
 delete from public.datas_especiais where id=p_id and empresa_id=p_empresa and user_id=auth.uid();
end $$;
revoke all on function public.excluir_data_especial(uuid,uuid) from public,anon,authenticated;
grant execute on function public.excluir_data_especial(uuid,uuid) to authenticated;

-- Amplia somente a lista de recursos autorizados do RPC contextual existente.
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
  when 'empresas' then permitidos:=array['nome','cnpj','cidade','uf','cct','permite_6x1','limite_diario_minutos','usa_banco_horas','folgar_feriados','nome_fantasia','codigo_interno','situacao','endereco','cep','responsavel','contato','observacoes','politica_domingo_feriado','modelo_padrao_id','carga_semanal_padrao_minutos'];
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


-- A gravação atômica existente passa a transportar o metadado opcional do dia.
create or replace function public.salvar_escalas(itens jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb; dia jsonb; sid uuid; begin
 if auth.uid() is null then raise exception 'Autenticação necessária'; end if;
 for item in select value from jsonb_array_elements(itens) loop
 sid:=coalesce(nullif(item->>'id','')::uuid,gen_random_uuid());
 insert into public.escalas(id,empresa_id,funcionario_id,modelo_id,mes,nome_funcionario,modelo_nome,modelo_tipo)
 values(sid,(item->>'empresa_id')::uuid,(item->>'funcionario_id')::uuid,nullif(item->>'modelo_id','')::uuid,(item->>'mes')::date,item->>'nome_funcionario',coalesce(item->>'modelo_nome',''),coalesce(item->>'modelo_tipo','personalizado'))
 on conflict(funcionario_id,mes) do update set modelo_id=excluded.modelo_id,modelo_nome=excluded.modelo_nome,modelo_tipo=excluded.modelo_tipo,nome_funcionario=excluded.nome_funcionario,updated_at=now()
 returning id into sid;
 delete from public.escala_dias where escala_id=sid;
 for dia in select value from jsonb_array_elements(item->'dias') loop
 insert into public.escala_dias(escala_id,data,intervalos,folga,feriado,observacao,calendario) values(sid,(dia->>'data')::date,dia->'intervalos',(dia->>'folga')::boolean,dia->>'feriado',coalesce(dia->>'observacao',''),nullif(dia->'calendario','null'::jsonb));
 end loop;
 end loop;
end $$;
revoke all on function public.salvar_escalas(jsonb) from public;
grant execute on function public.salvar_escalas(jsonb) to authenticated;


insert into supabase_migrations.schema_migrations(version,name) values('20261026173250','special_dates_calendar') on conflict(version) do nothing;

-- Migration: 20261028122734_schedule_governance_operations.sql


-- No legacy schedules/days are regenerated. New states start as drafts.
alter table public.escalas
 add column revisao bigint not null default 0 check(revisao>=0),
 add column status text not null default 'rascunho' check(status in ('rascunho','em_revisao','aprovada','publicada','fechada')),
 add column ultima_justificativa text not null default '',
 add column conferido_em timestamptz,
 add column conferido_por uuid references auth.users(id),
 add column conferencia jsonb;
create index escalas_situacao on public.escalas(user_id,empresa_id,status,mes);

create table public.escala_versoes (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 empresa_id uuid not null,
 escala_id uuid not null,
 revisao bigint not null,
 versao integer not null,
 publicado_em timestamptz not null default clock_timestamp(),
 publicado_por uuid not null default auth.uid() references auth.users(id),
 justificativa text not null default '',
 snapshot jsonb not null,
 foreign key(empresa_id,user_id) references public.empresas(id,user_id),
 foreign key(escala_id,user_id) references public.escalas(id,user_id) on delete cascade,
 unique(escala_id,revisao), unique(escala_id,versao)
);
alter table public.escala_versoes enable row level security;
create policy dono on public.escala_versoes for all to authenticated
 using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.escala_versoes from public,anon,authenticated;
-- INSERT is needed by the invoker trigger. Its BEFORE trigger replaces all
-- client-supplied snapshot/identity fields from the locked authorized schedule.
grant select,insert on public.escala_versoes to authenticated;
create index escala_versoes_empresa on public.escala_versoes(user_id,empresa_id,escala_id,versao desc);

create function public.conferir_fluxo_escala() returns trigger
 language plpgsql security invoker set search_path='' as $$
declare proximo text; c jsonb;
begin
 if TG_OP='INSERT' then
  if NEW.status<>'rascunho' or NEW.revisao<>0 then raise exception 'Uma nova escala deve começar como rascunho'; end if;
  NEW.conferido_em:=null; NEW.conferido_por:=null; NEW.conferencia:=null;
  return NEW;
 end if;
 if NEW.status is distinct from OLD.status then
  proximo:=case OLD.status when 'rascunho' then 'em_revisao' when 'em_revisao' then 'aprovada'
   when 'aprovada' then 'publicada' when 'publicada' then 'fechada' else null end;
  if NEW.status='rascunho' then
   if length(trim(NEW.ultima_justificativa))<10 then raise exception 'Informe uma justificativa de pelo menos 10 caracteres para reabrir'; end if;
   NEW.conferido_em:=null; NEW.conferido_por:=null; NEW.conferencia:=null;
  elsif NEW.status is distinct from proximo then raise exception 'Conclua revisão, aprovação e publicação na ordem';
  end if;
  if (to_jsonb(NEW)-array['status','revisao','updated_at','ultima_justificativa','conferido_em','conferido_por','conferencia'])
   is distinct from (to_jsonb(OLD)-array['status','revisao','updated_at','ultima_justificativa','conferido_em','conferido_por','conferencia']) then
   raise exception 'Altere a situação separadamente dos dados da escala';
  end if;
  if NEW.status in ('aprovada','publicada','fechada') then
   c:=NEW.conferencia;
   if c is null or jsonb_typeof(c)<>'object' or c->'conferida' is distinct from 'true'::jsonb
    or jsonb_typeof(c->'impedimentos') is distinct from 'number' or jsonb_typeof(c->'fontes_pendentes') is distinct from 'number'
    or (c->>'impedimentos')::numeric<>0 or (c->>'fontes_pendentes')::numeric<>0 then
    raise exception 'A conferência explícita deve estar concluída, sem impedimentos ou fontes pendentes';
   end if;
   if NEW.status='aprovada' then NEW.conferido_em:=clock_timestamp(); NEW.conferido_por:=auth.uid(); end if;
   if NEW.status in ('publicada','fechada') and (OLD.conferido_em is null or OLD.conferido_por is null) then
    raise exception 'A escala precisa de conferência registrada antes da publicação';
   end if;
   if NEW.status in ('publicada','fechada') then
    NEW.conferido_em:=OLD.conferido_em; NEW.conferido_por:=OLD.conferido_por;
   end if;
  elsif NEW.status='em_revisao' then
   NEW.conferido_em:=null; NEW.conferido_por:=null; NEW.conferencia:=null;
  end if;
 elsif OLD.status in ('aprovada','publicada','fechada') then
  raise exception 'Escala bloqueada: reabra com justificativa antes de editar';
 else
  -- Editing a draft invalidates a prior review; callers cannot forge its actor.
  NEW.conferido_em:=OLD.conferido_em; NEW.conferido_por:=OLD.conferido_por;
  NEW.conferencia:=OLD.conferencia;
 end if;
 NEW.revisao:=OLD.revisao+1;
 NEW.updated_at:=clock_timestamp();
 return NEW;
end $$;
revoke all on function public.conferir_fluxo_escala() from public,anon,authenticated;
create trigger conferir_fluxo before insert or update on public.escalas for each row execute function public.conferir_fluxo_escala();

create function public.proteger_dias_escala() returns trigger
 language plpgsql security invoker set search_path='' as $$
declare sid uuid; estado text;
begin
 sid:=case when TG_OP='DELETE' then OLD.escala_id else NEW.escala_id end;
 select s.status into estado from public.escalas s where s.id=sid and s.user_id=auth.uid() for update;
 if not found then
  -- Preserve server-side account cleanup; authenticated clients cannot delete
  -- a parent schedule and are always required to resolve an authorized parent.
  if TG_OP='DELETE' and exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then return OLD; end if;
  raise exception 'Escala indisponível para esta empresa';
 end if;
 if estado in ('aprovada','publicada','fechada') then raise exception 'Escala bloqueada: reabra com justificativa antes de editar'; end if;
 update public.escalas set updated_at=clock_timestamp() where id=sid and user_id=auth.uid();
 if TG_OP='DELETE' then return OLD; end if; return NEW;
end $$;
revoke all on function public.proteger_dias_escala() from public,anon,authenticated;
create trigger proteger_fluxo before insert or update or delete on public.escala_dias for each row execute function public.proteger_dias_escala();

create function public.preparar_versao_escala() returns trigger
 language plpgsql security invoker set search_path='' as $$
declare s public.escalas; contexto jsonb; escala_json jsonb;
begin
 select * into s from public.escalas where id=NEW.escala_id and user_id=auth.uid() for update;
 if not found or s.status<>'publicada' then raise exception 'Somente uma escala publicada pode gerar versão'; end if;
 perform public.verificar_empresa_operavel(s.empresa_id,auth.uid());
 NEW.user_id:=auth.uid(); NEW.empresa_id:=s.empresa_id; NEW.revisao:=s.revisao;
 NEW.publicado_por:=auth.uid(); NEW.publicado_em:=clock_timestamp(); NEW.justificativa:=s.ultima_justificativa;
 select coalesce(max(v.versao),0)+1 into NEW.versao from public.escala_versoes v where v.escala_id=s.id and v.user_id=auth.uid();
 -- Include the same employee's adjacent schedules: nights, weeks and 12x36
 -- continue to be reproducible at month boundaries after future edits.
 select jsonb_build_object(
  'companies',(select jsonb_agg(to_jsonb(e)-'user_id') from public.empresas e where e.id=s.empresa_id and e.user_id=auth.uid()),
  'employees',(select jsonb_agg(to_jsonb(f)-'user_id') from public.funcionarios f where f.id=s.funcionario_id and f.empresa_id=s.empresa_id and f.user_id=auth.uid()),
  'models',coalesce((select jsonb_agg(to_jsonb(m)-'user_id') from public.modelos_jornada m where m.user_id=auth.uid() and (m.empresa_id=s.empresa_id or m.empresa_id is null)),'[]'::jsonb),
  'rules',coalesce((select jsonb_agg(to_jsonb(r)-'user_id') from public.parametros_legais r where r.user_id=auth.uid() and (r.empresa_id=s.empresa_id or r.empresa_id is null)),'[]'::jsonb),
  'holidays',coalesce((select jsonb_agg(to_jsonb(h)-'user_id') from public.feriados h where h.user_id=auth.uid() and (h.empresa_id=s.empresa_id or h.empresa_id is null)),'[]'::jsonb),
  'specialDates',coalesce((select jsonb_agg(to_jsonb(d)-'user_id') from public.datas_especiais d where d.user_id=auth.uid() and d.empresa_id=s.empresa_id),'[]'::jsonb),
  'establishments',coalesce((select jsonb_agg(to_jsonb(e)-'user_id') from public.estabelecimentos e where e.user_id=auth.uid() and e.empresa_id=s.empresa_id),'[]'::jsonb),
  'schedules',coalesce((select jsonb_agg((to_jsonb(e)-'user_id') || jsonb_build_object('dias',coalesce((select jsonb_agg(jsonb_build_object('data',d.data,'intervalos',d.intervalos,'folga',d.folga,'feriado',d.feriado,'observacao',d.observacao,'calendario',d.calendario) order by d.data) from public.escala_dias d where d.escala_id=e.id and d.user_id=auth.uid()),'[]'::jsonb))) from public.escalas e where e.user_id=auth.uid() and e.empresa_id=s.empresa_id and e.funcionario_id=s.funcionario_id and e.mes between (s.mes-interval '1 month')::date and (s.mes+interval '1 month')::date),'[]'::jsonb),
  'logs','[]'::jsonb
 ) into contexto;
 NEW.snapshot:=jsonb_build_object('schema_version',1,'data',contexto);
 return NEW;
end $$;
revoke all on function public.preparar_versao_escala() from public,anon,authenticated;
create trigger preparar_versao before insert on public.escala_versoes for each row execute function public.preparar_versao_escala();
create trigger auditar after insert on public.escala_versoes for each row execute function public.auditar_alteracao();
create function public.publicar_versao_escala() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if NEW.status='publicada' and OLD.status<>'publicada' then
  insert into public.escala_versoes(escala_id,empresa_id,revisao,versao,snapshot)
   values(NEW.id,NEW.empresa_id,NEW.revisao,0,'{}'::jsonb);
 end if;
 return NEW;
end $$;
revoke all on function public.publicar_versao_escala() from public,anon,authenticated;
create trigger publicar_versao after update on public.escalas for each row execute function public.publicar_versao_escala();

create function public.alterar_status_escala(p_empresa uuid,p_escala uuid,p_status text,p_revisao bigint,p_justificativa text,p_conferencia jsonb)
 returns void language plpgsql security invoker set search_path='' as $$
declare s public.escalas;
begin
 perform public.verificar_empresa_operavel(p_empresa,auth.uid());
 select * into s from public.escalas where id=p_escala and empresa_id=p_empresa and user_id=auth.uid() for update;
 if not found then raise exception 'Escala indisponível para esta empresa'; end if;
 if p_revisao is null or s.revisao<>p_revisao then raise exception 'A escala foi alterada em outra sessão. Atualize antes de continuar'; end if;
 if p_status is null or p_status not in ('rascunho','em_revisao','aprovada','publicada','fechada') then raise exception 'Situação inválida'; end if;
 if p_status=s.status then raise exception 'A escala já está nessa situação'; end if;
 update public.escalas set status=p_status,ultima_justificativa=coalesce(trim(p_justificativa),''),conferencia=p_conferencia
  where id=s.id and user_id=auth.uid();
end $$;
revoke all on function public.alterar_status_escala(uuid,uuid,text,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.alterar_status_escala(uuid,uuid,text,bigint,text,jsonb) to authenticated;

-- The optional expected revision preserves old clients while the new client
-- always sends the revision it opened; null means a genuinely new schedule.
create or replace function public.salvar_escalas(itens jsonb) returns void
 language plpgsql security invoker set search_path='' as $$
declare item jsonb; dia jsonb; sid uuid; existente public.escalas;
begin
 if auth.uid() is null then raise exception 'Autenticação necessária'; end if;
 if itens is null or jsonb_typeof(itens)<>'array' or jsonb_array_length(itens)>1000 then raise exception 'Lote de escalas inválido'; end if;
 for item in select value from jsonb_array_elements(itens) loop
  if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'dias') is distinct from 'array' then raise exception 'Dados de escala inválidos'; end if;
  -- The legacy unscoped RPC must serialize new inserts too. The company RPC
  -- takes the same row lock, so both entry points share the creation guard.
  perform 1 from public.empresas where id=(item->>'empresa_id')::uuid and user_id=auth.uid() for update;
  if not found then raise exception 'Empresa indisponível ou sem permissão'; end if;
  select * into existente from public.escalas where funcionario_id=(item->>'funcionario_id')::uuid and mes=(item->>'mes')::date and user_id=auth.uid() for update;
  if item ? 'revisao_esperada' then
   if item->'revisao_esperada'='null'::jsonb then
    if existente.id is not null then raise exception 'Já existe uma escala nesta competência. Atualize antes de continuar'; end if;
   else
    if jsonb_typeof(item->'revisao_esperada') is distinct from 'number' or (item->>'revisao_esperada')::numeric<0
     or (item->>'revisao_esperada')::numeric<>trunc((item->>'revisao_esperada')::numeric) then raise exception 'Revisão esperada inválida'; end if;
    if existente.id is null or existente.revisao<>(item->>'revisao_esperada')::bigint then raise exception 'A escala foi alterada em outra sessão. Atualize antes de continuar'; end if;
   end if;
  end if;
  if existente.id is not null and existente.status in ('aprovada','publicada','fechada') then raise exception 'Escala bloqueada: reabra com justificativa antes de editar'; end if;
  sid:=coalesce(nullif(item->>'id','')::uuid,gen_random_uuid());
  insert into public.escalas(id,empresa_id,funcionario_id,modelo_id,mes,nome_funcionario,modelo_nome,modelo_tipo)
  values(sid,(item->>'empresa_id')::uuid,(item->>'funcionario_id')::uuid,nullif(item->>'modelo_id','')::uuid,(item->>'mes')::date,item->>'nome_funcionario',coalesce(item->>'modelo_nome',''),coalesce(item->>'modelo_tipo','personalizado'))
  on conflict(funcionario_id,mes) do update set modelo_id=excluded.modelo_id,modelo_nome=excluded.modelo_nome,modelo_tipo=excluded.modelo_tipo,nome_funcionario=excluded.nome_funcionario,updated_at=clock_timestamp()
  returning id into sid;
  delete from public.escala_dias where escala_id=sid;
  for dia in select value from jsonb_array_elements(item->'dias') loop
   insert into public.escala_dias(escala_id,data,intervalos,folga,feriado,observacao,calendario)
   values(sid,(dia->>'data')::date,dia->'intervalos',(dia->>'folga')::boolean,dia->>'feriado',coalesce(dia->>'observacao',''),nullif(dia->'calendario','null'::jsonb));
  end loop;
 end loop;
end $$;
revoke all on function public.salvar_escalas(jsonb) from public,anon,authenticated;
grant execute on function public.salvar_escalas(jsonb) to authenticated;
create or replace function public.salvar_escalas_empresa(p_empresa uuid,itens jsonb)
 returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb; chave text; escala uuid;
begin
 perform public.verificar_empresa_operavel(p_empresa,auth.uid());
 -- Serialize a company's new insert race without imposing a global lock.
 perform 1 from public.empresas where id=p_empresa and user_id=auth.uid() for update;
 if itens is null or jsonb_typeof(itens)<>'array' then raise exception 'Escalas inválidas para esta empresa'; end if;
 for item in select value from jsonb_array_elements(itens) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Escala inválida para esta empresa'; end if;
  for chave in select jsonb_object_keys(item) loop
   if not(chave=any(array['id','empresa_id','funcionario_id','modelo_id','mes','nome_funcionario','modelo_nome','modelo_tipo','dias','revisao_esperada'])) then raise exception 'Campo não permitido na escala: %',chave; end if;
  end loop;
  if (item->>'empresa_id')::uuid is distinct from p_empresa then raise exception 'A empresa da escala deve corresponder ao contexto'; end if;
  escala:=nullif(item->>'id','')::uuid;
  if escala is not null then
   perform 1 from public.escalas s where s.id=escala and s.empresa_id=p_empresa and s.user_id=auth.uid()
    and s.funcionario_id=(item->>'funcionario_id')::uuid and s.mes=(item->>'mes')::date for update;
   if not found then raise exception 'Escala indisponível para esta empresa'; end if;
  end if;
 end loop;
 perform public.salvar_escalas(itens);
end $$;
revoke all on function public.salvar_escalas_empresa(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.salvar_escalas_empresa(uuid,jsonb) to authenticated;

create table public.registros_operacionais (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 empresa_id uuid not null,
 tipo text not null check(tipo in ('ausencia','cobertura','troca','documento','realizado')),
 status text not null default 'pendente' check(status in ('pendente','aprovado','cancelado')),
 titulo text not null check(length(trim(titulo)) between 1 and 200),
 funcionario_id uuid,
 data_inicio date not null, data_fim date not null,
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=65536),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 foreign key(empresa_id,user_id) references public.empresas(id,user_id),
 foreign key(funcionario_id,empresa_id,user_id) references public.funcionarios(id,empresa_id,user_id),
 check(data_fim>=data_inicio and data_fim-data_inicio<=3660),
 check((tipo in ('ausencia','troca','realizado') and funcionario_id is not null) or (tipo in ('cobertura','documento') and funcionario_id is null)),
 check(tipo<>'realizado' or data_inicio=data_fim)
);
alter table public.registros_operacionais enable row level security;
create policy dono on public.registros_operacionais for all to authenticated
 using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.registros_operacionais from public,anon,authenticated;
grant select,insert,update,delete on public.registros_operacionais to authenticated;
create index registros_operacionais_empresa on public.registros_operacionais(user_id,empresa_id,tipo,data_inicio);
create unique index registro_realizado_dia on public.registros_operacionais(user_id,empresa_id,funcionario_id,data_inicio) where tipo='realizado' and status='aprovado';
create function public.validar_operacao_empresa() returns trigger
 language plpgsql security invoker set search_path='' as $$
declare p jsonb; chave text; permitidos text[]; alvo uuid; d jsonb; inicio integer; termino integer; total_minutos integer:=0;
begin
 p:=NEW.payload;
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'Dados da operação inválidos'; end if;
 if NEW.funcionario_id is not null then
  perform 1 from public.funcionarios f where f.id=NEW.funcionario_id and f.empresa_id=NEW.empresa_id and f.user_id=auth.uid()
   and (NEW.status='cancelado' or f.situacao='ativo') for share;
  if not found then raise exception 'Funcionário indisponível para esta empresa'; end if;
 end if;
 case NEW.tipo
 when 'ausencia' then
  permitidos:=array['categoria','motivo'];
  if coalesce(p->>'categoria','') not in ('ferias','afastamento','indisponibilidade') or jsonb_typeof(p->'motivo') is distinct from 'string' or length(p->>'motivo')>1000 then raise exception 'Ausência inválida'; end if;
 when 'cobertura' then
  permitidos:=array['estabelecimento_id','setor','cargo','inicio','fim','minimo','dias_semana'];
  if not(p?'estabelecimento_id') or jsonb_typeof(p->'setor') is distinct from 'string' or length(p->>'setor')>160
   or jsonb_typeof(p->'cargo') is distinct from 'string' or length(p->>'cargo')>160
   or coalesce(p->>'inicio','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p->>'fim','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or jsonb_typeof(p->'minimo') is distinct from 'number' or (p->>'minimo')::numeric not between 1 and 1000
   or (p->>'minimo')::numeric<>trunc((p->>'minimo')::numeric)
   or jsonb_typeof(p->'dias_semana') is distinct from 'array' then raise exception 'Cobertura inválida'; end if;
  if jsonb_array_length(p->'dias_semana') not between 1 and 7 then raise exception 'Dias da cobertura inválidos'; end if;
  for d in select value from jsonb_array_elements(p->'dias_semana') loop
   if jsonb_typeof(d)<>'number' or d::text::numeric not between 0 and 6 or d::text::numeric<>trunc(d::text::numeric) then raise exception 'Dia da cobertura inválido'; end if;
  end loop;
  if (select count(distinct value) from jsonb_array_elements(p->'dias_semana'))<>jsonb_array_length(p->'dias_semana') then raise exception 'Dias da cobertura duplicados'; end if;
  alvo:=nullif(p->>'estabelecimento_id','')::uuid;
  if alvo is not null then
   perform 1 from public.estabelecimentos e where e.id=alvo and e.empresa_id=NEW.empresa_id and e.user_id=auth.uid() and e.ativo for share;
   if not found then raise exception 'Estabelecimento deve pertencer à empresa'; end if;
  end if;
 when 'troca' then
  permitidos:=array['destino_funcionario_id','data_origem','data_destino','justificativa'];
  alvo:=nullif(p->>'destino_funcionario_id','')::uuid;
  perform 1 from public.funcionarios f where f.id=alvo and f.empresa_id=NEW.empresa_id and f.user_id=auth.uid() and f.id<>NEW.funcionario_id and (NEW.status='cancelado' or f.situacao='ativo') for share;
  if not found then raise exception 'Destino da troca deve ser outro funcionário da empresa'; end if;
  if coalesce(p->>'data_origem','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(p->>'data_destino','')!~'^\d{4}-\d{2}-\d{2}$'
   or (p->>'data_origem')::date not between NEW.data_inicio and NEW.data_fim or (p->>'data_destino')::date not between NEW.data_inicio and NEW.data_fim
   or NEW.data_inicio<>least((p->>'data_origem')::date,(p->>'data_destino')::date)
   or NEW.data_fim<>greatest((p->>'data_origem')::date,(p->>'data_destino')::date)
   or jsonb_typeof(p->'justificativa') is distinct from 'string' or length(trim(p->>'justificativa'))=0 or length(p->>'justificativa')>1000 then raise exception 'Período ou justificativa da troca inválido'; end if;
 when 'documento' then
  permitidos:=array['fonte','url','vigencia_fim','referencia'];
  if jsonb_typeof(p->'fonte') is distinct from 'string' or length(trim(p->>'fonte'))=0 or length(p->>'fonte')>500 or jsonb_typeof(p->'referencia') is distinct from 'string' or length(p->>'referencia')>500 then raise exception 'Referência documental inválida'; end if;
  if p->>'url' is not null and p->>'url'<>'' and (length(p->>'url')>2048 or p->>'url' !~ '^https://[^/?#@[:space:]]+([/?#].*)?$' or p->>'url' ~ '[[:cntrl:][:space:]]') then raise exception 'O documento deve usar endereço HTTPS sem credenciais'; end if;
  if p->>'vigencia_fim' is not null and p->>'vigencia_fim'<>'' and ((p->>'vigencia_fim')!~'^\d{4}-\d{2}-\d{2}$' or (p->>'vigencia_fim')::date<NEW.data_inicio or (p->>'vigencia_fim')::date<>NEW.data_fim) then raise exception 'Vigência documental inválida'; end if;
 when 'realizado' then
  permitidos:=array['intervalos','origem','observacao'];
  if coalesce(p->>'origem','') not in ('manual','importacao') or jsonb_typeof(p->'observacao') is distinct from 'string' or length(p->>'observacao')>1000 then raise exception 'Origem das marcações inválida'; end if;
  perform public.validar_intervalos_calendario(p->'intervalos',true);
  if jsonb_array_length(p->'intervalos')>12 then raise exception 'Informe até doze períodos efetivamente registrados'; end if;
  for d in select value from jsonb_array_elements(p->'intervalos') loop
   inicio:=split_part(d->>'start',':',1)::integer*60+split_part(d->>'start',':',2)::integer;
   termino:=split_part(d->>'end',':',1)::integer*60+split_part(d->>'end',':',2)::integer;
   total_minutos:=total_minutos+termino+coalesce((d->>'endDay')::numeric::integer,coalesce((d->>'startDay')::numeric::integer,0)+case when termino<=inicio then 1 else 0 end)*1440-inicio-coalesce((d->>'startDay')::numeric::integer,0)*1440;
  end loop;
  if total_minutos>1440 then raise exception 'As marcações não podem ultrapassar 24 horas'; end if;
 else raise exception 'Tipo de operação inválido';
 end case;
 for chave in select jsonb_object_keys(p) loop
  if not(chave=any(permitidos)) then raise exception 'Campo não permitido na operação: %',chave; end if;
 end loop;
 NEW.updated_at:=clock_timestamp();
 return NEW;
end $$;
revoke all on function public.validar_operacao_empresa() from public,anon,authenticated;
create trigger validar_contexto before insert or update or delete on public.registros_operacionais for each row execute function public.validar_recurso_empresa();
create trigger validar_operacao before insert or update on public.registros_operacionais for each row execute function public.validar_operacao_empresa();
create trigger auditar after insert or update or delete on public.registros_operacionais for each row execute function public.auditar_alteracao();

create function public.salvar_operacao_empresa(p_empresa uuid,p_id uuid,p_valores jsonb)
 returns uuid language plpgsql security invoker set search_path='' as $$
declare chave text; sid uuid;
begin
 perform public.verificar_empresa_operavel(p_empresa,auth.uid());
 if jsonb_typeof(p_valores) is distinct from 'object' then raise exception 'Dados da operação inválidos'; end if;
 for chave in select jsonb_object_keys(p_valores) loop
  if not(chave=any(array['tipo','status','titulo','funcionario_id','data_inicio','data_fim','payload'])) then raise exception 'Campo não permitido na operação: %',chave; end if;
 end loop;
 if p_id is null then
  insert into public.registros_operacionais(empresa_id,tipo,status,titulo,funcionario_id,data_inicio,data_fim,payload)
   values(p_empresa,p_valores->>'tipo',p_valores->>'status',p_valores->>'titulo',nullif(p_valores->>'funcionario_id','')::uuid,(p_valores->>'data_inicio')::date,(p_valores->>'data_fim')::date,p_valores->'payload') returning id into sid;
 else
  update public.registros_operacionais set tipo=p_valores->>'tipo',status=p_valores->>'status',titulo=p_valores->>'titulo',
   funcionario_id=nullif(p_valores->>'funcionario_id','')::uuid,data_inicio=(p_valores->>'data_inicio')::date,data_fim=(p_valores->>'data_fim')::date,payload=p_valores->'payload'
   where id=p_id and empresa_id=p_empresa and user_id=auth.uid() returning id into sid;
  if sid is null then raise exception 'Operação indisponível para esta empresa'; end if;
 end if;
 return sid;
end $$;
revoke all on function public.salvar_operacao_empresa(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.salvar_operacao_empresa(uuid,uuid,jsonb) to authenticated;
create function public.excluir_operacao_empresa(p_empresa uuid,p_id uuid)
 returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.verificar_empresa_operavel(p_empresa,auth.uid());
 delete from public.registros_operacionais where id=p_id and empresa_id=p_empresa and user_id=auth.uid();
 if not found then raise exception 'Operação indisponível para esta empresa'; end if;
end $$;
revoke all on function public.excluir_operacao_empresa(uuid,uuid) from public,anon,authenticated;
grant execute on function public.excluir_operacao_empresa(uuid,uuid) to authenticated;

create function public.importar_funcionarios_empresa(p_empresa uuid,p_itens jsonb)
 returns uuid[] language plpgsql security invoker set search_path='' as $$
declare item jsonb; ids uuid[]:='{}'::uuid[]; valor_cpf text; valor_matricula text;
begin
 perform public.verificar_empresa_operavel(p_empresa,auth.uid());
 perform 1 from public.empresas where id=p_empresa and user_id=auth.uid() for update;
 if p_itens is null or jsonb_typeof(p_itens)<>'array' or jsonb_array_length(p_itens) not between 1 and 1000 then raise exception 'Importe de 1 a 1000 funcionários por lote'; end if;
 for item in select value from jsonb_array_elements(p_itens) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Funcionário inválido'; end if;
  valor_cpf:=nullif(trim(item->>'cpf'),''); valor_matricula:=nullif(lower(trim(item->>'matricula')),'');
  if valor_cpf is not null and exists(select 1 from public.funcionarios f where f.empresa_id=p_empresa and f.user_id=auth.uid() and f.cpf=valor_cpf) then raise exception 'CPF já cadastrado nesta empresa; nenhum funcionário foi importado'; end if;
  if valor_matricula is not null and exists(select 1 from public.funcionarios f where f.empresa_id=p_empresa and f.user_id=auth.uid() and lower(trim(f.matricula))=valor_matricula) then raise exception 'Matrícula já cadastrada nesta empresa; nenhum funcionário foi importado'; end if;
  ids:=array_append(ids,public.salvar_registro_empresa(p_empresa,'funcionarios',item,null));
 end loop;
 return ids;
end $$;
revoke all on function public.importar_funcionarios_empresa(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.importar_funcionarios_empresa(uuid,jsonb) to authenticated;

create function public.aplicar_troca_empresa(p_empresa uuid,p_operacao uuid,p_itens jsonb)
 returns void language plpgsql security invoker set search_path='' as $$
declare operacao public.registros_operacionais; item jsonb; dia jsonb; atual public.escalas; existente public.escala_dias;
 origem uuid; destino uuid; data_origem date; data_destino date; data_alvo date; pessoa uuid; normalizado jsonb;
 vistos uuid[]:='{}'::uuid[];
begin
 perform public.verificar_empresa_operavel(p_empresa,auth.uid());
 perform 1 from public.empresas where id=p_empresa and user_id=auth.uid() for update;
 select * into operacao from public.registros_operacionais where id=p_operacao and empresa_id=p_empresa and user_id=auth.uid() for update;
 if not found or operacao.tipo<>'troca' or operacao.status<>'pendente' then raise exception 'Somente uma solicitação de troca pendente desta empresa pode ser aplicada'; end if;
 if p_itens is null or jsonb_typeof(p_itens)<>'array' or jsonb_array_length(p_itens)<>2 then raise exception 'A troca exige exatamente as duas escalas envolvidas'; end if;
 origem:=operacao.funcionario_id; destino:=(operacao.payload->>'destino_funcionario_id')::uuid;
 data_origem:=(operacao.payload->>'data_origem')::date; data_destino:=(operacao.payload->>'data_destino')::date;
 for item in select value from jsonb_array_elements(p_itens) loop
  pessoa:=(item->>'funcionario_id')::uuid;
  if pessoa=origem then data_alvo:=data_origem;
  elsif pessoa=destino then data_alvo:=data_destino;
  else raise exception 'A troca deve conter somente os dois funcionários da solicitação'; end if;
  if pessoa=any(vistos) then raise exception 'Funcionário duplicado no lote de troca'; end if;
  vistos:=array_append(vistos,pessoa);
  select * into atual from public.escalas where id=nullif(item->>'id','')::uuid and user_id=auth.uid()
   and empresa_id=p_empresa and funcionario_id=pessoa and mes=date_trunc('month',data_alvo)::date for update;
  if not found then raise exception 'Carregue as duas escalas salvas antes de aplicar a troca'; end if;
  if not(item?'revisao_esperada') or item->'revisao_esperada'='null'::jsonb then raise exception 'A troca exige a revisão carregada das duas escalas'; end if;
  if jsonb_typeof(item->'dias') is distinct from 'array' then raise exception 'Dias da troca inválidos'; end if;
  if (item->>'modelo_id')::uuid is distinct from atual.modelo_id or (item->>'modelo_nome') is distinct from atual.modelo_nome
   or (item->>'modelo_tipo') is distinct from atual.modelo_tipo or (item->>'nome_funcionario') is distinct from atual.nome_funcionario then
   raise exception 'A troca não pode modificar o modelo ou a identificação da escala';
  end if;
  if not exists(select 1 from jsonb_array_elements(item->'dias') d where (d->>'data')::date=data_alvo) then raise exception 'O dia da troca deve estar presente'; end if;
  if exists(select 1 from public.escala_dias d where d.escala_id=atual.id and d.user_id=auth.uid()
   and not exists(select 1 from jsonb_array_elements(item->'dias') entrada where (entrada->>'data')::date=d.data)) then
   raise exception 'A troca não pode remover outros dias da escala';
  end if;
  for dia in select value from jsonb_array_elements(item->'dias') loop
   if (dia->>'data')::date=data_alvo then continue; end if;
   select * into existente from public.escala_dias where escala_id=atual.id and user_id=auth.uid() and data=(dia->>'data')::date;
   normalizado:=jsonb_build_object('intervalos',dia->'intervalos','folga',dia->'folga','feriado',coalesce(dia->'feriado','null'::jsonb),'observacao',coalesce(dia->>'observacao',''),'calendario',coalesce(dia->'calendario','null'::jsonb));
   if not found or normalizado is distinct from jsonb_build_object('intervalos',existente.intervalos,'folga',existente.folga,'feriado',existente.feriado,'observacao',existente.observacao,'calendario',existente.calendario) then
    raise exception 'A troca não pode alterar dias fora da solicitação';
   end if;
  end loop;
 end loop;
 perform public.salvar_escalas_empresa(p_empresa,p_itens);
 update public.registros_operacionais set status='aprovado' where id=operacao.id and empresa_id=p_empresa and user_id=auth.uid();
end $$;
revoke all on function public.aplicar_troca_empresa(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.aplicar_troca_empresa(uuid,uuid,jsonb) to authenticated;


insert into supabase_migrations.schema_migrations(version,name) values('20261028122734','schedule_governance_operations') on conflict(version) do nothing;

-- Migration: 20261029123937_three_level_review_attestation.sql


-- Adds an explicit attention-review attestation without rewriting legacy rows.
-- The original workflow trigger continues to reject blockers, missing sources,
-- skipped steps, concurrent edits and unauthorized schedules under owner RLS.
create function public.conferir_atencoes_escala() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare c jsonb;
begin
 if NEW.status is not distinct from OLD.status
  or NEW.status not in ('aprovada','publicada','fechada') then return NEW; end if;
 c:=NEW.conferencia;
 -- New approvals always require the current attestation. Previously approved
 -- legacy rows may still be published/closed without rewriting their history.
 -- Once recorded, a direct update cannot drop the new policy's fields.
 if NEW.status='aprovada'
  or coalesce(c ?| array['politica_validacao','atencoes','informativos','atencoes_conferidas'],false)
  or OLD.conferencia->>'politica_validacao'='3-niveis-v1' then
  if c->>'politica_validacao' is distinct from '3-niveis-v1'
   or jsonb_typeof(c->'atencoes') is distinct from 'number'
   or jsonb_typeof(c->'informativos') is distinct from 'number'
   or jsonb_typeof(c->'atencoes_conferidas') is distinct from 'boolean' then
   raise exception 'A conferência dos níveis de alerta está incompleta';
  end if;
  if (c->>'atencoes')::numeric<0
   or (c->>'atencoes')::numeric<>trunc((c->>'atencoes')::numeric)
   or (c->>'informativos')::numeric<0
   or (c->>'informativos')::numeric<>trunc((c->>'informativos')::numeric) then
   raise exception 'Contagem de alertas inválida';
  end if;
  if (c->>'atencoes')::numeric>0 and
   (c->'atencoes_conferidas' is distinct from 'true'::jsonb
    or coalesce(length(trim(NEW.ultima_justificativa)),0)<10) then
   raise exception 'Confira os alertas de atenção e registre uma justificativa de pelo menos 10 caracteres';
  end if;
 end if;
 return NEW;
end $$;
revoke all on function public.conferir_atencoes_escala() from public,anon,authenticated;
create trigger conferir_atencoes before update on public.escalas
for each row execute function public.conferir_atencoes_escala();


insert into supabase_migrations.schema_migrations(version,name) values('20261029123937','three_level_review_attestation') on conflict(version) do nothing;

-- Migration: 20261029150540_username_login_and_attempt_limits.sql


-- An alias belongs to the existing Auth UUID. Passwords, recovery addresses and
-- account authorization remain in Supabase Auth and the existing owner policies.
create table public.nomes_login (
 user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
 usuario text not null unique,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint nome_login_normalizado check (
  usuario = lower(btrim(usuario))
  and usuario ~ '^[a-z0-9][a-z0-9._-]{2,31}$'
  and usuario <> all(array['admin','administrator','root','sistema','suporte','service_role','postgres','anon','authenticated'])
 )
);
alter table public.nomes_login enable row level security;
revoke all on public.nomes_login from public,anon,authenticated;
grant select,insert,update on public.nomes_login to authenticated;
create policy nome_login_leitura on public.nomes_login for select to authenticated
 using ((select auth.uid()) = user_id);
create policy nome_login_criacao on public.nomes_login for insert to authenticated
 with check ((select auth.uid()) = user_id);
create policy nome_login_alteracao on public.nomes_login for update to authenticated
 using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.definir_nome_usuario(p_usuario text) returns text
language plpgsql security invoker set search_path = '' as $$
declare v_usuario text := lower(btrim(p_usuario));
begin
 if auth.uid() is null then raise exception 'Autenticação necessária'; end if;
 insert into public.nomes_login(user_id,usuario) values(auth.uid(),v_usuario)
 on conflict(user_id) do update set usuario=excluded.usuario,updated_at=now();
 return v_usuario;
exception
 when unique_violation then
  raise exception using errcode='23505',message='Nome de usuário indisponível ou inválido';
 when check_violation or not_null_violation then
  raise exception using errcode='23514',message='Nome de usuário indisponível ou inválido';
end $$;
revoke all on function public.definir_nome_usuario(text) from public,anon,authenticated;
grant execute on function public.definir_nome_usuario(text) to authenticated;

-- Only a trusted server resolves an alias. It receives an opaque UUID; this RPC
-- never exposes auth.users, email addresses, password hashes or a public list.
create function public.resolver_usuario_login(p_usuario text) returns uuid
language sql stable security invoker set search_path = '' as $$
 select n.user_id from public.nomes_login n where n.usuario=lower(btrim(p_usuario))
$$;
revoke all on function public.resolver_usuario_login(text) from public,anon,authenticated;

-- The Auth creation transaction reserves the requested alias atomically. The
-- metadata is only a requested label, never an authorization/role claim. Legacy
-- accounts without the metadata remain unchanged and can claim an alias later.
create schema if not exists cont_auth_private;
revoke all on schema cont_auth_private from public,anon,authenticated;
create function cont_auth_private.registrar_nome_login() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_metadata jsonb := to_jsonb(NEW)->'raw_user_meta_data';
begin
 if v_metadata is null or not (v_metadata ? 'username') then return NEW; end if;
 if jsonb_typeof(v_metadata->'username') is distinct from 'string' then
  raise exception 'Nome de usuário indisponível ou inválido';
 end if;
 insert into public.nomes_login(user_id,usuario)
 values(NEW.id,lower(btrim(v_metadata->>'username')));
 return NEW;
exception when unique_violation or check_violation or not_null_violation then
 raise exception 'Nome de usuário indisponível ou inválido';
end $$;
revoke all on function cont_auth_private.registrar_nome_login() from public,anon,authenticated;
create trigger cont_registrar_nome_login after insert on auth.users
for each row execute function cont_auth_private.registrar_nome_login();

-- Only keyed HMAC digests from the trusted server are retained, never raw IPs,
-- usernames, emails or passwords. One bucket survives every server instance.
create table public.login_tentativas (
 chave text primary key check(chave ~ '^(ip|usuario|conta):[0-9a-f]{64}$'),
 inicio_janela timestamptz not null,
 tentativas integer not null check(tentativas between 1 and 31)
);
create index login_tentativas_expiracao on public.login_tentativas(inicio_janela);
alter table public.login_tentativas enable row level security;
revoke all on public.login_tentativas from public,anon,authenticated;

create function public.consumir_tentativa_login(p_chave text)
returns table(permitido boolean,retry_after_s integer)
language plpgsql security invoker set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_limite integer; v_inicio timestamptz; v_tentativas integer;
begin
 if p_chave is null or p_chave !~ '^(ip|usuario|conta):[0-9a-f]{64}$' then
  raise exception 'Identificador de limite inválido';
 end if;
 v_limite := case when p_chave like 'usuario:%' then 8 else 30 end;
 -- Bounded cleanup keeps a 24-hour operational retention without a cron/job or
 -- unbounded scan on every login. The expiration index supports this selection.
 delete from public.login_tentativas where chave in (
  select chave from public.login_tentativas
  where inicio_janela < v_now - interval '24 hours'
  order by inicio_janela limit 100
 );
 insert into public.login_tentativas as t(chave,inicio_janela,tentativas)
 values(p_chave,v_now,1)
 on conflict(chave) do update set
  inicio_janela=case when t.inicio_janela <= v_now - interval '15 minutes' then v_now else t.inicio_janela end,
  tentativas=case when t.inicio_janela <= v_now - interval '15 minutes' then 1 else least(t.tentativas+1,v_limite+1) end
 returning inicio_janela,tentativas into v_inicio,v_tentativas;
 permitido := v_tentativas <= v_limite;
 retry_after_s := case when permitido then 0 else greatest(1,ceil(extract(epoch from v_inicio + interval '15 minutes' - v_now))::integer) end;
 return next;
end $$;
revoke all on function public.consumir_tentativa_login(text) from public,anon,authenticated;

-- Supabase installs this role. The conditional keeps the incremental migration
-- compatible with minimal local test fixtures without creating privileged roles.
do $$ begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  grant select on public.nomes_login to service_role;
  grant select,insert,update,delete on public.login_tentativas to service_role;
  grant execute on function public.resolver_usuario_login(text) to service_role;
  grant execute on function public.consumir_tentativa_login(text) to service_role;
 end if;
end $$;


insert into supabase_migrations.schema_migrations(version,name) values('20261029150540','username_login_and_attempt_limits') on conflict(version) do nothing;

-- Migration: 20261029193932_internal_trigger_function_privileges.sql


-- Supabase's default privileges may grant EXECUTE directly to API roles even
-- after a previous migration revoked PUBLIC. These are internal trigger entry
-- points, never RPCs. Revoking direct calls does not disable their triggers.
revoke all on function public.auditar_alteracao() from public,anon,authenticated;

-- Some Supabase projects install this event-trigger helper automatically.
-- Local/older projects may not have it; preserve any unrelated same-name
-- function rather than changing its privileges or replacing its body.
do $$ begin
 if exists (
  select 1 from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='rls_auto_enable'
   and p.pronargs=0 and p.prokind='f'
   and p.prorettype='pg_catalog.event_trigger'::regtype
 ) then
  revoke all on function public.rls_auto_enable() from public,anon,authenticated;
 end if;
end $$;


insert into supabase_migrations.schema_migrations(version,name) values('20261029193932','internal_trigger_function_privileges') on conflict(version) do nothing;

commit;
