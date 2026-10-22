begin;
create extension if not exists pgcrypto;
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
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('revoke all on public.%I from anon',t);
 end loop;
end $$;
alter table public.log_alteracoes enable row level security;
create policy leitura_dono on public.log_alteracoes for select to authenticated using((select auth.uid())=user_id);
grant select on public.log_alteracoes to authenticated;
revoke insert,update,delete on public.log_alteracoes from anon,authenticated;
-- Registra nomes dos campos, sem duplicar dados pessoais no log.
create or replace function public.auditar_alteracao() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb; begin
 row_data:=case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
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
commit;
