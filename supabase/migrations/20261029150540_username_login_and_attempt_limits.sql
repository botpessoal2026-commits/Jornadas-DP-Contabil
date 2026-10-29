begin;

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

commit;
