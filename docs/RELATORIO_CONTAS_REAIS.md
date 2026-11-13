# Entrega: contas reais e persistência — 13/11/2026

Branch: `codex/contas-reais-email-20261113`, baseada na versão acumulada do sistema original. Produção e dados remotos não foram modificados. Nenhum plano pago foi contratado.

## Implementado

- Cadastro por nome/e-mail/senha/confirmação diretamente no Supabase Auth, sem depender da chave administrativa do login legado.
- Login principal por e-mail, saída, reenvio de confirmação, recuperação e definição de nova senha. O acesso antigo por nome de usuário continua opcional.
- Validação em português, senha mínima de oito caracteres, confirmação igual, carregamento, bloqueio de envio duplicado e mensagens acessíveis. A senha é preservada integralmente, inclusive espaços intencionais.
- Sessão persistida/renovada pelo SDK; visitantes encaminhados a `/login`, sem leitura prévia dos cadastros protegidos.
- `/ferramenta` abre a conta real; `/demonstracao` conserva a demonstração separada. HTML/ZIP anteriores continuam exportações demonstrativas.
- Reutilização da persistência Postgres, RPCs atômicas e RLS existentes. Nome apenas nos metadados Auth, sem novas tabelas de senhas ou duplicação de dados pessoais.
- Proteção de build contra chaves privadas conhecidas e tokens de sessão colocados em variáveis públicas.
- SQL de instalação em projeto vazio com bloqueio de sobrescrita, transação e histórico de migrations; verificador de leitura para banco existente. As 11 migrations históricas, fontes e regras legais permanecem inalteradas.

## Testes executados

- `npm run lint`: aprovado.
- `npm run typecheck`: aprovado.
- `npm run format:check` e Prettier do gerador SQL: aprovados.
- `tsx --test --test-concurrency=2 tests/*.test.ts`: **338/338 aprovados**.
- `npm run test:e2e`: **101/101 aprovados** em uma execução completa.
- `npm run build`: aprovado, com Next.js e Node 24, compatível com a Vercel.
- `git diff --check`: aprovado. Nenhuma alteração no motor de regras, referências legais ou migrations históricas.

Os cenários novos incluem cadastro quando a rota administrativa antiga está indisponível, validação sem requisição inválida, erro de senha/duplicidade/conexão, carregamento, confirmação, recuperação com confirmação da nova senha, sessão após recarga e novo login, cadastro de empresa/funcionário/modelo/escala, separação entre contas e celular. A regressão preserva calendário, edição em lote, histórico, aprovações e exportações PDF/XLSX/CSV.

Os testes de navegador usam o SDK real com transporte Supabase simulado e estado persistente fora da página. Os SQLs são executados em PostgreSQL embarcado (PGlite), com RLS e papéis de teste. Isso não equivale a um teste com conta real no serviço remoto.

## Configuração externa e pendências

Siga [CONTAS_REAIS.md](CONTAS_REAIS.md): mantenha o projeto existente, escolha o SQL apropriado, confira o provedor de e-mail, política de senha, confirmação/SMTP, variáveis públicas e os callbacks exatos `/login`.

A consulta de leitura ao serviço Supabase foi bloqueada pelo proxy com HTTP 403, inclusive na nova tentativa autorizada. Por isso, a entrega real de confirmação/recuperação e a configuração remota precisam de homologação na conta do responsável. Nenhuma migration ou conta de teste foi criada remotamente nesta etapa.

Teste manual: cadastrar → confirmar e-mail → entrar → criar empresa, funcionário, modelo e salvar escala → recarregar → sair → entrar de novo e conferir os mesmos registros. Testar segunda conta e recuperação de senha. Dados temporários perdidos na demonstração não são recuperáveis pelo novo cadastro.

## Arquivos criados

- `docs/CONTAS_REAIS.md`
- `docs/RELATORIO_CONTAS_REAIS.md`
- `e2e/email-auth.spec.ts`
- `e2e/support/persistence-backend.ts`
- `scripts/gerar-sql-instalacao.mjs`
- `src/app/demonstracao/page.tsx`
- `src/app/login/page.tsx`
- `src/lib/auth-email.ts`
- `src/lib/public-supabase-config.ts`
- `supabase/setup/instalacao-novo-projeto.sql`
- `supabase/setup/verificar-banco-existente.sql`
- `tests/auth-email.test.ts`
- `tests/public-supabase-config.test.ts`
- `tests/sql-instalacao.test.ts`

## Arquivos alterados

- `.env.example`
- `README.md`
- `docs/FERRAMENTA_CONT_CONTABIL.md`
- `e2e/compact-alerts.spec.ts`
- `e2e/conference.spec.ts`
- `e2e/confirmation-flow.spec.ts`
- `e2e/ferramenta.spec.ts`
- `e2e/model-form.spec.ts`
- `e2e/multi-company.spec.ts`
- `e2e/password-visibility.spec.ts`
- `e2e/special-dates.spec.ts`
- `e2e/team-schedule.spec.ts`
- `e2e/timesheet.spec.ts`
- `e2e/username-persistence.spec.ts`
- `e2e/workflow.spec.ts`
- `eslint.config.mjs`
- `next.config.ts`
- `package.json`
- `src/app/ferramenta/page.tsx`
- `src/app/globals.css`
- `src/components/auth-fields.tsx`
- `src/components/workspace.tsx`
- `src/lib/supabase.ts`
