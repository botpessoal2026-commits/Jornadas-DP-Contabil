# Dias trabalhados e folgas

Em **Escalas de trabalho → Grade da equipe**, abra **Relatório de dias trabalhados e folgas**. A seleção respeita a empresa e os filtros da grade; o período é sempre a competência inteira. O mesmo relatório está disponível em **Relatórios** e permite escolher uma pessoa ou toda a seleção (até 200 funcionários).

Clique em **Gerar relatório de dias e folgas**. Cada funcionário apresenta os dias com trabalho, folgas programadas, outros dias sem expediente, datas sem escala, horários inválidos, inícios de plantão, datas e horas de relógio. O detalhamento mantém horários, eventos, empresa, competência, situação e revisão. Não inclui CPF nem cria marcações de ponto.

**PDF de dias e folgas** apresenta os dias e totais. **Excel de dias e folgas** contém resumo e detalhamento diário. **CSV de dias e folgas** exporta o resumo com as listas de datas. Os arquivos usam o resultado exibido, que é invalidado quando o contexto muda. Escalas publicadas usam sua versão preservada, não cadastros atuais.

Um dia ausente é **Sem escala**, nunca folga. Feriados, recessos e outros dias sem expediente continuam identificados. Em turnos noturnos, os dias com trabalho seguem a data civil, como na grade; os inícios de plantão são contados separadamente. O relatório é de planejamento, não prova frequência nem certifica enquadramento legal.

Validação do relatório: lint, TypeScript, build, 345 testes unitários/SQL e quatro cenários de navegador aprovados (relatório e regressão de contexto de exportação).
