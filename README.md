# Gerador de Jornadas

Aplicação em português para o Departamento Pessoal organizar empresas, funcionários e escalas mensais. Next.js App Router, TypeScript, Tailwind e Supabase Auth/Postgres/RLS. Exporta PDF para conferência e assinatura, XLSX e CSV.

## Situação da entrega

- Código e migration versionados neste repositório.
- Demonstração usa dados fictícios em memória e nunca acessa dados reais.
- Sem variáveis do Supabase, login e gravação remota ficam indisponíveis; não existe fallback silencioso de dados reais para armazenamento local.
- Criação do projeto Supabase, aplicação da migration no serviço e publicação Vercel dependem do acesso às respectivas contas. Nenhum projeto pago é criado pelo código.
- Regras e instrumentos não são certificados automaticamente. As referências legais são editáveis, têm vigência e fonte, e novas referências entram somente por importação explícita sem substituir cadastros.

## Usuário, senha e persistência — 29/10/2026

O acesso principal passa a usar **Usuário e Senha**, preservando o Supabase Auth. Contas anteriores entram por e-mail uma vez e definem o usuário em **Meu acesso**, mantendo o mesmo UUID, senha e cadastros. O e-mail continua somente no cadastro/recuperação. Uma conta nova não é criada para renomear o acesso existente.

Os dados salvos da conta permanecem no Supabase. A demonstração (`?demo=1`) continua fictícia e reinicia ao recarregar; agora oferece **Usar minha conta com dados salvos**. Corrigido o tratamento de gravação concluída com falha na recarga para evitar repetição de INSERT. Campos ainda em prévia continuam exigindo o salvamento indicado na tela.

Login por usuário e persistência estão configurados na Preview da branch `codex/usuario-senha-persistencia`, no projeto Supabase confirmado. As migrações foram aplicadas preservando as contas existentes; a chave privada fica somente no servidor da Preview. Contas anteriores entram por e-mail e definem seu usuário em **Meu acesso**. Consulte [ACESSO_E_PERSISTENCIA.md](docs/ACESSO_E_PERSISTENCIA.md) para ativação, segurança, arquivos e testes. Validação: **325/325 testes unitários/SQL aprovados**, além dos **85/85 cenários de navegador** da implementação, verificação remota da tela e teste transacional no banco real. Nenhuma versão foi publicada em produção.

## Modernização — 29/10/2026

Esta etapa parte do commit `034a2b8`, preservando as melhorias anteriores. Corrige a comparação de limites em horas de relógio, separa horas noturnas computadas, confere repousos contínuos e semanas de transição sem aplicar um teto novo retroativamente. Regime comum e 12×36 continuam distintos; uma opção de cadastro não comprova compensação ou enquadramento excepcional.

As referências atuais incluem 42h e dois repousos em 16/12/2026 e 40h em 16/12/2027. A demonstração utiliza essas datas oficiais. Os parâmetros reais existentes continuam preservados e as novas referências permanecem pendentes de conferência. A [nota de fontes jurídicas](docs/ATUALIZACAO_LEGAL.md) registra o texto consultado no Senado e na Câmara, as datas e os limites de interpretação.

A conferência central usa **Bloqueante, Atenção e Informativo** na interface, relatórios e aprovação. Trabalho noturno isolado é informativo; fontes ou condições jurídicas pendentes continuam impedindo aprovação. Alertas de atenção exigem conferência e justificativa. O banco reforça proprietário, revisão, fluxo e atestação; não reexecuta o motor TypeScript nem certifica juridicamente a escala.

O simulador no cadastro de modelos distribui uma carga semanal exata em minutos inteiros, mostra comparação antes/depois e considera início, pausa, dias selecionados e turnos noturnos. Aplicar a proposta altera os campos do modelo, com salvamento explícito; gerar a escala mensal individual ou em lote continua submetido ao motor. A navegação por áreas pode ser recolhida no desktop e mantém acesso por teclado no celular. Tema e identidade visual existentes foram preservados.

A logomarca pode ser configurada no build pelas variáveis opcionais de `.env.example`, usando arquivos fornecidos em `public/brand` (SVG, PNG ou WebP). Os SVGs existentes são o padrão; não há upload remoto ou logomarca separada por empresa nesta etapa.

A migration incremental `20261029123937_three_level_review_attestation.sql` foi preparada para o fluxo de atestação. Aplique a sequência de migrations e homologue em ambiente de teste antes de utilizar as novas aprovações com contas reais. Nenhum banco remoto ou deployment foi alterado nesta modernização.

Validação desta modernização: **297 testes unitários/SQL aprovados e 78 cenários de navegador validados**, com 14 cenários afetados aprovados na reexecução final após atualizar seletores/expectativas. Build, TypeScript, Prettier e diff-check aprovados. Auditoria de dependências de produção: zero vulnerabilidades reportadas. Desktop/mobile, temas e demonstração inspecionados sem erros JavaScript ou transbordamento horizontal.

Escopo, arquivos, execução detalhada e pendências: [docs/MODERNIZACAO.md](docs/MODERNIZACAO.md).


## Melhorias da revisão — 29/10/2026

Esta etapa acrescenta filtros e tabelas, duração contratual HH:MM, importação de funcionários, grade editável, operações em lote, calendário compacto/semanal, ações fixas e tema escuro. A central de relatórios oferece preview, PDF compacto/completo, ZIP, XLSX/CSV consolidados e ICS. A folha individual A4 permanece preservada.

Escalas têm revisão concorrente e fluxo de rascunho, revisão, aprovação, publicação e fechamento, com versões congeladas e reabertura justificada. O módulo operacional registra ausências, cobertura, documentos, solicitações de troca e marcações informadas/importadas; não inventa ponto real nem calcula pagamentos. A fila do escritório abre cada pendência no contexto correto.

A migration nova é `20261028122734_schedule_governance_operations.sql`, preparada e testada localmente, sem aplicação remota. A demonstração continua fictícia; a recuperação de prévias no navegador é opcional, isolada por conta/empresa/pessoa/mês e expira em sete dias. Não altera a persistência do cadastro.

O [quadro de execução dos 65 itens](docs/MELHORIAS_REVISAO.md) distingue implementado, parcial e planejado. Colaboração por convites, portal do funcionário, integração oficial com folha, backup/restauração e otimizador completo continuam no roadmap; não são anunciados como funcionalidades entregues.

