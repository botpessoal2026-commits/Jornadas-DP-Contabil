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
