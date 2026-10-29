# Melhorias da revisão — entrega de 29/10/2026

Esta entrega dá continuidade à branch de feriados. Preserva modelos, cálculos, dados, isolamento e a folha A4, acrescentando produtividade, ergonomia, governança e operações. O quadro registra a situação real dos 65 itens da revisão; não apresenta módulos opcionais como concluídos.

## Recursos disponíveis

- Diretórios pesquisáveis, tabela/paginação, duração HH:MM e importação assistida CSV/XLSX insert-only.
- Grade com filtros e editor direto; geração/duplicação e edição multidiária em lote com prévia e confirmação.
- Calendário semanal/compacto, modais com ações fixas, tema escuro, desfazer/refazer e recuperação opcional isolada por conta/pessoa/competência, com expiração de sete dias.
- Eventos com busca, seleção filtrada e simulação de impacto; indicadores baseados nas datas efetivas.
- Relatórios identificados, compacto/completo, preview, ZIP de PDFs, CSV/XLSX consolidado e ICS; histórico legível.
- Rascunho/revisão/aprovação/publicação/fechamento, revisão concorrente, snapshots e reabertura justificada. Documentos publicados usam dados congelados.
- Ausências, cobertura, documentos, solicitações de troca atômica e registros realizados com conferência. Não cria marcações reais a partir da escala nem apura pagamento automaticamente.
- Fila de pendências por empresa, pessoa e competência.

## Persistência e implantação

A migration `20261028122734_schedule_governance_operations.sql` foi gerada pelo CLI e validada localmente em PostgreSQL embarcado. Acrescenta metadados de revisão/status, versões e registros operacionais; RPCs preservam escopo/owner/RLS e atomicidade. Importação insere novos vínculos sem sobrescrever CPF; troca grava os dois lados e a decisão em uma transação. As migrations anteriores continuam sendo pré-requisito.

Nenhuma migration foi aplicada ao serviço remoto nesta entrega, e a produção não foi publicada. Recursos novos de gravação real exigem atualizar/homologar o banco no ambiente apropriado. Se houver incompatibilidade, a aplicação apresenta pendência de atualização; não simula gravação remota.

A demonstração usa dados fictícios em memória. A recuperação local é opcional e guarda somente a prévia da escala (sem perfil/CPF/documentos), isolada por conta e expirada em sete dias. Pode ser desativada/descartada, e os dados locais da conta são limpos ao sair. Não é persistência do cadastro nem sincronização offline.

## Quadro dos 65 itens

**Implementado** significa disponível nesta entrega. **Parcial** descreve explicitamente a parte entregue e a parte futura. **Planejado** permanece no roadmap.

