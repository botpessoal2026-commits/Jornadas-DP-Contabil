begin;

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

commit;
