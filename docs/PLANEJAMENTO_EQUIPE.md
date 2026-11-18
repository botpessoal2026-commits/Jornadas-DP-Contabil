# Funcionamento e planejamento da equipe

## Horário de funcionamento

Em **Empresa → Configurações → Editar configurações**, ative **Cadastrar horário de funcionamento**. Para cada dia da semana, escolha fechado, 24 horas ou informe abertura e fechamento. A opção de pausa permite dois períodos. Marque o fechamento no dia seguinte quando houver virada de meia-noite. Defina a cobertura mínima da empresa inteira e a política operacional de funcionamento em feriados.

A configuração é opcional. Cadastros existentes sem esse campo continuam funcionando e não recebem horários presumidos. Salvar o funcionamento não reescreve modelos, contratos, parâmetros legais, descansos contratuais ou escalas. As permissões de CCT continuam sujeitas à conferência existente.

## Conferência de cobertura

A seção **Cobertura do horário de funcionamento** está na Grade da equipe e nas prévias de lote/revezamento. Ela compara intervalos reais de programação com as faixas de funcionamento, considerando pausas, folgas, feriados, fechamentos/reduções cadastrados e continuação de turnos noturnos. Cada funcionário conta uma vez por período, mesmo com intervalos sobrepostos.

As prévias substituem somente as pessoas/competências selecionadas; escalas salvas dos demais funcionários continuam contando na cobertura. Registros ausentes e horários inválidos deixam a conferência incompleta. Projeções noturnas do mês anterior não são tratadas como dias salvos. Publicações usam os dias de sua versão preservada. O funcionamento comparado é o atualmente cadastrado para a empresa.

As ocorrências são operacionais: mostram períodos abaixo da meta e trabalho fora do funcionamento. Elas não alteram a validação trabalhista nem conferem aprovação jurídica. Uma pausa da empresa fecha o expediente; uma pausa do funcionário durante expediente aberto pode exigir cobertura por outra pessoa.

## Banco existente

A migration `supabase/migrations/202611180002_company_business_hours.sql` acrescenta o campo JSONB opcional `empresas.horario_funcionamento`, valida sua estrutura no banco e permite sua edição pelo RPC contextual existente. Mantém RLS, propriedade, auditoria e os campos anteriores. Não atualiza registros ou parâmetros existentes ao ser instalada. A execução é idempotente.

Validação desta etapa: lint, TypeScript, build, **365 testes unitários/SQL** e **14 cenários de navegador** (novos e regressão de empresas) aprovados. Nenhuma migration foi aplicada no serviço remoto.

## Gerar a equipe de uma só vez

1. Em **Escalas de trabalho**, escolha uma **empresa ativa** e clique em **Gerar escalas da equipe**. O botão abre e posiciona o gerador em lote.
2. Defina a competência de destino. Use **Gerar todos os funcionários ativos** para preparar a empresa inteira, inclusive quem estiver fora dos filtros de pesquisa. O limite é 200 pessoas por lote. Vínculos inativos e funcionários de outras empresas não entram.
3. Para uma parte da equipe, filtre por nome/setor/unidade, selecione os resultados desejados e use **Gerar prévias do lote**.
4. Confira os totais, ocorrências e a seção **Cobertura do horário de funcionamento**. Uma escala bloqueada impede a substituição do lote; faça a reabertura justificada no fluxo existente antes de gerar novamente.
5. Marque a conferência e clique em **Salvar lote sem aprovar**. O salvamento é uma operação para a seleção inteira, mantendo a revisão concorrente e a auditoria. Não aprova nem publica automaticamente.

Sem reorganização automática, cada funcionário mantém seu modelo individual, o padrão da empresa ou o vínculo legado já disponível. Modelos individuais A/B continuam sua alternância nos próximos meses. A duplicação preserva os modelos de origem, recalculando o calendário conforme o fluxo existente.

## Distribuição automática de folgas 12×36

Na mesma área, marque **Distribuir automaticamente os selecionados em 12×36 nos grupos A e B** e informe a referência do grupo A. Depois use o mesmo botão de geração da equipe. São necessários pelo menos dois participantes em 12×36; os demais regimes mantêm seus modelos.

A distribuição alterna pessoas com horários compatíveis, setores e unidades, equilibrando também o total dos grupos. Assim evita concentrar todos os trabalhadores de um turno na mesma fase quando há pares. Um posto com apenas uma pessoa ou uma equipe insuficiente ainda pode ter lacunas. A prévia mostra esses períodos; a rotina não estende jornadas nem inventa pessoas para fechar a cobertura.