Validação desta entrega: **256 testes unitários/de banco embarcado e 70 cenários de navegador aprovados**. A suíte completa teve 68 aprovações; os dois casos corrigidos e outros 16 cenários afetados passaram na reexecução focada. Build, TypeScript, Prettier e `git diff --check` passaram. Telas revisadas em desktop e 375px, com modo compacto, tema escuro, ações fixas e sem transbordamento horizontal. Auth e persistência no serviço remoto não foram homologados com contas reais.

As seções seguintes registram etapas anteriores. Números de testes e limitações ali descritos correspondem à data da respectiva etapa; o quadro acima e a validação do PR representam a situação atual.

## Validação do regime 12×36

O modelo é identificado pelo campo estruturado `tipo`, já existente, e a regra correspondente usa `chave: regime` com `valor.tipo_regime: 12x36`. Regras comuns legadas continuam comuns. Os dois tipos têm seleção por vigência e personalização por empresa independentes; configurar 12×36 não amplia o limite de funcionários com jornadas comuns. A migration `20261026115657_regime_12x36_scope.sql` modifica apenas os dois índices de unicidade dos parâmetros, permitindo ambos os regimes na mesma data. Não altera linhas existentes, vínculos ou políticas de acesso.

Em **Parâmetros legais → Regime de trabalho → 12×36**, configure duração máxima do plantão, descanso mínimo, intervalo usufruído ou indenizado, alternância, média de trabalho, repousos, fundamento e vigência. A referência inicial permanece sem confirmação e sem instrumento comprovado. Acordo individual escrito, CCT e ACT são aceitos como fundamentos; a comprovação específica da eventual compensação mensal de repousos é separada. Exemplos demonstrativos não comprovam instrumentos reais.

O plantão é medido do primeiro início ao último término, incluindo pausas; trabalho efetivo e hora noturna reduzida permanecem discriminados. Um plantão de 07h a 19h, com uma hora de intervalo, possui 12h de duração e 11h efetivas. O validador não compara esse plantão ao teto comum de 8h24. Continua detectando plantão acima de 12h, descanso inferior a 36h consecutivas, intervalos insuficientes, sobreposições e alternância irregular, inclusive de madrugada. Exigências contratuais explícitas do vínculo permanecem verificadas.

A média operacional considera janelas completas de 14 dias, equivalentes a sete ciclos de 48h; o pico de uma semana com quatro plantões não recebe automaticamente o limite semanal comum. Essa média é uma conferência de sobrecarga, não uma declaração de validade jurídica da compensação. Janelas com mudança de parâmetro ou de fase constitucional geram pendência de transição, sem aplicar retroativamente o teto novo. Contexto incompleto e comprovação ausente geram pendências próprias, distintas de excesso de jornada. A âncora mantém a alternância entre meses; registros efetivos de competências vizinhas prevalecem sobre projeções do modelo, sem substituir a prévia do mês atual. Alterações posteriores da âncora não invalidam automaticamente escalas históricas.

Fontes verificadas em 26/10/2026: [CLT, art. 59-A](https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm) e [EC nº 141/2026](https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc141.htm). A conferência específica observa 42h e dois repousos desde 16/12/2026, e 40h desde 16/12/2027, sem tratar o 12×36 como dispensa automática dos novos limites. Instrumento, enquadramento, exceções de aplicação e período de compensação continuam sujeitos à conferência do responsável. Os cenários demonstrativos antigos das jornadas comuns são mantidos como fixtures; regras e cadastros existentes não são atualizados automaticamente.

Verificação local: 129 testes unitários/de PostgreSQL embarcado e 41 cenários distintos de navegador aprovados, além de build, TypeScript, formatação e `git diff --check`. Dois fluxos foram revalidados sobre o último build com servidor novo. Os novos casos cobrem os dez cenários solicitados, sobreposições, intervalos indenizados, isolamento de regras, preservação de registros históricos e transições sem excesso retroativo. Telas revisadas no computador e em 375px. O navegador usa demonstração em memória; Auth e persistência no serviço remoto não foram revalidados. A migração foi aplicada somente em PGlite; o banco remoto e a produção não foram modificados.

Arquivos desta correção: `src/lib/engine.ts`, `work-regime.ts`, `schedule-context.ts`, `company-resources.ts`, `company-context.ts`, `team-schedule.ts`, `alerts.ts`, `presets.ts`; `src/components/workspace.tsx`, `legal-fields.tsx`, `model-fields.tsx`, `company-resources.tsx`; migration `20261026115657_regime_12x36_scope.sql`; testes `tests/regime-12x36.test.ts`, `regime-12x36-database.test.ts`, `legal-fields.test.ts`, `schedule-context.test.ts`, `e2e/regime-12x36.spec.ts` e `e2e/workflow.spec.ts`, além deste README. O renderizador da folha de ponto não foi alterado.

## Feriados e datas especiais por empresa

Em **Feriados → Feriados e datas especiais**, cadastre feriados nacionais, estaduais, municipais e específicos, pontos facultativos, recessos e dias sem expediente. O cadastro informa período, recorrência, funcionários abrangidos, estabelecimento opcional, decisão sobre o expediente, horários reduzidos, observações e situação ativa/inativa. A natureza da data é independente do trabalho: um feriado com horários é identificado como **Feriado trabalhado**, enquanto um ponto facultativo pode manter expediente normal. Não há efeitos automáticos sobre remuneração, férias, compensação, faltas ou banco de horas.

Os cadastros novos pertencem à empresa ativa. A aplicação respeita, nesta ordem: exceção explícita do funcionário; evento dirigido a funcionários selecionados; configuração do estabelecimento; configuração geral da empresa; programação original. Havendo decisões conflitantes na mesma prioridade, prevalece a mais restritiva, com desempate pela data inicial mais recente e identificador estável. Todas as naturezas coincidentes permanecem visíveis. Cada categoria conta a data uma só vez, e as horas são somadas uma vez por data civil.

**Configurações → Estabelecimentos** permite cadastrar unidades opcionais com município e UF. O funcionário pode continuar na localidade principal ou usar uma unidade da própria empresa. Um feriado municipal considera a localidade do vínculo e não a do escritório contábil. Unidades inativas continuam identificando vínculos existentes; novos vínculos exigem uma unidade ativa. As referências e os feriados anteriores continuam disponíveis na mesma página, preservando seus registros e a importação existente de datas fixas. Novas datas móveis permanecem manuais; a recorrência anual é bloqueada para datas móveis informadas ou reconhecidas pelo nome, como Carnaval e Sexta-feira Santa. Não foi acrescentada importação automática de fontes externas.

