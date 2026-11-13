# Contas reais e dados persistentes

## O que mudou

O acesso principal agora usa **e-mail e senha** diretamente no Supabase Auth. O cadastro pede **nome, e-mail, senha e confirmação** e não depende de `SUPABASE_SECRET_KEY` nem da rota administrativa de aliases. O nome é salvo somente em `auth.users.raw_user_meta_data.nome`; não são criadas tabelas próprias de senhas, e-mails duplicados ou permissões por metadados.

As contas antigas continuam com o mesmo UUID, empresas, funcionários, modelos, escalas, histórico e permissões. Quem já usa nome de usuário pode escolher **Entrar com usuário existente**; essa alternativa conserva a infraestrutura privada anterior. Ela não é requisito para cadastro/login por e-mail.

`/`, `/login` e `/ferramenta` dão acesso à conta real. Visitantes sem sessão são encaminhados para `/login`, sem consultar cadastros protegidos. A sessão é mantida e renovada pelo SDK do Supabase. As gravações continuam no Postgres e não são transferidas para localStorage. Somente tokens da sessão ficam no armazenamento do SDK; a recuperação opcional de rascunhos já existente mantém sua política própria.

A demonstração foi separada em `/demonstracao` e `/?demo=1`. Seus avisos permanecem apenas ali, para não apresentar dados fictícios como gravações reais. O HTML exportado continua sendo demonstrativo e não substitui o site com banco.

Alterações temporárias que desapareceram ao sair da demonstração não podem ser recuperadas pelo cadastro novo. Cadastros já gravados no Supabase permanecem no projeto e na conta originais.

## 1. Supabase: use o projeto existente

Se já existe um projeto, mantenha-o. Não crie outro para testar uma conta antiga: os dados pertencem ao projeto e UUID originais.

Em **Authentication → Providers**, ative Email e permita novos cadastros. Mantenha a confirmação de e-mail. Nas configurações de senha do Auth, defina mínimo de **8 caracteres** e as exigências adequadas ao escritório. A interface também valida nome, e-mail, comprimento e confirmação, sem modificar espaços intencionais da senha.

Em **Authentication → URL Configuration**, use a URL real do site como Site URL e adicione a URL exata `https://SEU-SITE/login` em Redirect URLs. Para desenvolvimento, adicione `http://localhost:3000/login`. Cada Preview precisa de seu callback permitido. Links de confirmação e recuperação são tratados pelo SDK.

Configure um remetente/SMTP adequado e confira os limites de envio do plano. Nenhum e-mail real foi disparado pelos testes. A entrega e o link enviado pelo Supabase precisam ser conferidos pelo responsável na conta real.

## 2. Banco: escolha somente um procedimento

### Projeto com tabelas existentes

Execute **`supabase/setup/verificar-banco-existente.sql`** no SQL Editor. É uma verificação de leitura, sem criar contas, alterar registros ou permissões. Confere as 14 tabelas e a ativação de RLS. Se indicar migração ausente, aplique somente os arquivos pendentes de `supabase/migrations/`, conforme o histórico existente; não repita migrações já aplicadas.

O fluxo por e-mail não exige novas tabelas ou alteração de credenciais. As tabelas de empresas, funcionários, modelos, escalas/dias, parâmetros, feriados e histórico já pertencem ao sistema e continuam protegidas por proprietário e vínculos compostos. Não há justificativa para recriá-las.

### Projeto novo e vazio

Execute **`supabase/setup/instalacao-novo-projeto.sql`**. O arquivo reúne as 11 migrations versionadas em uma transação, com tabelas, RPCs, políticas e registro de histórico para compatibilidade com futuras migrations pelo CLI. Recusa a execução se encontrar tabelas do aplicativo, evitando sobrescrever uma base existente. Em caso de falha, a transação deve ser revertida; não pule os testes de segurança nem apague tabelas para contornar o erro.

Os SQLs são gerados a partir dos arquivos originais por `node scripts/gerar-sql-instalacao.mjs`. Nenhuma migration histórica ou regra legal foi modificada.

## 3. Variáveis e Vercel

Copie `.env.example` para `.env.local` e preencha somente as duas variáveis obrigatórias:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=SUA_CHAVE_PUBLICAVEL
```

Use a chave **publishable** ou a chave legada **anon**. São credenciais públicas do cliente, com acesso limitado por Auth/RLS. O build recusa chaves privadas conhecidas e tokens de usuário colocados por engano nessa variável. Nunca coloque `service_role` ou `sb_secret_...` em `NEXT_PUBLIC_*`, no HTML, código versionado, mensagens ou logs.

Em Vercel → Project → Settings → Environment Variables, cadastre as mesmas variáveis nos ambientes desejados e gere novo deploy: valores `NEXT_PUBLIC_*` são incorporados no build. Não use `/ferramenta` de um deploy anterior, nem um link com `?demo=1`, para verificar persistência. Use a nova Preview sem marcador de demo.

A chave privada `SUPABASE_SECRET_KEY` é **opcional**, exclusiva do servidor e necessária apenas para o login legado por nome de usuário e seu limiter. O cadastro por nome/e-mail e a entrada por e-mail funcionam sem ela. Não a copie para o navegador. Este trabalho não contrata plano nem publica produção automaticamente; confirme um plano Vercel compatível com uso comercial antes de colocar o escritório em produção.

## 4. Teste manual do início ao fim

1. Abra a URL do site sem `?demo=1`, clique em Criar conta e informe nome, e-mail real, senha de pelo menos 8 caracteres e confirmação igual.
2. Abra a confirmação recebida por e-mail e entre com e-mail e senha. A conta deve começar com seus próprios dados, sem empresas fictícias.
3. Cadastre uma empresa, um funcionário e um modelo. Gere uma escala e clique em **Salvar escala**. Uma prévia ainda não salva não equivale a gravação.
4. Recarregue a página: os registros devem permanecer. Clique em Sair, entre novamente com o mesmo e-mail e confira os cadastros e a escala.
5. Repita com outra conta. A segunda conta não deve enxergar registros da primeira. RLS também impede acesso indevido por requisição direta.
6. Use Esqueci minha senha, abra o e-mail de recuperação, defina e confirme a nova senha, saia e entre com ela.

Erros conhecidos do provedor são exibidos em português, incluindo senha incorreta, confirmação pendente, endereço já cadastrado quando o Auth informa essa condição, limites de envio e falha de conexão. Por proteção contra enumeração, o Supabase pode ocultar duplicidade e retornar uma resposta neutra: nesse caso a interface não inventa que a conta foi criada nem consulta um diretório administrativo de e-mails.

## Dados pessoais e limites da validação

O nome de acesso fica nos metadados da própria conta. Nenhuma senha é gravada pelo aplicativo. Os campos opcionais de funcionários existentes foram preservados; colete-os apenas quando necessários e com fundamento adequado. Rascunhos não substituem o banco; exportações devem ser guardadas conforme a política do escritório. Fontes, valores e avisos de CCT não foram alterados.

Testes de navegador usam o SDK real com transporte Supabase simulado e persistente fora da página. SQL é executado em Postgres embarcado com usuários/políticas reais de teste. Isso verifica salvamento, recarga, novo login e isolamento, mas não prova entrega de e-mail, sessão de uma conta de produção ou configuração remota ainda não verificada.
