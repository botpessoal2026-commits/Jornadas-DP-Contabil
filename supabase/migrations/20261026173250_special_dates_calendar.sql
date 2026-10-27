begin;

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

commit;