No **Editar dia da escala**, as sete classificações permitem criar e remover exceções individuais sem alterar os eventos da empresa. Abrir ou salvar sem editar preserva a intenção anterior. Horários, anotações e classificação individuais ficam separados da programação original e das observações corporativas. Regerar o mesmo mês preserva exceções explícitas; duplicar o mês não transporta recessos e datas especiais para outros dias da semana. Remover ou inativar um evento restaura a programação original onde não houver outra decisão aplicável, mantendo exceções individuais.

Recessos podem abranger uma data ou período e coexistem com feriados e folgas, sem se transformarem em férias. Expediente normal ou reduzido não cria trabalho em uma folga já programada. Nas novas gerações, os horários cadastrados no modelo são conservados separadamente da dispensa padrão de um feriado: um evento normal/reduzido pode utilizar esses horários, e sua exclusão restaura a dispensa. Escalas antigas sem essa programação original não recebem horários inferidos; é necessário regerar ou informar uma exceção explicitamente. Dias civis fechados interrompem à meia-noite a continuação de plantões, preservando a intenção original para restauração. Para manter trabalho após meia-noite em uma data fechada, registre a exceção individual também nessa data.

O calendário e a grade mantêm os alertas existentes, com bordas vermelha/âmbar independentes das cores de feriado, ponto facultativo, recesso e dia sem expediente. O resumo separa feriados trabalhados e suas horas programadas, em minutos de relógio por data civil. PDF, Excel e CSV incluem natureza, descrição, expediente e totalizadores sem alterar os cálculos de jornada/noturno. A folha de ponto mantém A4, CPF, horários no cabeçalho, nove colunas, marcações reais em branco, assinatura única centralizada, rodapé e paginação. Dias sem trabalho continuam riscados; feriados trabalhados mantêm campos disponíveis. Não há registro de frequência efetiva criado pela programação.

A migration `20261026173250_special_dates_calendar.sql` acrescenta `datas_especiais`, `estabelecimentos`, vínculo opcional do funcionário e metadados do dia com programação original/exceção/política de dispensa. RLS, FKs e RPCs com contexto explícito validam proprietário, empresa, unidade e funcionários, além de períodos, recorrência, horários e duplicidades. Eventos anuais usam identidade independente do ano de origem; grupos grandes não excedem o tamanho dos índices. A gravação da escala continua atômica. Os dados anteriores não são convertidos ou substituídos.

A persistência real usa o Supabase existente. A demonstração continua em memória e retorna aos dados fictícios iniciais ao recarregar. Os testes locais verificam migrations reais em PostgreSQL embarcado, inclusive fechamento/reabertura do banco, e o fluxo de recarga do navegador com transporte Supabase simulado. Auth e persistência no serviço remoto não são certificados por esses testes. O banco remoto e a produção não foram alterados; a sequência de migrations precisa ser aplicada antes de usar os novos campos com dados reais. Na etapa de datas especiais havia apenas tema claro. A revisão posterior acrescenta tema escuro opcional; ambos preservam a impressão para papel.

Validação desta etapa: **192 testes unitários/de PostgreSQL embarcado e 53 cenários de navegador aprovados**, além de build, TypeScript, formatação e `git diff --check`. Os cenários cobrem os 22 requisitos de verificação do pedido, incluindo legado, duas empresas, unidades municipais, exceções, recessos, pontos facultativos, feriados trabalhados, recorrência, virada de mês/ano, horários noturnos, exportações reais, recarga com transporte simulado e persistência após reabrir o banco. As telas foram revisadas no computador e em 375px, sem rolagem horizontal; o exemplo da folha conserva 31 dias e assinatura em uma página A4. Os limites de verificação remota e de tema disponíveis estão descritos acima.

Arquivos desta etapa: `src/app/globals.css`; componentes `special-dates.tsx`, `day-editor.tsx`, `employee-admin.tsx`, `employee-fields.tsx`, `team-schedule.tsx`, `workspace.tsx`; bibliotecas `special-dates.ts`, `company-context.ts`, `exports.ts`, `store.ts`, `team-schedule.ts`, `timesheet.ts`, `types.ts`; migration `20261026173250_special_dates_calendar.sql`; testes `tests/special-dates.test.ts`, `special-dates-database.test.ts`, `special-dates-exports.test.ts`, `special-dates-ui.test.ts`, `day-special-editor.test.ts` e `e2e/special-dates.spec.ts`, além deste README. O motor de cálculo e o renderizador `timesheet-pdf.ts` não foram substituídos.

## Executar

Node.js 24 LTS e npm. O lockfile fixa as versões efetivamente instaladas.

```sh
npm ci
cp .env.example .env.local
# Preencher as variáveis do projeto Supabase; login por usuário também requer a chave privada do servidor.
npm run dev
```

Para testar a interface sem Supabase, abra a aplicação e clique em **Explorar demonstração**. Cadastros desaparecem ao sair ou recarregar; a recuperação opcional de prévias locais é descrita acima. O cenário demonstrativo é dezembro de 2026; contas reais começam no mês atual de São Paulo.

Variáveis do frontend:

- `NEXT_PUBLIC_SUPABASE_URL`: URL HTTPS do projeto.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: chave publicável do Supabase. Em projetos antigos pode receber a chave `anon`, jamais `service_role` ou chave secreta.

As variáveis `NEXT_PUBLIC_` são públicas e incorporadas no build. Depois de alterá-las na Vercel, faça novo deploy. Não comite `.env.local` nem credenciais. O acesso por usuário requer também `SUPABASE_SECRET_KEY` (ou o legado `SUPABASE_SERVICE_ROLE_KEY`) somente no servidor, para resolução privada do usuário e limites de tentativas; nunca use `NEXT_PUBLIC_` nessa chave. O acesso das contas existentes por e-mail permanece disponível.

## Banco e autenticação

Aplique `supabase/migrations/202610220001_schema.sql` em um **projeto Supabase novo**, pelo SQL Editor ou pelo CLI oficialmente autenticado:

