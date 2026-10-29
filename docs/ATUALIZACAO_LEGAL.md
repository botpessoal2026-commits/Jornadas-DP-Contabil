# Referências legais — revisão de 29/10/2026

O texto integral da **EC nº 141, de 16/10/2026**, foi consultado em fonte oficial do Senado: [norma e publicação no DOU extra de 16/10/2026](https://legis.senado.leg.br/norma/44184944) e [texto integral Sigen](https://legis.senado.leg.br/norma/44184944/publicacao/44189027), ambos com resposta HTTP 200. O endereço primário do [Planalto](https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc141.htm) retornou HTTP 503 nesta consulta; não se declara que ele foi lido com sucesso nesta revisão.

| Referência | Data civil usada | Tratamento |
| --- | --- | --- |
| EC, art. 6º, I | 16/12/2026 | Teto geral de 42h semanais, dois meses após a publicação. |
| EC, art. 6º, II | 16/12/2027 | Teto geral de 40h, um ano após a primeira fase. |
| EC, arts. 1º e 10, I | 16/12/2026 | Dois repousos semanais; um preferencialmente no domingo. |
| CF, art. 7º, § 2º, incluído pela EC | Conforme vigência | Compensação dos repousos na média do mês exige CCT/ACT, com ao menos um repouso em cada semana; o acordo individual do 12×36 não comprova essa exceção. |
| EC, art. 7º | Transição até 16/12/2027 | Ampliação diária para distribuir 42h exige CCT/ACT aplicável; opção marcada no cadastro não substitui a prova. |
| EC, arts. 2º e 4º | Conforme o dispositivo | Irredutibilidade salarial e ausência de redução proporcional automática de contratos de até 40h. A ferramenta não calcula salários. |

Os arts. 8º e 9º incluem hipóteses específicas de enquadramento e transição de contratos públicos. Não se inferem salário, escolaridade, aditamento ou dispensa de controle a partir dos dados atuais, e nenhuma exceção é aplicada automaticamente.

A [CLT consolidada na Câmara dos Deputados](https://www2.camara.leg.br/legin/fed/declei/1940-1949/decreto-lei-5452-1-maio-1943-415500-normaatualizada-pe.html) foi consultada com resposta HTTP 200, nos arts. 58, 59, 59-A, 66, 67, 71 e 73. O Planalto também retornou HTTP 503 para a CLT. Foram conferidas as referências de 8h normais; compensação e teto de 10h nas condições do art. 59; compensação no mesmo mês por acordo individual tácito/escrito (§ 6º); 12h de plantão e 36h consecutivas de descanso por acordo individual escrito/CCT/ACT; 11h interjornada; intervalos de 60/15 minutos conforme duração; janela noturna urbana de 22h–5h e hora reduzida de 52min30s. Horas de relógio, cômputo noturno e remuneração permanecem conceitos distintos.

## Implementação e atualização dos cadastros

`src/lib/legal-reference.ts` concentra as fases e a versão da fonte. Os presets passam a sugerir as fases comuns e 12×36 nas datas oficiais, sempre com `confirmado=false` e sem fundamento comprovado. A demonstração usa essas datas, sem representar as referências como aprovadas. A identificação estruturada e a aplicação por empresa continuam preservadas.

O comando explícito **Importar referências** acrescenta somente chaves/tipos/vigências ausentes. Não corrige datas, valores, contratos, salário, modelos ou conferências já cadastrados, nem sobrescreve parâmetros particulares. Registros antigos com datas ilustrativas continuam exigindo revisão do responsável; novas referências não equivalem a aprovação jurídica. Nenhuma migration ou escrita no banco remoto foi executada para esta atualização.

Semanas de transição são sinalizadas para conferência: o motor não aplica retroativamente o teto novo à semana inteira. Ultrapassar ambos os tetos caracteriza excesso; situações entre os tetos exigem revisão e justificativa do tratamento, sem certificar uma proporcionalização jurídica. Instrumentos, escopo, exceções e a adequação concreta ao vínculo continuam sujeitos à conferência.
