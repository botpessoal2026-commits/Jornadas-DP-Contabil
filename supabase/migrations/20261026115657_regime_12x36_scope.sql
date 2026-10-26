begin;

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
commit;
