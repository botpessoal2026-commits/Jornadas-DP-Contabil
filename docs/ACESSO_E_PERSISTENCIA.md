# Usuário, senha e persistência — 29/10/2026

Base: `f6f75ef`. Branch: `codex/usuario-senha-persistencia`. O projeto confirmado pelo usuário é `vzlqsusuzqatoftrkosq`; não foi criado outro projeto nem substituída a identidade de contas existentes.

## Correção da entrada e visualização de senha — 29/10/2026

O campo de senha agora tem botão **Mostrar senha / Ocultar senha**, acessível por mouse, toque e teclado, nos modos de login, cadastro e definição de nova senha. O botão não envia o formulário, preserva o valor digitado e volta ao estado oculto ao trocar de modo. Capitalização automática, correção e verificação ortográfica permanecem desativadas mesmo com a senha visível. A senha digitada também passa a ser enviada integralmente, sem remover espaços das extremidades.

A investigação do login reportado confirmou que o alias havia sido reservado, mas a conta ainda aguardava confirmação de e-mail. O gateway descartava o código `email_not_confirmed` e mostrava a mesma mensagem de senha incorreta. Agora preserva esse código internamente e responde `confirmation_required` somente quando o Supabase valida a senha e indica a pendência. Usuário inexistente e senha errada continuam recebendo o mesmo 401 genérico, sem e-mail ou identidade na resposta. A ordem da validação foi conferida na implementação do [Supabase Auth](https://github.com/supabase/auth/blob/master/internal/api/token.go#L177).

A tela mantém a orientação **Confirme seu e-mail para ativar o acesso** após cadastro sem sessão ou login pendente. A ação **Reenviar confirmação** abre um formulário apenas com o e-mail informado pela própria pessoa e usa `auth.resend({type:'signup'})`. A resposta é genérica, sem consultar ou revelar um diretório de contas. O envio depende do clique da pessoa; nenhum e-mail real foi disparado pelos testes. Não houve confirmação administrativa, alteração de senhas ou desativação da verificação de e-mail.

Arquivos desta correção: `auth-fields.tsx`, estilos em `globals.css`, integração em `workspace.tsx`, política em `auth-username-server.ts` e adaptador em `server/username-auth.ts`. Testes em `username-auth.test.ts`, `e2e/password-visibility.spec.ts` e `e2e/confirmation-flow.spec.ts`. Nenhuma migration ou regra de jornada foi alterada.

## Implementação

- Entrada principal com **Usuário e Senha**. Nomes são normalizados para minúsculas e têm 3–32 caracteres ASCII (letras/números/ponto/hífen/sublinhado), com alguns nomes técnicos reservados.
- Contas existentes podem usar **Entrar com e-mail existente → Meu acesso → Salvar usuário**. O alias aponta para o mesmo UUID do Supabase Auth; senha, empresas, funcionários, modelos, feriados e escalas permanecem com seu proprietário original.
- Novos cadastros usam usuário/senha e e-mail real somente para confirmação e recuperação. O Supabase Auth continua responsável pelas senhas e sessões. Não há conta padrão, senha fixa, autenticação local ou e-mail inventado para criar identidades.
- Alias não é autorização: nenhum papel ou permissão é obtido por `user_metadata`. Não há diretório público de e-mails/usuários.
- A rota privada resolve o alias no servidor, autentica no Supabase e entrega tokens somente para o UUID resolvido. Respostas de erro não revelam e-mail, SQL ou existência da conta; limite de payload e verificação de origem aplicados.
- Limites atômicos de tentativas em banco, compartilhados entre instâncias: IP (30/15min), par IP/usuário (8/15min), conta (30/15min). Apenas HMACs ficam nos buckets; limpeza limitada remove buckets antigos durante novas tentativas. Não se promete exclusão pontual em 24h se não houver novas chamadas.

## Persistência

A perda percebida vinha principalmente dos links com `?demo=1`: a demonstração recria dados fictícios a cada recarga e nunca grava cadastros reais. O novo atalho **Usar minha conta com dados salvos** retira esse marcador e abre a conta. Não transfere fictícios automaticamente nem recupera dados de sessões já encerradas.

No ambiente da conta, os botões **Salvar cadastro**, **Salvar escala** e as operações existentes continuam gravando no Supabase com RLS. Os registros ficam no banco e são carregados novamente após login/reload, sem depender da versão do frontend. Não se apresenta uma edição ainda não salva como confirmada. Rascunhos continuam separados, com a recuperação opcional já existente.

Corrigido o caso **INSERT/UPDATE confirmado + falha na recarga**: a tela identifica a gravação concluída, fecha o formulário, mantém o registro confirmado na visão pendente e exige atualização antes de um novo cadastro/edição, sem repetir o INSERT. A leitura posterior tem prazo de oito segundos e é cancelada ao expirar, incluindo as repetições transitórias do SDK. A confirmação de gravação e o fechamento do formulário não dependem dessa leitura. Falha de gravação mantém o formulário para correção. Troca de conta/modo invalida operações pendentes do contexto anterior.

## Arquivos

- `src/lib/auth-username.ts`: normalização, sessão pelo SDK e vínculo do usuário autenticado.
- `src/lib/auth-username-server.ts`: política da rota, validação e respostas genéricas, testáveis por injeção de dependências.
- `src/lib/server/username-auth.ts`: clientes exclusivos de servidor, resolução privada e buckets HMAC.
- `src/app/api/auth/username/route.ts`: POST de login; GET de disponibilidade sem identidade. Cadastro novo verifica a disponibilidade antes de chamar Auth.
- `src/components/auth-fields.tsx`: campos e dicas acessíveis.
- `src/components/workspace.tsx`: integração, Meu acesso, distinção demo/conta e tratamento do pós-gravação.
- Migration `20261029150540_username_login_and_attempt_limits.sql`: aliases, RPCs, RLS, reserva atômica no cadastro Auth e limites. Trigger privilegiado isolado em schema privado; nenhuma mudança em senhas, UUIDs, empresas ou permissões existentes.
- `tests/username-auth.test.ts`, `tests/username-database.test.ts`, `e2e/username-persistence.spec.ts`; mock anterior atualizado para a consulta dos aliases.

## Ativação na Preview — 29/10/2026

**Conexões liberadas e configuração validada.** A conexão Supabase **Setor Pessoal** permite acessar o projeto confirmado. Ele estava pausado (`INACTIVE`); a operação oficial de retomada foi concluída no mesmo projeto, agora `ACTIVE_HEALTHY`, mantendo o plano Free. Não foi criado outro banco, plano pago ou conta de acesso permanente.

O inventário inicial confirmou **duas contas Auth**, nenhuma tabela de negócio em `public` e nenhum histórico de migrations. Foram aplicadas as dez migrations existentes e a correção incremental `20261029193932_internal_trigger_function_privileges.sql`. As 14 tabelas de negócio/controle têm RLS habilitado; as duas contas anteriores permanecem. Não havia cadastros de empresas, funcionários ou escalas no banco para migrar. Dados temporários de demonstrações encerradas não podem ser recuperados dessa base.

O conector gerou a mesma versão por segundo nas duas primeiras chamadas: a segunda DDL havia sido confirmada pelo `COMMIT` do arquivo, mas seu registro de histórico falhou. A coluna, o CHECK e o comentário foram conferidos antes de reparar somente o histórico, sem repetir a DDL. As aplicações posteriores retiraram apenas o `BEGIN/COMMIT` externo para preservar a transação do conector. O histórico foi alinhado às versões locais e conferido; nenhum arquivo histórico foi reescrito.

A chave salva pelo usuário tinha nome/tipo corretos, mas estava destinada a Production. Seu escopo foi corrigido **sem ler ou exibir o valor**: `SUPABASE_SECRET_KEY`, Secret/Sensitive, somente Preview e branch `codex/usuario-senha-persistencia`. Foi criado também o override `NEXT_PUBLIC_DEMO_ONLY=false` somente nessa branch; a configuração das demais branches foi preservada. A URL e a chave publicável da Preview correspondem ao projeto confirmado.

O servidor requer `SUPABASE_SECRET_KEY` (ou o legado `SUPABASE_SERVICE_ROLE_KEY`), além das duas variáveis públicas existentes. Configurar a chave somente nas variáveis privadas do servidor/Vercel, nunca em `NEXT_PUBLIC_*`, no código, em arquivo versionado ou no chat. A chave permite a resolução privada e o limiter; o navegador continua usando apenas a chave publicável e a sessão do próprio usuário.

Foi gerada uma nova Preview (a API da Vercel chama esse destino de `staging`), sem promoção ou publicação em produção. O GET remoto `/api/auth/username` agora retorna **200 e `available:true`**. O acesso legado por e-mail está disponível para as duas contas existentes definirem o próprio usuário em **Meu acesso**; não houve atribuição automática de nomes ou alteração de senhas.

Sem configuração/migration, a rota continua retornando 503 explícito; não cria uma sessão falsa, não desliga RLS e não muda dados reais para armazenamento local. A opção **Explorar demonstração** continua temporária; para salvar registros, entrar na conta e usar os botões de salvamento.

Os advisors detectaram grants diretos herdados do Supabase para as funções internas `auditar_alteracao()` e `rls_auto_enable()`. A nova migration revoga a execução direta pela API, preservando os triggers e seus corpos. Após a correção, restam o aviso da proteção contra senhas vazadas desabilitada nas configurações Auth e a informação de RLS sem políticas em `login_tentativas` (intencional: tabela exclusiva do servidor, sem grants de cliente). Não foi contratado plano pago nem alterada a configuração global de autenticação. Referências: [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) e [RLS sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Verificação

Baseline: 297/297 testes. Após implementar: **322/322 testes unitários e SQL aprovados**, incluindo reservas de alias, rejeição de duplicados/forjados, acesso de outro usuário/anon negado, limiter e reabertura do banco local. Build, TypeScript e formatação verificados. A disponibilidade real sem chave foi testada: GET retorna 503 e `available:false`; não há referência à chave privada no bundle do navegador.

O navegador usa um transporte Supabase simulado e persistente fora da página para verificar sessão real do SDK e salvamento/recarga/relogin. Não equivale a homologação no projeto remoto. Resultado final: **85/85 cenários de navegador aprovados em uma execução completa**, incluindo os sete novos cenários de usuário/senha, vínculo de conta antiga, confirmação de cadastro, salvamento/recarga/relogin, falha 503 após commit, isolamento e tela móvel. A execução intermediária encontrou problemas de rótulos/seletores e espera do retry; foram corrigidos e a suíte completa foi repetida no build final. Os 322 testes unitários/SQL também foram repetidos e passaram após a correção de pós-gravação. Desktop/mobile e tema escuro inspecionados, sem transbordamento horizontal ou erros JavaScript no cenário novo.

Após a ativação, a suíte completa passou novamente: **325/325 testes**, incluindo três casos novos para grants padrão de funções, auditoria após revogação e helper opcional do provedor. TypeScript e formatação do teste novo verificados. Não houve mudança de lógica ou componentes de interface nesta etapa.

**Verificação remota adicional:** o navegador abriu a Preview protegida com acesso temporário autorizado, confirmou Usuário/Senha como campos principais, readiness 200, resposta 401 genérica a credenciais inválidas e tela de 375 px sem transbordamento ou erros JavaScript. O teste SQL transacional no banco real conferiu reserva/normalização do alias, gravação e auditoria, isolamento entre duas identidades, bloqueio de acesso anônimo e limite de tentativas do servidor. Todo o fixture foi revertido; ao final permaneciam somente as duas contas originais, sem empresas ou aliases de teste. Esse teste foi repetido após a correção dos grants.

Login bem-sucedido e salvamento pela interface com as credenciais das contas existentes **não foram executados remotamente**, pois essas credenciais não foram solicitadas nem alteradas. Os 85 cenários locais cobrem esses fluxos com transporte simulado. A confirmação de cadastro/recuperação de e-mail real também não foi disparada nesta etapa.