Ao confirmar o lote, modelos A/B, vínculos individuais, escalas em 12×36 e escalas dos outros regimes são salvos na mesma transação. Qualquer falha reverte tudo. Edições em lote, desfazer/refazer e exceções individuais continuam refletidas nos dias efetivamente enviados ao banco. Os modelos originais e as demais competências são preservados.

## Ativação em uma consulta no banco existente

O arquivo **`supabase/setup/ativar-planejamento-equipe.sql`** reúne somente as migrations operacionais de revezamento, funcionamento e planejamento da equipe. No projeto Supabase existente, abra **SQL Editor → New query**, cole o arquivo inteiro e execute.

O script confere as tabelas anteriores e RLS antes de instalar. Usa uma transação, acrescenta apenas o campo opcional de funcionamento e cria/atualiza os RPCs necessários. Não cria empresas, funcionários ou escalas, não reescreve parâmetros legais e pode ser reaplicado sem duplicar registros. As migrations individuais continuam versionadas em `supabase/migrations/`.

Para verificar a ativação, execute esta consulta de leitura:

```sql
select
  exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='empresas'
      and column_name='horario_funcionamento') as funcionamento_ativado,
  to_regprocedure('public.salvar_revezamento_12x36(uuid,date,date,jsonb,jsonb,jsonb)')
    is not null as revezamento_ativado,
  to_regprocedure('public.salvar_planejamento_equipe(uuid,jsonb,jsonb)')
    is not null as planejamento_ativado;
```

Os três resultados devem ser `true`. O script `instalacao-novo-projeto.sql` continua exclusivo para projetos vazios. Cadastros sem funcionamento e lotes sem reorganização automática conservam o fluxo anterior. Se faltar uma função nova, a interface mostra a pendência em português, preservando a prévia e sem iniciar gravações parciais.

Nenhum banco remoto nem deployment de produção foi alterado nesta entrega. Os testes de persistência no navegador usam o SDK real com transporte simulado; SQL, RLS e rollback são executados em PostgreSQL embarcado. A homologação no serviço remoto depende da aplicação do SQL pelo responsável.

Uma nova Preview usa o mesmo Supabase e as mesmas contas. Para confirmação de cadastro ou recuperação de senha nessa Preview, acrescente sua URL terminada em `/login` nos redirecionamentos permitidos do Supabase, mantendo as URLs e a Site URL existentes.

## Validação final

- **375/375 testes unitários/SQL** e **116/116 cenários de navegador** aprovados em execuções completas.
- Lint, TypeScript, formatação, build Next.js/Node 24 e `git diff --check`: aprovados.
- Casos novos incluem persistência do funcionamento, isolamento de empresas, dias fechados/24h/virada de dia, cobertura por período e por funcionário distinto, pausas, feriados, recesso, registros ausentes e versões publicadas.
- A geração completa foi testada com regimes mistos, grupos equilibrados por turno, continuidade mensal, edição e desfazer/refazer, uma requisição de salvamento e rollback de toda a equipe quando uma escala falha.
- Migration ausente mantém a prévia. Gravação confirmada com falha na recarga bloqueia repetição. Aprovações, modelos originais, contratos, parâmetros e fontes legais foram preservados.

## Arquivos desta entrega

- `README.md`
- `docs/PLANEJAMENTO_EQUIPE.md`
- `e2e/business-hours.spec.ts`
- `e2e/support/persistence-backend.ts`
- `e2e/support/planning-fixture.ts`
- `e2e/team-generation.spec.ts`
- `scripts/gerar-sql-instalacao.mjs`
- `src/app/globals.css`
- `src/components/bulk-schedules.tsx`
- `src/components/business-hours-fields.tsx`
- `src/components/company-admin.tsx`
- `src/components/company-coverage.tsx`
- `src/components/company-fields.tsx`
- `src/components/rest-rotation.tsx`
- `src/components/team-schedule.tsx`
- `src/components/workspace.tsx`
- `src/lib/business-hours.ts`
- `src/lib/company-coverage.ts`
- `src/lib/schedule-write.ts`
- `src/lib/store.ts`
- `src/lib/team-planning.ts`
- `src/lib/types.ts`
- `supabase/migrations/202611180002_company_business_hours.sql`
- `supabase/migrations/202611180003_team_planning.sql`
- `supabase/setup/ativar-planejamento-equipe.sql`
- `supabase/setup/instalacao-novo-projeto.sql`
- `tests/business-hours-database.test.ts`
- `tests/business-hours.test.ts`
- `tests/fixtures/team-data.ts`
- `tests/team-planning-database.test.ts`
- `tests/team-planning.test.ts`
