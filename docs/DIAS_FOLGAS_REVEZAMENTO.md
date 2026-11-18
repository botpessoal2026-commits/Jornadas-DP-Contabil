# Dias trabalhados e folgas

Em **Escalas de trabalho → Grade da equipe**, abra **Relatório de dias trabalhados e folgas**. A seleção respeita a empresa e os filtros da grade; o período é sempre a competência inteira. O mesmo relatório está disponível em **Relatórios** e permite escolher uma pessoa ou toda a seleção (até 200 funcionários).

Clique em **Gerar relatório de dias e folgas**. Cada funcionário apresenta os dias com trabalho, folgas programadas, outros dias sem expediente, datas sem escala, horários inválidos, inícios de plantão, datas e horas de relógio. O detalhamento mantém horários, eventos, empresa, competência, situação e revisão. Não inclui CPF nem cria marcações de ponto.

**PDF de dias e folgas** apresenta os dias e totais. **Excel de dias e folgas** contém resumo e detalhamento diário. **CSV de dias e folgas** exporta o resumo com as listas de datas. Os arquivos usam o resultado exibido, que é invalidado quando o contexto muda. Escalas publicadas usam sua versão preservada, não cadastros atuais.

Um dia ausente é **Sem escala**, nunca folga. Feriados, recessos e outros dias sem expediente continuam identificados. Em turnos noturnos, os dias com trabalho seguem a data civil, como na grade; os inícios de plantão são contados separadamente. O relatório é de planejamento, não prova frequência nem certifica enquadramento legal.

Validação do relatório: lint, TypeScript, build, 345 testes unitários/SQL e quatro cenários de navegador aprovados (relatório e regressão de contexto de exportação).

## Revezamento 12×36

1. Abra uma **empresa ativa** e a competência em **Escalas de trabalho**.
2. Abra **Revezar folgas 12×36 — grupos A e B**. Cada participante deve ter vínculo ativo e um modelo 12×36 salvo e disponível para a empresa, individual ou padrão.
3. Selecione os funcionários e informe **Primeiro plantão do grupo A**. A referência pode ser anterior ao mês; o ciclo não reinicia no dia 1.
4. Clique em **Distribuir grupos A e B** ou escolha o grupo de cada pessoa. Os dois grupos precisam ter participantes. O grupo B inicia no dia seguinte ao A, preservando os horários e intervalos próprios de cada modelo.
5. Clique em **Gerar prévia do revezamento**. Abra **Ver quem trabalha e quem folga em cada dia**. Essa cobertura conta os inícios dos plantões; trabalho noturno continua no dia seguinte. Feriados e exceções podem deixar um dia sem início de plantão. Confira também horários, funções e os alertas contratuais/legais.
6. Marque a conferência e clique em **Salvar revezamento sem aprovar**. O sistema cria/reutiliza cópias dos modelos dos grupos, define esses modelos como individuais e salva somente as escalas selecionadas na competência. O modelo original e os demais meses permanecem preservados. As próximas gerações e duplicações usam os modelos individuais, mantendo a alternância entre meses.

O revezamento organiza dias de trabalho; não define cobertura mínima por função, não altera os descansos contratuais, não confirma CCT e não elimina alertas. Aprovação/publicação continuam no fluxo existente. Escalas aprovadas, publicadas ou fechadas exigem reabertura justificada antes de substituir o planejamento. Exceções individuais da competência são preservadas e reconferidas.

## Ativação no Supabase existente

Execute somente a migration incremental **`supabase/migrations/202611180001_rest_rotation.sql`**, após as migrations anteriores. Ela cria o RPC `salvar_revezamento_12x36`, com `security invoker`, autenticação e empresa explícita. Não modifica tabelas, RLS, parâmetros legais ou registros existentes ao ser instalada. Quando o usuário confirma o salvamento, a transação grava modelos, vínculos e escalas juntos, usando as políticas, triggers de auditoria e proteção de revisões existentes. Qualquer erro reverte o lote inteiro.

O relatório não precisa dessa nova migration. Sem o RPC, o revezamento pode ser pré-visualizado, mas o salvamento apresenta uma mensagem em português e preserva a prévia. Não há fallback para uma sequência de gravações parciais.

Verifique a instalação com esta consulta de leitura:

```sql
select to_regprocedure(
  'public.salvar_revezamento_12x36(uuid,date,date,jsonb,jsonb,jsonb)'
) is not null as revezamento_ativado;
```

O resultado esperado é `true`. O arquivo `supabase/setup/instalacao-novo-projeto.sql` atualizado reúne a nova migration para instalações vazias; não deve ser usado para atualizar o banco existente.

Para confirmação de cadastro ou recuperação de senha em uma nova Preview, adicione sua URL terminada em `/login` em **Authentication → URL Configuration → Redirect URLs**. Preserve as URLs existentes e a Site URL do site em uso. Para entrar com uma conta existente, use o mesmo e-mail/senha e o mesmo projeto Supabase.

## Limites da entrega

Nenhuma migration foi aplicada no serviço remoto nesta etapa; os dados e o deploy de produção foram preservados. Os testes de SQL usam PostgreSQL embarcado com papéis e RLS reais de teste. Os cenários de navegador usam o SDK real com transporte persistente simulado; não equivalem a criar grupos na conta real do usuário.

## Validação final

- Lint, TypeScript, formatação, build Next.js/Node 24 e `git diff --check`: aprovados.
- **354/354 testes unitários/SQL** e **107/107 cenários de navegador** aprovados em execuções completas.
- Casos novos: grupos em dias alternados, segunda-feira com um grupo em folga e outro trabalhando, continuidade janeiro/fevereiro e ano bissexto, preservação de horários/pausas/feriados/exceções, recarga e novo login, RLS, concorrência, rollback do lote e escalas bloqueadas.
- A migration pode ser reaplicada sem alterar registros. Ausência do RPC mantém a prévia e apresenta orientação. Gravação concluída com falha na recarga impede repetição e duplicação de modelos.
- CSV/Excel/PDF conferidos, PDF aberto para inspeção, relatório e revezamento revisados em 375px. Motor, regras, fontes, vigências e migrations históricas permanecem inalterados.

## Arquivos desta alteração

- `README.md`
- `docs/CONTAS_REAIS.md`
- `docs/DIAS_FOLGAS_REVEZAMENTO.md`
- `e2e/rest-rotation.spec.ts`
- `e2e/support/persistence-backend.ts`
- `e2e/work-rest-report.spec.ts`
- `src/app/globals.css`
- `src/components/rest-rotation.tsx`
- `src/components/team-schedule.tsx`
- `src/components/work-rest-report.tsx`
- `src/components/workspace.tsx`
- `src/lib/rest-rotation.ts`
- `src/lib/store.ts`
- `src/lib/work-rest-report.ts`
- `supabase/migrations/202611180001_rest_rotation.sql`
- `supabase/setup/instalacao-novo-projeto.sql`
- `tests/fixtures/rotation-data.ts`
- `tests/rest-rotation-database.test.ts`
- `tests/rest-rotation.test.ts`
- `tests/work-rest-report.test.ts`
