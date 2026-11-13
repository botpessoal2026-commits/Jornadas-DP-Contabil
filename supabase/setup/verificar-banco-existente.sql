-- Leitura apenas: não cria usuários, não muda registros nem permissões.
begin read only;
do $verificacao_segura$
declare nome text;
begin
 foreach nome in array array['empresas', 'funcionarios', 'modelos_jornada', 'escalas', 'escala_dias', 'feriados', 'parametros_legais', 'log_alteracoes', 'estabelecimentos', 'datas_especiais', 'escala_versoes', 'registros_operacionais', 'nomes_login', 'login_tentativas'] loop
  if to_regclass('public.'||nome) is null then raise exception 'Tabela % ausente. Aplique somente as migrações pendentes do repositório.',nome; end if;
  if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||nome)) then raise exception 'RLS desativada na tabela %. Solicite revisão antes de usar o sistema.',nome; end if;
 end loop;
end $verificacao_segura$;
select tablename as tabela, rowsecurity as rls_habilitada
from pg_tables where schemaname='public' and tablename=any(array['empresas', 'funcionarios', 'modelos_jornada', 'escalas', 'escala_dias', 'feriados', 'parametros_legais', 'log_alteracoes', 'estabelecimentos', 'datas_especiais', 'escala_versoes', 'registros_operacionais', 'nomes_login', 'login_tentativas']) order by tablename;
commit;
