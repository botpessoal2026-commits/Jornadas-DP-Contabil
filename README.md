# Gerador de Jornadas

Aplicação em português para o Departamento Pessoal organizar empresas, funcionários e escalas mensais. Next.js App Router, TypeScript, Tailwind e Supabase Auth/Postgres/RLS. Exporta PDF para conferência e assinatura, XLSX e CSV.

## Situação da entrega

- Código e migration versionados neste repositório.
- Demonstração usa dados fictícios em memória e nunca acessa dados reais.
- Sem variáveis do Supabase, login e gravação remota ficam indisponíveis; não existe fallback silencioso de dados reais para armazenamento local.
- Criação do projeto Supabase, aplicação da migration no serviço e publicação Vercel dependem do acesso às respectivas contas. Nenhum projeto pago é criado pelo código.
- Não foi validada a existência/conteúdo da EC nº 141/2026 descrita no pedido. As fases de 42h/40h são propostas editáveis, pendentes de conferência, não afirmações legais.

## Executar

Node.js 24 LTS e npm. O lockfile fixa as versões efetivamente instaladas.

```sh
npm ci
cp .env.example .env.local
# Preencher as duas variáveis públicas do projeto Supabase.
npm run dev
```

Para testar a interface sem Supabase, abra a aplicação e clique em **Explorar demonstração**. As alterações desaparecem ao sair ou recarregar. O cenário demonstrativo é dezembro de 2026; contas reais começam no mês atual de São Paulo.

Variáveis do frontend:

- `NEXT_PUBLIC_SUPABASE_URL`: URL HTTPS do projeto.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: chave publicável do Supabase. Em projetos antigos pode receber a chave `anon`, jamais `service_role` ou chave secreta.

As variáveis `NEXT_PUBLIC_` são públicas e incorporadas no build. Depois de alterá-las na Vercel, faça novo deploy. Não comite `.env.local` nem credenciais. Este aplicativo não precisa de chave administrativa em produção.

## Demonstração pessoal na Vercel

Use `NEXT_PUBLIC_DEMO_ONLY=true` no ambiente de build para publicar apenas a demonstração pessoal. Nessa modalidade, a aplicação não instancia o cliente Supabase nem oferece login/cadastro; trabalha somente com dados fictícios em memória. É preciso um novo build após mudar a variável. Não use esta modalidade para armazenar dados de funcionários reais.

O projeto da Vercel deve usar o preset **Next.js**, sem substituir o diretório de saída pelo `public`. O arquivo `vercel.json` registra o preset e os comandos para evitar o erro `STATIC_BUILD_NO_OUT_DIR`. O plano Hobby é restrito pela Vercel a uso pessoal e não comercial; confirme um plano compatível antes de usar no escritório.

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

Cada usuário autenticado acessa somente suas próprias empresas e demais cadastros. As contas são isoladas; não existe compartilhamento de escritório/equipe nesta versão. FKs compostas com `user_id` impedem vínculos entre contas, inclusive por chamadas diretas à API. As oito tabelas têm RLS. `log_alteracoes` só admite leitura pela conta proprietária; triggers geram auditoria sem duplicar dados pessoais no log. Usuários não têm privilégio de `TRUNCATE`. A RPC `salvar_escalas` mantém RLS e grava a escala e seus dias atomicamente, inclusive duplicação da empresa em lote.

Estrutura:

| Tabela              | Conteúdo                                                  |
| ------------------- | --------------------------------------------------------- |
| `empresas`          | CNPJ, localidade, CCT, permissões e limite diário         |
| `funcionarios`      | Nome, cargo, contrato e descansos; sem CPF                |
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

1. Crie sua conta, confirme o e-mail e entre.
2. Em **Parâmetros legais**, clique em **Importar referências**. Isso importa regras e modelos iniciais apenas quando os respectivos cadastros estão vazios. Confira fontes, valores e vigências; marque como conferido somente após revisão.
3. Em **Empresas**, cadastre nome, CNPJ válido, cidade/UF e CCT. Configure limite diário, autorização de 6x1 e banco de horas conforme o instrumento aplicável. Para 8h24, o limite correspondente é **8,4 horas decimais**; essa configuração exige fundamento.
4. Em **Funcionários**, cadastre nome, cargo, contrato e descansos. Não informe CPF nos campos livres.
5. Em **Feriados**, importe os fixos do ano e complete os feriados móveis e municipais. A importação não trata pontos facultativos como feriados.
6. Em **Escalas mensais**, selecione empresa, funcionário, modelo e mês, escolha se haverá folga nos feriados e gere a prévia. Confira dias, semanas, divisores e alertas; ajuste clicando nos dias e salve.
7. Exporte PDF, Excel/CSV ou copie o texto do modelo para o Domínio.

Os descansos do cadastro do funcionário são contratuais. O modelo escolhido determina o calendário gerado; divergências precisam ser conferidas. Banco de horas é uma permissão cadastrada, não um módulo de saldo/compensação.

## Motor e critérios de cálculo

`src/lib/engine.ts` recebe os parâmetros do banco; não importa valores legais dos cadastros iniciais. `src/lib/presets.ts` contém apenas sugestões editáveis para primeiro cadastro e exemplos da demonstração. Grupos: regime, intervalo, interjornada, noturno e divisor. A regra de cada grupo com vigência mais recente, não posterior à data analisada, é usada. Regras não conferidas participam da simulação e sempre geram aviso com fonte; a aplicação não as certifica.

- **42h e divisor 210:** seg–sex, 08:00–12:00 e 13:00–17:24 somam 2520 minutos; o divisor usa o fator cadastrado. O total real do calendário e o divisor são apresentados separadamente.
- **Dezembro/2026:** a referência inicial sugere 44h até 14/12 e 42h a partir de 15/12. A data pode ser alterada para 16/12 ou outra data após conferência.
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
