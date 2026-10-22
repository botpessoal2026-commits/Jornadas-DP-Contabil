begin;
-- Aditiva: preserva observações e exige revisão explícita dos cadastros antigos.
-- Nenhum backfill por regex: '30h + extras', turnos e CCT podem ser ambíguos.
alter table public.funcionarios
  add column carga_semanal_minutos integer
    check (carga_semanal_minutos between 1 and 10080);
comment on column public.funcionarios.carga_semanal_minutos is
  'Carga semanal do contrato em minutos. NULL exige revisão; não inferir do teto legal nem das observações. Não constitui aprovação jurídica.';
-- RLS e auditoria existentes também protegem a nova coluna.
commit;
