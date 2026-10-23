begin;
-- Campo opcional: o legado continua sem CPF, sem preencher ou alterar vínculos.
alter table public.funcionarios
 add column cpf text,
 add constraint funcionarios_cpf_formato check (cpf is null or cpf ~ '^[0-9]{11}$');

comment on column public.funcionarios.cpf is
 'CPF opcional do funcionário, armazenado com 11 dígitos; a máscara pertence à apresentação.';
commit;