| Nº | Situação | Item da revisão | Limite / observação |
|---|---|---|---|
| 1 | Implementado | Corrigir o indicador de funcionários: contar ativos ou identificar o total de cadastros | Disponível; consulte os testes e os limites de implantação acima. |
| 2 | Implementado | Unificar feriados do painel com o calendário efetivo, incluindo datas especiais e recorrências | Disponível; consulte os testes e os limites de implantação acima. |
| 3 | Implementado | Substituir mensagens fixas sobre fontes/vigências pelo estado real da configuração, identificando exatamente o que falta conferir. | Disponível; consulte os testes e os limites de implantação acima. |
| 4 | Implementado | Ordenar “Últimas escalas” pela última alteração real e mostrar a data; a posição no array não garante recência. | Disponível; consulte os testes e os limites de implantação acima. |
| 5 | Implementado | Distinguir falha de gravação de falha de recarga após gravar | Disponível; consulte os testes e os limites de implantação acima. |
| 6 | Implementado | Confirmar descarte de formulário alterado ao usar Esc, Fechar ou clique fora | Disponível; consulte os testes e os limites de implantação acima. |
| 7 | Implementado | Nomear downloads com empresa, funcionário/matrícula, competência e tipo | Disponível; consulte os testes e os limites de implantação acima. |
| 8 | Implementado | Criar matriz atual de funcionalidades e separar notas históricas em changelog | Disponível; consulte os testes e os limites de implantação acima. |
| 9 | Implementado | Compactar identificação da empresa: nome, CNPJ e situação em faixa curta, detalhes expansíveis | Disponível; consulte os testes e os limites de implantação acima. |
| 10 | Parcial | Reduzir repetição entre lateral e abas internas | Cabeçalho e abas compactados; navegação global e local ainda coexistem. |
| 11 | Implementado | Barra contextual fixa com funcionário, competência, estado da prévia e Salvar | Disponível; consulte os testes e os limites de implantação acima. |
| 12 | Implementado | Com ocorrências, mostrar resumo de alertas, expansão controlada e “Próximo problema” | Disponível; consulte os testes e os limites de implantação acima. |
| 13 | Implementado | Agenda semanal/lista compacta no celular, salto para data e folgas em uma linha | Disponível; consulte os testes e os limites de implantação acima. |
| 14 | Implementado | Fixar título/Fechar e Salvar/Cancelar nos modais; rolar somente o corpo e acomodar teclado virtual. | Disponível; consulte os testes e os limites de implantação acima. |
| 15 | Parcial | Mostrar `+1 dia` junto ao horário, com opções avançadas quando necessárias | Editor visual preserva +1; os seletores explícitos do dia continuam disponíveis. |
| 16 | Implementado | Aceitar duração contratual em `08:24` ou `8h24`, com equivalência decimal opcional | Disponível; consulte os testes e os limites de implantação acima. |
| 17 | Implementado | Editor visual de modelos com entrada, intervalo, retorno e saída; texto de períodos como modo avançado | Disponível; consulte os testes e os limites de implantação acima. |
| 18 | Implementado | Parâmetros com rótulos e unidades amigáveis: “Plantão máximo: 12h”, “Descanso mínimo: 36h” | Disponível; consulte os testes e os limites de implantação acima. |
| 19 | Parcial | Simplificar dias especiais: nome, situação e horário quando houver trabalho | Densidade melhorada; simplificação completa de rótulos permanece pendente. |
| 20 | Implementado | Padronizar tipografia, espaçamento e densidade; aumentar legibilidade de etiquetas/exceções | Disponível; consulte os testes e os limites de implantação acima. |
| 21 | Parcial | Completar teclado do calendário: setas, seleção e abertura previsíveis, ou semântica de lista/botões compatível | Setas e foco disponíveis; refinamento completo da semântica de linhas da grade é futuro. |
| 22 | Implementado | Menu mobile com estado acessível aberto/fechado, retorno de foco e “Ir para conteúdo” | Disponível; consulte os testes e os limites de implantação acima. |
| 23 | Implementado | Ampliar áreas de toque e evitar toasts sobre Salvar/Cancelar | Disponível; consulte os testes e os limites de implantação acima. |
| 24 | Implementado | Filtros na grade existente: nome, setor, estabelecimento, regime, sem escala e com impedimento | Disponível; consulte os testes e os limites de implantação acima. |
| 25 | Implementado | Clicar uma célula abre funcionário e dia no editor, sem abrir a escala pelo nome e localizar a data novamente | Disponível; consulte os testes e os limites de implantação acima. |
| 26 | Implementado | Gerar prévias para pessoas/setor/unidade selecionados, com resumo de elegíveis, sem modelo, conflitos e pendências | Disponível; consulte os testes e os limites de implantação acima. |
| 27 | Implementado | Evoluir a duplicação existente para seleção de pessoas e competência escolhida, comparando antes de substituir e preservando exceções do destino. | Disponível; consulte os testes e os limites de implantação acima. |
| 28 | Implementado | Aplicar turno/descanso a vários dias/pessoas com simulação e confirmação | Disponível; consulte os testes e os limites de implantação acima. |
| 29 | Implementado | Desfazer/Refazer alterações da prévia com identificação da ação | Disponível; consulte os testes e os limites de implantação acima. |
| 30 | Implementado | Importar funcionários por Excel/CSV: arquivo-modelo, mapeamento, prévia, CPF/matrícula e duplicidades | Disponível; consulte os testes e os limites de implantação acima. |
| 31 | Implementado | Exportar folhas/escalas selecionadas em PDF único ou ZIP, por empresa/setor/competência, com resumo de sucessos e pendências. | Disponível; consulte os testes e os limites de implantação acima. |
| 32 | Implementado | Tabela ordenável/paginada para cadastros extensos, mantendo cards no celular | Disponível; consulte os testes e os limites de implantação acima. |
| 33 | Parcial | Seletores pesquisáveis de empresa, funcionário e modelo | Busca nos diretórios e lote; seletores nativos principais preservados. |
| 34 | Parcial | Manter filtros e visualizações preferidas por contexto, com “Limpar filtros” | Tema e recuperação têm preferência; persistência geral de filtros não foi incluída. |
| 35 | Implementado | Mês/semana anterior e seguinte, Hoje e competência rápida, preservando empresa/funcionário | Disponível; consulte os testes e os limites de implantação acima. |
| 36 | Implementado | Evoluir próximos passos existentes para assistente: cadastro, equipe, modelos, parâmetros, feriados e primeira escala, com links diretos. | Disponível; consulte os testes e os limites de implantação acima. |
| 37 | Implementado | Fila de trabalho do escritório: sem escala, contrato a revisar, impedimentos e fontes pendentes | Disponível; consulte os testes e os limites de implantação acima. |
| 38 | Implementado | Simular impacto ao salvar/excluir evento: pessoas/dias, horas antes/depois, exceções mantidas e plantões noturnos | Disponível; consulte os testes e os limites de implantação acima. |
| 39 | Implementado | Busca/setor/estabelecimento e “Selecionar resultados” nos funcionários abrangidos, com contador e resumo | Disponível; consulte os testes e os limites de implantação acima. |
| 40 | Implementado | Filtros de evento por nome, categoria, estabelecimento e abrangência, além de período/situação. | Disponível; consulte os testes e os limites de implantação acima. |
| 41 | Parcial | “Por que este dia ficou assim?” explica modelo, empresa, estabelecimento, seleção individual e exceção | Origem e exceções disponíveis; painel explicativo dedicado ainda não existe. |
| 42 | Parcial | Fontes/revisão de feriados oficiais e móveis por localidade/ano, origem e data de consulta | Importação e fontes manuais mantidas; atualização automática de calendário oficial não foi criada. |
| 43 | Implementado | Estados persistidos rascunho, revisão, aprovado, publicado e fechado, com responsável/data e reabertura justificada | Disponível; consulte os testes e os limites de implantação acima. |
| 44 | Implementado | Congelar versão publicada de horários, identificação, eventos e parâmetros | Disponível; consulte os testes e os limites de implantação acima. |
| 45 | Implementado | Detectar edição simultânea com revisão esperada no salvamento | Disponível; consulte os testes e os limites de implantação acima. |
| 46 | Implementado | Recuperar rascunhos após fechamento abrupto, separados da escala salva e identificados por conta/empresa/pessoa/competência, com expiração e proteção dos dados. | Disponível; consulte os testes e os limites de implantação acima. |
| 47 | Planejado | Equipe do escritório com convites/papéis por empresa: administrar, editar, revisar, consultar | Equipes, convites e papéis compartilhados exigem evolução da autorização; proprietário atual preservado. |
| 48 | Implementado | Histórico em linguagem humana: “Dia 05: folga → trabalho, 08:00–17:00”, com filtros e nomes de responsáveis | Disponível; consulte os testes e os limites de implantação acima. |
| 49 | Implementado | Pré-visualizar relatório com pessoa, competência, prévia/salva e páginas | Disponível; consulte os testes e os limites de implantação acima. |
| 50 | Implementado | “Escala para compartilhar” compacta e “Conferência completa” | Disponível; consulte os testes e os limites de implantação acima. |
| 51 | Parcial | Comparar competências e alterações após publicação: carga programada, feriados trabalhados, distribuição de plantões e pendências | Comparação planejado × realizado disponível; comparação entre competências/alterações publicadas ainda futura. |
| 52 | Planejado | Conectores contábeis com formatos oficiais e validação de ida/retorno | Exportações genéricas e texto Domínio preservados; nenhum conector oficial foi anunciado ou inventado. |
| 53 | Parcial | Documentos e vencimentos de instrumentos/parâmetros: referência, vigência, conferente e anexo com acesso controlado | Registro de referências/URLs e vigência disponível; upload de anexo privado não foi criado. |
| 54 | Parcial | Buscar escalas por competência/paginar cadastros, preservando meses vizinhos necessários a descanso, noturno, ciclos e semanas parciais | Paginação de API e janela opcional com meses vizinhos; tela mantém carga completa para não falsear indicadores. |
| 55 | Parcial | Indicadores agregados independentes das páginas carregadas | Totais completos preservados; agregações no servidor e medição de grande volume ainda pendentes. |
| 56 | Parcial | Homologar autenticação, isolamento, gravação e recarga em teste com migrações correspondentes | PGlite, transportes simulados e navegador local verificados; homologação remota depende do ambiente de teste. |
| 57 | Implementado | Distinguir erros de rede, sessão, gravação e configuração; nova tentativa segura e identificador de suporte sem expor SQL/dados pessoais | Disponível; consulte os testes e os limites de implantação acima. |
| 58 | Planejado | Exportação administrativa completa por empresa e recuperação validada/auditada | Nenhuma restauração administrativa foi criada; relatórios não equivalem a backup. |
| 59 | Parcial | Férias, afastamentos e indisponibilidades com períodos, documentos, aprovação e efeito no planejamento | Ausências registradas e conflitos operacionais sinalizados; não há alteração silenciosa do calendário. |
| 60 | Parcial | Portal do funcionário: escala publicada, ciência e solicitações; comunicação/lembretes configuráveis e possível exportação para calendário | ICS disponível; portal do funcionário, convites e notificações não implementados. |
| 61 | Implementado | Troca de plantão aprovada, validando ambas as pessoas, inclusive 12×36, noturno e continuidade entre meses. | Disponível; consulte os testes e os limites de implantação acima. |
| 62 | Implementado | Cobertura mínima por horário/unidade/setor/função, com falta ou excesso de pessoas | Disponível; consulte os testes e os limites de implantação acima. |
| 63 | Parcial | Planejado × realizado e possível apuração/banco de horas com dados reais, justificativas e aprovação | Marcações informadas/importadas com conferência e comparação; banco de horas/folha salarial não implementados. |
| 64 | Parcial | Sugestões de turnos por disponibilidade/cobertura/equilíbrio, explicadas e revisadas | Sugestões revisáveis para troca; otimizador geral de cobertura não implementado. |
| 65 | Implementado | Tema escuro opcional após resolver produtividade | Disponível; consulte os testes e os limites de implantação acima. |

## Verificação

Os resultados finais de testes e o link do demonstrativo estão registrados no PR desta entrega. Testes locais não equivalem a homologação de Auth/persistência com contas reais. A folha A4 e os cenários de 12×36/noturno/virada de mês continuam cobertos; a geração de versão publicada é um fluxo do produto e não publica o site em produção.

Resultado: **256 testes unitários/SQL e 70 cenários de navegador aprovados**, contando a correção e reexecução de 18 cenários afetados após a suíte completa. Build, TypeScript, Prettier e diff-check aprovados. Capturas desktop/mobile e PDFs/ZIP reais foram revisados; não houve erro JavaScript nem transbordamento horizontal nas telas inspecionadas. A agenda compacta reduz a altura do calendário, mas o cenário com avisos/fontes pendentes ainda exige rolagem; existe atalho para o calendário. Não se afirma que ele fique sempre acima da dobra.