```sh
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

A migration usa transação. Se já aplicada, não execute novamente no SQL Editor: novas mudanças devem virar novas migrations. Pelo CLI, o histórico é gerenciado pelo próprio Supabase. O teste de banco local executa o SQL integral em PostgreSQL embarcado (PGlite), com os contratos `auth.users` e `auth.uid()` simulados, incluindo os grants padrão do Supabase.

No painel **Authentication**:

1. Ative e-mail/senha e confirmação de e-mail.
2. Configure **Site URL** com a URL final da Vercel.
3. Inclua a mesma URL raiz nas **Redirect URLs**, além das URLs de desenvolvimento necessárias.
4. Configure entrega de e-mails/SMTP apropriada ao uso de produção e os limites de envio do seu plano.

Cada usuário autenticado acessa somente suas próprias empresas e demais cadastros. As contas são isoladas; não existe compartilhamento de escritório/equipe nesta versão. FKs compostas com `user_id` impedem vínculos entre contas, inclusive por chamadas diretas à API. As oito tabelas têm RLS. `log_alteracoes` só admite leitura pela conta proprietária; triggers registram o contexto e os dados antes/depois da alteração. Usuários não têm privilégio de `TRUNCATE`. A RPC `salvar_escalas` mantém RLS e grava a escala e seus dias atomicamente, inclusive duplicação da empresa em lote.

Estrutura:

| Tabela              | Conteúdo                                                  |
| ------------------- | --------------------------------------------------------- |
| `empresas`          | CNPJ, localidade, CCT, permissões e limite diário         |
| `funcionarios`      | Nome, CPF opcional, cargo, contrato e descansos          |
| `modelos_jornada`   | Padrão semanal, turnos e âncora do ciclo 12x36            |
| `escalas`           | Empresa, funcionário, modelo e competência                |
| `escala_dias`       | Turnos, folga, feriado e observação por data              |
| `feriados`          | Data e abrangência nacional/estadual/municipal            |
| `parametros_legais` | Valores, grupo, vigência, fonte e conferência por usuário |
| `log_alteracoes`    | Tabela, registro, ação, campos e horário                  |

## Publicar na Vercel

1. Importe `botpessoal2026-commits/Jornadas-DP-Contabil` na conta Vercel autorizada e selecione Next.js; diretório raiz do projeto: raiz do repositório.
2. Cadastre as duas variáveis públicas do Supabase em Production e nos ambientes desejados.
3. Use Node 24, instalação `npm ci` e build `npm run build`.
4. Publique e configure a URL final no Supabase Auth.
5. Em duas contas reais, teste confirmação de e-mail, login, recuperação de senha, gravação de empresa/funcionário/escala e isolamento entre contas. Faça os downloads na URL publicada.

Não habilite plano pago ou upgrades sem avaliar o custo. Vercel Hobby pode não ser adequado a uso comercial por uma contabilidade: confira os termos atuais e o plano da organização antes de publicar. Supabase tem limites de armazenamento, e-mail e uso que devem ser conferidos na conta. A documentação não equivale a um deploy executado.

## Primeiro uso

1. Cadastre usuário, senha e e-mail para recuperação; confirme o acesso e entre com usuário/senha. Contas existentes podem entrar por e-mail e definir o usuário em Meu acesso.
2. Na área geral de **Parâmetros legais**, clique em **Importar referências** para incluir regras gerais e a biblioteca-base quando ainda não existirem. Confira fontes, valores e vigências; marque como conferido somente após revisão. Dentro de uma empresa, referências gerais são identificadas separadamente e a personalização cria um registro próprio.
3. Em **Empresas**, cadastre nome, CNPJ válido, cidade/UF e CCT. Configure limite diário, autorização de 6x1 e banco de horas conforme o instrumento aplicável. Para 8h24, o limite correspondente é **8,4 horas decimais**; essa configuração exige fundamento.
4. Em **Funcionários**, cadastre nome, cargo, contrato e descansos. O campo **CPF (opcional)** aceita 11 dígitos ou a máscara brasileira; deixe vazio quando não informado. Não use campos livres para esse dado.
5. Em **Feriados**, importe os fixos do ano e complete os feriados móveis e municipais. A importação não trata pontos facultativos como feriados.
6. Em **Empresas → Acessar empresa**, cadastre ou copie um modelo-base em **Jornadas e modelos** antes de vinculá-lo a funcionários. Em **Escalas**, selecione funcionário, modelo e mês e gere a prévia. A preferência de folga nos feriados vem das configurações daquela empresa e pode ser ajustada para a geração. Confira dias, semanas, divisores e alertas; ajuste clicando nos dias e salve.
7. Exporte PDF, Excel/CSV ou copie o texto do modelo para o Domínio.

Os descansos do cadastro do funcionário são contratuais. O modelo escolhido determina o calendário gerado; divergências precisam ser conferidas. Banco de horas é uma permissão cadastrada, não um módulo de saldo/compensação.

## Motor e critérios de cálculo — registro da primeira etapa

`src/lib/engine.ts` recebe os parâmetros do banco; não importa valores legais dos cadastros iniciais. `src/lib/presets.ts` contém apenas sugestões editáveis para primeiro cadastro e exemplos da demonstração. Grupos: regime, intervalo, interjornada, noturno e divisor. A regra de cada grupo com vigência mais recente, não posterior à data analisada, é usada. Regras não conferidas participam da simulação e sempre geram aviso com fonte; a aplicação não as certifica.

- **42h e divisor 210:** seg–sex, 08:00–12:00 e 13:00–17:24 somam 2520 minutos; o divisor usa o fator cadastrado. O total real do calendário e o divisor são apresentados separadamente.
- **Dezembro/2026:** somente a demonstração usa uma hipótese de corte entre 44h e 42h. Essas datas são fixtures de simulação, sem confirmação jurídica; a importação real não inclui essas fases.
- **40h:** 01/12/2027 é uma data estimada de cadastro, explicitamente não confirmada. O parâmetro `permite_limite_empresa=false` impede que o limite diário da empresa amplie o teto desta fase.
- **Transição semanal:** semana civil segunda–domingo; aplica-se preventivamente o menor teto da semana, com alerta que explica a política. Não se afirma que esta seja a regra jurídica de proporcionalização. Confira a CCT/ato oficial.
- **Limites diários:** considera tanto o trabalho por data civil quanto a jornada iniciada na data, evitando que atravessar meia-noite esconda uma jornada longa.
- **Turnos:** horários em ordem, separados por vírgula. Exemplo noturno com pausa: `22:00-02:00 +1, 03:00-05:00 +1`. As horas após meia-noite usam os parâmetros da nova data, inclusive na virada de mês.
- **Limites semanais:** incluem dias de meses vizinhos. Quando houver escala salva no mês vizinho, os dias daquele mês prevalecem; caso contrário, o modelo fornece uma projeção explicitamente sinalizada. Revise ambos os meses após ajustes. A conferência não deve ser tratada como definitiva enquanto os dias vizinhos forem projeções.
- **12x36:** preserva a data âncora entre meses, sem presumir dispensa de limites e intervalos. As exceções específicas precisam ser conferidas; o motor comum pode emitir alertas esperados para essa modalidade.
- **Noturno:** identifica janela configurada, calcula hora reduzida e informa percentual do adicional. Não calcula salário, valores monetários ou prorrogação noturna. Regras de outras categorias precisam ser configuradas.
- **Duplicação:** copia horários e ajustes dos modelos semanais pela ocorrência do dia da semana (primeira segunda-feira para primeira segunda-feira etc.). Um quinto dia da semana sem correspondente usa o modelo. Folgas de feriados de origem não são propagadas; os feriados do destino são recalculados. Ciclos 12x36 são regenerados pela âncora do modelo, sem copiar suas exceções manuais. Pede confirmação para substituir escalas existentes e grava todo o lote numa transação.
- **Domínio:** o texto representa o modelo, não as exceções manuais do calendário. Revise antes de colar.
- **PDF/XLSX:** incluem total, períodos com divisores e fontes/alertas. O PDF inclui campos de assinatura; exportar não significa aprovar juridicamente.

## Validação automatizada

```sh
npm run typecheck
npm test
npm run build
# Com Chromium do sistema ou navegador instalado pelo Playwright:
npm run test:e2e
npm audit --omit=dev
```

Os testes cobrem cálculo de 42h/divisor 210, corte editável em dezembro, limites, 6x1, descansos, intervalos, noturno, feriados por cidade, ciclos, transição de mês, migration/RLS, auditoria e atomicidade, abertura real do XLSX, estrutura do PDF, CSV e proteção contra fórmulas no CSV. Playwright cobre navegação, cadastros, calendário, edições, duplicação, downloads e layout móvel. Usa `/usr/bin/chromium` quando disponível; caso contrário, instale com `npx playwright install chromium`. `CHROMIUM_PATH` pode apontar para outro executável.

Esses testes não substituem a validação de Auth, SMTP, migrations e deploy nos serviços reais.

## Conferência trabalhista antes do uso

- Existência e teor do ato mencionado, publicação, vigência de 42h e data exata de 40h.
- Tratamento de semanas/meses de transição e divisor aplicável à categoria.
- Possibilidade de 6x1, compensação em cinco dias, 8h24 ou 10h e alcance das exceções diárias.
- Requisitos do 12x36 e escalas de turnos.
- Descansos, domingos, feriados e regras municipais/estaduais.
- Intervalos intra/interjornada e exceções válidas.
- Trabalho noturno urbano/rural, duração reduzida, adicional e prorrogação.
- Banco de horas, prazos e instrumentos de compensação.

A aplicação oferece planejamento e alertas, não parecer jurídico nem cálculo completo de folha.


## Entrega parcial P0: carga contratual estruturada

O cadastro do funcionário possui carga semanal explícita em horas decimais (30,5 = 30h30), persistida em `funcionarios.carga_semanal_minutos`. O texto contratual continua preservado. Cadastros antigos permanecem com carga nula até revisão; não há backfill automático. A faixa técnica de 1 a 10080 minutos não representa autorização legal de jornada.

A conferência compara a semana completa, incluindo dias adjacentes e horas noturnas reduzidas parametrizadas, com o contrato do funcionário. Excesso gera erro com pessoa, semana, total e orientação de revisão. Ausência de carga gera aviso. PDF e XLSX recebem os mesmos alertas contratuais; CSV e XLSX incluem a carga estruturada. O contrato atual é usado na conferência: ainda não existe histórico de vigência contratual ou snapshot por revisão.

Antes de executar a aplicação atualizada contra um ambiente Supabase de teste, aplique também `supabase/migrations/20261022172216_structured_contract.sql` nesse ambiente, após a migration original. Em instalações existentes, aplique somente a nova migration pendente, preservando o histórico. Ela adiciona uma coluna nullable com CHECK e reutiliza RLS e auditoria existentes. A migration não foi aplicada a banco remoto nesta entrega. A interface nova depende dessa coluna para salvar funcionários.

Validação local: 31 testes unitários/de banco PGlite, 4 testes Playwright (incluindo 375px e 390px), typecheck, verificação de formatação e build. Não há script de lint configurado. O teste de banco cria um cadastro legado antes da nova migration, verifica preservação, gravação/leitura, restrições e isolamento de duas contas. Playwright usa demonstração em memória, sem simular persistência remota.

Pendente: fluxo rascunho → conferência → aprovação → publicação com validação no servidor, papéis de aprovador, revisão imutável de publicadas, escopo jurídico por categoria/CCT e atualização legal oficialmente confirmada; depois dashboard, calendários Dia/Semana, lote e modelos avançados. O editor de campos separados foi concluído na atualização abaixo. Esta entrega não implementa aprovação e não declara conformidade legal.

## Atualização P0: alertas acionáveis, calendário e editor

A conferência agora separa violações, atenção e fontes/regras pendentes. Os contadores mostram **grupos distintos** e **ocorrências** separadamente; pendências de parametrização não inflam o contador de violações. Ocorrências idênticas são agrupadas sem esconder datas, períodos, limites ou fontes diferentes. Os IDs são determinísticos por contexto de empresa/funcionário/regra, sem alterar o formato persistido das escalas. Fontes ficam recolhidas inicialmente e abrem os parâmetros; revisão contratual abre o cadastro; alertas de dia/período abrem o dia correspondente.

Células e semanas conflitantes têm borda, fundo, ícone e texto. A seleção acompanha o alerta acionado. No celular, a competência aparece em cartões de dias com horários completos. Os seletores identificam modelos 6×1 não autorizados pela configuração da empresa antes da geração; a cópia de uma escala irregular existente continua permitida como prévia com alertas.

O editor usa Entrada, Início do intervalo, Retorno e Saída, com indicação explícita da data de cada horário (dia inicial ou seguinte). Há edição avançada para preservar jornadas com mais de dois períodos. Formato inválido e horários sobrepostos preservam a entrada, mostram erro inline acessível e bloqueiam o envio do formulário. Horários estruturalmente válidos, mesmo com alertas legais, podem ser salvos na prévia e depois pela gravação existente. O impacto semanal e novos conflitos no dia seguinte aparecem antes de aplicar a edição.

O modal mantém foco durante a digitação, limita Tab/Shift+Tab aos controles visíveis e devolve o foco ao fechar. A navegação indica `aria-current`. Foram testados contraste mínimo 4,5:1 nos novos textos de alertas/células, foco visível e telas de 375/390px; isso não representa auditoria WCAG de toda a aplicação. O salvamento diferencia alterações locais, salvando, salvo e falha, preserva a prévia em caso de erro e evita solicitações simultâneas. A demonstração informa que o salvamento é apenas na sessão.

Validação desta atualização: **50 testes unitários/de banco local e 10 testes Playwright aprovados** (a suíte de nove testes e o novo teste de contraste foram executados separadamente). Typecheck, formatação, build e `git diff --check` aprovados; não há lint configurado. Testes de navegador usam a demonstração; Supabase Auth e persistência remota continuam sem verificação com contas de teste. Nenhuma migration nova foi necessária nesta atualização; a migration contratual da primeira entrega continua necessária antes de usar o cadastro atualizado no Supabase.

As duas variantes da URL oficial da EC141 expiraram novamente sem conteúdo documental. Nenhuma data foi promovida a parâmetro legal confirmado. Permanecem pendentes o fluxo persistido de aprovação/publicação com validação e permissões no servidor, versionamento de publicadas, modelo padrão/vigência contratual, regras por categoria/CCT e os demais itens P1. O editor mantém somente os tipos trabalho/folga suportados no schema atual. Os alertas não constituem aprovação jurídica, e os IDs de contexto não substituem o histórico de decisões a implementar.

## Administração multiempresa — primeira etapa funcional

A branch `codex/multi-company-admin` continua a implementação do PR de conferência, sem recriar o sistema. A lista de empresas possui pesquisa por nome/CNPJ/código/situação, filtros e ordenação, com indicadores calculados dos cadastros e escalas existentes. Cada empresa abre administração individual com sete abas; funcionários, modelos próprios, escalas, feriados aplicáveis e histórico usam o contexto selecionado. O cabeçalho identifica a empresa ativa e permite voltar à visão consolidada. Não há contagens fictícias de aprovações/publicações, cujo fluxo ainda está pendente.

O cadastro empresarial admite somente o nome como obrigatório e permite completar identificação, endereço, contatos, situação, CCT, política operacional e padrões posteriormente. Arquivar/inativar exige confirmação e conserva os registros; o banco bloqueia novas operações em funcionários, modelos, escalas e dias enquanto a empresa estiver inativa. A exclusão de empresas, funcionários e escalas foi revogada para o cliente autenticado, evitando cascatas acidentais. A manutenção administrativa da própria conta continua sendo operação privilegiada de servidor.

Funcionários têm matrícula, setor, admissão, situação do vínculo, modelo individual, cargas diária/semanal e regras especiais descritivas. O detalhe individual reúne contrato, escala, folgas, feriados planejados e histórico identificável. Modelo individual tem precedência sobre o padrão da empresa; a seleção explícita para uma nova prévia é indicada na interface. Alterar padrões não reescreve os contratos ou os dias de escalas já salvas. Carga diária e descansos contratuais participam da conferência. Personalizar referência compartilhada dentro da empresa cria uma cópia própria, preservando o modelo comum e outras empresas.

A auditoria do banco registra empresa, responsável, campos, antes e depois. Eventos antigos sem contexto não recebem empresa presumida. O histórico contextual consulta o Supabase por empresa e permite carregar páginas anteriores de 100 eventos, sem depender dos últimos 100 eventos globais. Na demonstração, somente ações efetivamente realizadas na sessão geram eventos locais, identificados como demonstração. Não são inseridos eventos fictícios em produção.

Na primeira etapa, o calendário individual de feriados era apenas uma consulta das datas oficiais pela localização. A atualização **Ambientes independentes por empresa**, abaixo, acrescenta cadastros particulares e a preferência empresarial de folga, preservando as referências gerais. Trabalho previsto continua distinto de trabalho realizado.

### Migração e implantação segura

A migration incremental `supabase/migrations/20261022191148_company_administration.sql` deve ser aplicada primeiro em ambiente Supabase de teste, depois das migrations anteriores. Não foi aplicada a banco remoto. Ela acrescenta campos e auditoria, ajusta a validação/unicidade de CNPJ opcional e inclui validadores de contexto e arquivamento. Preserva registros e deixa datas antigas desconhecidas como NULL. Não há associação arbitrária de registros antigos. O frontend atualizado depende desse schema para gravação e leitura da nova auditoria.

Os testes PostgreSQL embarcados executam as migrations reais com `auth.uid()` simulado, verificando contas diferentes, duas empresas do mesmo proprietário, modelos externos, referências cruzadas, reassociação de vínculos/escalas/dias, arquivamento, exclusões proibidas e auditoria. A autorização permanece no modelo existente de conta proprietária; não foram criados perfis fictícios de administrador/operador/visualizador. O retorno mais seguro é reverter apenas o frontend e manter os campos/histórico no banco; remover colunas após uso poderia descartar dados e não foi automatizado.

### Verificação e pendências

Validação local: 68 testes unitários/de banco PostgreSQL embarcado e 21 testes Playwright, além de typecheck, formatação e build. Os cenários de navegador cobrem duas empresas com funcionários e modelos distintos, cadastro mínimo, modelos individuais, arquivamento/reativação, troca com descarte controlado, personalização de modelo compartilhado, auditoria, saída/reentrada e telas de 375/390px. Não há script de lint. Autenticação e persistência remotas ainda precisam ser verificadas com contas e banco de teste; os testes de navegador utilizam demonstração em memória.

Próxima etapa: separar feriado oficial de configuração operacional por empresa, seleção de funcionários/turnos e monitoramento. Também permanecem pendentes transferências com vínculos históricos, aprovação/publicação/versionamento, visão de equipe Dia/Semana, ações em lote e relatórios consolidados. Nenhuma escala é aprovada automaticamente e nenhuma mudança foi publicada em produção. A demonstração inclui Aurora Contabilidade e Horizonte Serviços com dados fictícios independentes, para conferir o fluxo multiempresa.

## Identidade visual Cont Contábil

A branch `codex/cont-contabil-brand` aplica a identidade fornecida pela Cont Contábil ao login, menu, painel, cadastros e calendários. A paleta usa azul-marinho, ciano e superfícies claras; os avisos e violações mantêm cores semânticas e identificação por texto/ícones. O foco de teclado permanece visível em fundos claros e escuros. A tabela exportada em PDF acompanha o azul da marca.

A logo vetorial enviada pelo usuário foi incorporada localmente em `public/brand/`, com versões para fundos claros/escuros e símbolo para o ícone da aplicação. As formas foram preservadas; o enquadramento e as cores da versão clara foram adaptados para legibilidade. O componente `Brand` dimensiona as imagens e fornece texto alternativo, sem dependência de serviços externos.

Verificação: 68 testes unitários/de banco local, 21 testes de navegador, build, typecheck, formatação e `git diff --check`. A revisão visual cobre login, painel, empresas, calendário e menu móvel; as logos carregam corretamente e o login/painel não apresentam overflow horizontal nas larguras de 375 a 1440px verificadas. Esta alteração é visual, sem nova migration ou alteração de fluxos de autenticação, isolamento ou persistência. A implantação é somente uma prévia; produção não foi alterada.

## Modelos, calendário e consulta da equipe

O cadastro de modelos mostra os campos de ciclo apenas para 12×36. Nos modelos semanais, o total em horas de relógio é calculado durante a digitação, descontando pausas; texto parcial ou períodos sobrepostos recebem indicação de revisão em vez de um total incorreto. O botão de cópia aplica segunda-feira a terça–sexta sem alterar sábado/domingo. O editor e a gravação reutilizam a validação de horários existente. Valores permanecem ao alternar o tipo no formulário; o ciclo informa que a carga semanal varia, sem atribuir uma semana fixa ao 12×36. A data mantém o campo nativo do navegador.

Violações e atenção sem ocorrências ocupam apenas linhas compactas. Os painéis completos aparecem automaticamente quando existem grupos; fontes pendentes continuam separadas e recolhidas, sem presumir aprovação. O calendário precede os detalhes de cálculo e a conferência semanal. Números das datas têm cor neutra; bordas vermelhas/âmbar, ícones, textos e legenda identificam problemas.

A consulta **Grade da equipe**, disponível em Escalas mensais, apresenta dia, semana ou mês das escalas salvas. O seletor **Empresa ativa** filtra os vínculos; **Visão consolidada** reúne as empresas já autorizadas na conta. Sem registro é exibido como “Sem escala”, distinto de uma folga salva; totais usam horas computadas por data civil. Semanas cortadas pela competência são identificadas como parciais. A grade abre a escala individual e mantém a prévia não salva até eventual confirmação de troca. Ela não gera escalas em lote nem aplica alterações de equipe.

Os seletores de empresa, funcionário, modelo e mês preservam o valor escolhido enquanto a confirmação de descarte está aberta. Confirmar aplica a seleção solicitada; cancelar conserva a prévia e o contexto anterior.

A associação de empresa/funcionário/mês é validada na projeção da grade, incluindo duas empresas da mesma conta. Horários legados inválidos sinalizam conferência incompleta, preservando registros e a consulta das demais pessoas. Nenhuma migration foi adicionada e nenhum dado remoto foi alterado. Persistem as pendências operacionais de feriados, transferências, aprovação/publicação e versionamento descritas nas entregas anteriores.

Validação local desta etapa: 72 testes unitários/de banco embarcado e 30 testes de navegador, além de build, typecheck, formatação e `git diff --check`. Os novos cenários verificam cópia sem alterar finais de semana, total/erros durante digitação, ciclo condicional, compactação e expansão de alertas, consulta consolidada/contextual, prévias não salvas, ausência de registros, horários noturnos e rolagem contida em 375/390px. Auth e persistência remotas não foram revalidados; navegador usa a demonstração em memória. Implantação somente em prévia.

## Folha de ponto a partir do calendário

O botão **Folha de ponto** ao lado das exportações da escala gera um PDF A4 individual, seguindo a estrutura do exemplo fornecido: identificação da empresa/funcionário, período, dias, entrada, intervalo (saída/retorno), saída, extras e assinatura/observações. O CPF vem exclusivamente do funcionário selecionado e aparece com máscara logo abaixo do nome, ou como **Não informado** quando ausente. O campo **Horário de trabalho** no cabeçalho reflete a escala exibida, incluindo alterações ainda não salvas, sem regenerar o mês a partir do modelo. Jornadas iguais são agrupadas por dia da semana; alterações dentro do mês são identificadas pelas datas. A tabela reserva os campos de horários para marcações reais em branco, com espaço ampliado para preenchimento manual. A folha identifica quando a base é uma prévia não salva e mantém somente a assinatura do funcionário, centralizada abaixo da tabela. As observações explicativas gerais acima da tabela e abaixo da assinatura foram removidas.

A migration aditiva `20261023175301_employee_cpf.sql` prepara o campo opcional no banco: 11 dígitos ou `NULL`, preservando cadastros existentes, RLS e vínculos. Ela deve integrar o fluxo de migrations antes de gravar um CPF preenchido remotamente. Cadastros legados sem CPF não enviam esse campo ao salvar, preservando a compatibilidade com bases ainda sem a coluna. O carregamento e a gravação existentes já transportam esse campo; não há uma segunda fonte de CPF. A migration foi testada somente no banco local embarcado, sem alteração de dados remotos ou publicação em produção.

Folgas e feriados sem trabalho previsto recebem linha cinza mais escura e riscos nos campos de horários. Conforme a escolha explícita do usuário, feriados com trabalho previsto ficam destacados, com os campos de marcação disponíveis. A informação de feriado vem da própria escala do calendário. Turnos noturnos conservam a indicação de dia seguinte e a continuação na próxima data civil, inclusive após pausas. Dias ausentes são identificados como registro incompleto, preservando continuações conhecidas e sem presumir folga.

A exportação valida a correspondência de empresa, funcionário e escala. Não altera a escala nem salva a prévia. A exportação PDF da escala, Excel e CSV existentes continuam disponíveis. A folha usa os dados presentes nos cadastros; os dados pessoais do arquivo de referência não foram copiados para código, demonstração ou testes. O PDF padrão de 31 dias cabe em uma página; textos longos ou períodos adicionais continuam em páginas com identificação e cabeçalhos repetidos.

Verificação local do ajuste de layout e CPF: 84 testes unitários/de banco embarcado e 33 testes de navegador, build, typecheck, formatação e `git diff --check`. Inclui CPF preenchido/ausente, máscara, posição no cabeçalho, retirada dos dois avisos, cadastro/limpeza do CPF, preservação do legado e isolamento entre contas, além de geração do PDF real, A4/31 dias, nove colunas sem horário previsto, campos em branco, horários dinâmicos, assinatura única centralizada, destaque de descansos, paginação, observações, calendário editado, virada de mês noturna, meses de 28/29/30/31 dias, rejeição de referências cruzadas e download por funcionário/empresa. Amostras fictícias com e sem CPF, jornadas distintas e textos longos foram renderizadas e revisadas visualmente. Navegador usa a demonstração em memória; Auth e persistência remotas não foram revalidadas. Implantação somente em prévia; banco remoto e produção permanecem inalterados.

## Ambientes independentes por empresa

Cada cartão abre a administração da empresa, com funcionários, modelos próprios, escalas, feriados, configurações, parâmetros e histórico. A navegação lateral mantém o contexto empresarial; **Todas as empresas** retorna ao diretório geral. Empresa, página, funcionário, competência e visão da grade ficam na URL, permitindo recarregar ou abrir um link interno. A referência da URL só é resolvida após consultar os cadastros autorizados; uma empresa ou um funcionário indisponível não é substituído por outro vínculo. A demonstração reabre os cadastros fictícios iniciais após recarregar, preservando o contexto que existir nesses exemplos; ela continua sem persistir dados pessoais localmente.

A biblioteca de modelos-base permanece separada dos modelos próprios. **Personalizar nesta empresa** cria uma cópia editável; empresas novas não recebem modelos particulares ou vínculos de outras. Novos vínculos exigem modelo próprio. Referências globais legadas continuam consultáveis e salváveis, mas a base vinculada é protegida contra edição/exclusão para evitar propagação de mudanças. Gerar ou duplicar a partir de uma base legada cria uma cópia própria com os mesmos horários. Modelos próprios só podem ser excluídos quando não estão vinculados a configurações, funcionários ou escalas.

Feriados e parâmetros têm `empresa_id` opcional: `NULL` mantém as referências gerais existentes, e registros particulares pertencem exclusivamente à empresa escolhida. Feriados gerais conservam os filtros de localidade; particulares não atingem outra empresa da mesma cidade. Por chave de parâmetro, regras gerais continuam válidas antes da primeira vigência particular; a partir dela, a configuração própria assume a chave e não recebe novas vigências gerais automaticamente. Fontes, confirmação e fórmulas de cálculo foram preservadas. A seleção efetiva também é usada no calendário, detalhe do funcionário, grade consolidada e exportações. A preferência **Folgar nos feriados ao gerar escalas** é armazenada na empresa.

`loadData(companyId)` limita as consultas dos recursos na API e conserva o diretório autorizado para a troca de empresa. As RPCs `salvar_registro_empresa`, `salvar_escalas_empresa` e `excluir_modelo_empresa` usam `SECURITY INVOKER`, RLS e validação explícita de empresa, proprietário, registro e payload. Lotes de escalas preservam a transação existente e rejeitam IDs de outra empresa, funcionário ou competência. Campos de identidade/permissão não são aceitos no JSON de alteração. O proprietário continua podendo administrar todas as suas empresas na área geral; isso não autoriza misturar os vínculos de uma operação individual.

A migration aditiva `20261023184038_company_isolation.sql` deve integrar o fluxo de banco após as migrations anteriores, incluindo CPF, antes de usar a gravação contextual no Supabase. Não altera automaticamente regras, dias salvos ou vínculos antigos. Foi aplicada e consultada somente em PostgreSQL embarcado (PGlite); o daemon Supabase local não está disponível e nenhuma migration foi aplicada ao banco remoto. O PDF da folha de ponto mantém CPF, horários, campos manuais, assinatura centralizada, rodapé e paginação.

Validação desta etapa: 102 testes unitários/de banco embarcado e 38 cenários de navegador aprovados, além de build, TypeScript, formatação e `git diff --check`. Os cenários cobrem duas empresas, nova empresa vazia, cópia da biblioteca, bloqueio de exclusão vinculada, regras e feriados particulares, troca de contexto, recarga/URL direta, referências não autorizadas e emissão da folha pelo funcionário com CPF. Foram revisadas as telas de modelos no computador e em 375px. Os testes SQL executam as migrations reais e verificam RLS, payloads/IDs divergentes, chamadas diretas, permissões, legado e rollback de lotes. Os testes de navegador usam demonstração em memória; Auth e persistência no serviço remoto não foram revalidados. Falhas de carregamento bloqueiam o conteúdo até nova tentativa, e operações pendentes são interrompidas quando muda o contexto de acesso.

Arquivos desta etapa: administração em `company-admin.tsx`, `company-fields.tsx`, `employee-admin.tsx`, `employee-fields.tsx`, `company-resources.tsx` e `workspace.tsx`; seleção e transporte em `company-context.ts`, `company-resources.ts`, `workspace-navigation.ts`, `store.ts`, `types.ts`, `engine.ts`, `team-schedule.ts` e `exports.ts`; migration `20261023184038_company_isolation.sql`; testes em `tests/company-context.test.ts`, `tests/company-resources.test.ts`, `tests/company-isolation-database.test.ts`, `tests/workspace-navigation.test.ts`, `tests/employee-admin.test.ts`, `tests/multi-company-database.test.ts`, `e2e/company-isolation.spec.ts`, `e2e/compact-alerts.spec.ts`, `e2e/multi-company.spec.ts` e `e2e/workflow.spec.ts`, além deste README. O renderizador da folha de ponto não foi alterado.
