begin;

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

commit;
