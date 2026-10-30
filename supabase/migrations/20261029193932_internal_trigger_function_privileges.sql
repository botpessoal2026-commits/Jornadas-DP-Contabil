begin;

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

commit;
