# Usuário, senha e persistência — 29/10/2026

Base: `f6f75ef`. Branch: `codex/usuario-senha-persistencia`. O projeto confirmado pelo usuário é `vzlqsusuzqatoftrkosq`; não foi criado outro projeto nem substituída a identidade de contas existentes.

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

## Ativação no ambiente real

**Ainda não ativado remotamente.** A consulta do projeto pelo conector Supabase foi rejeitada com `You do not have permission to perform this action`. A API da Vercel também retornou 403 para a equipe `bot-pessoal`, com indicação de autorizar o acesso da conexão à equipe. A consulta HTTP ao Auth pelo ambiente recebeu 403 do proxy; isso não prova que o banco está inativo ou vazio.

Para concluir, liberar o acesso do conector Supabase ao projeto confirmado e o acesso da conexão Vercel à equipe. Depois, conferir tabelas e histórico remoto, aplicar somente as migrations pendentes e homologar com duas contas autorizadas. Não executar de novo migrations já existentes nem substituir o banco.

O servidor requer `SUPABASE_SECRET_KEY` (ou o legado `SUPABASE_SERVICE_ROLE_KEY`), além das duas variáveis públicas existentes. Configurar a chave somente nas variáveis privadas do servidor/Vercel, nunca em `NEXT_PUBLIC_*`, no código, em arquivo versionado ou no chat. A chave permite a resolução privada e o limiter; o navegador continua usando apenas a chave publicável e a sessão do próprio usuário.

Sem configuração/migration, a rota retorna 503 explícito; não cria uma sessão falsa, não desliga RLS e não muda dados reais para armazenamento local. O acesso legado por e-mail é preservado. Nenhum deployment de produção, migration remota ou conta real foi criado nesta etapa.

## Verificação

Baseline: 297/297 testes. Após implementar: **322/322 testes unitários e SQL aprovados**, incluindo reservas de alias, rejeição de duplicados/forjados, acesso de outro usuário/anon negado, limiter e reabertura do banco local. Build, TypeScript e formatação verificados. A disponibilidade real sem chave foi testada: GET retorna 503 e `available:false`; não há referência à chave privada no bundle do navegador.

O navegador usa um transporte Supabase simulado e persistente fora da página para verificar sessão real do SDK e salvamento/recarga/relogin. Não equivale a homologação no projeto remoto. Resultado final: **85/85 cenários de navegador aprovados em uma execução completa**, incluindo os sete novos cenários de usuário/senha, vínculo de conta antiga, confirmação de cadastro, salvamento/recarga/relogin, falha 503 após commit, isolamento e tela móvel. A execução intermediária encontrou problemas de rótulos/seletores e espera do retry; foram corrigidos e a suíte completa foi repetida no build final. Os 322 testes unitários/SQL também foram repetidos e passaram após a correção de pós-gravação. Desktop/mobile e tema escuro inspecionados, sem transbordamento horizontal ou erros JavaScript no cenário novo.
