# Ferramenta Cont Contábil

A entrada `/ferramenta` redireciona para o aplicativo com conta real. O cadastro e o login principais usam e-mail e senha; veja [Contas reais e dados persistentes](CONTAS_REAIS.md) para configurar o Supabase. A demonstração do aplicativo existente continua disponível separadamente em `/demonstracao` (`/?demo=1`). Os dois acessos usam os mesmos componentes, motor, identidade visual e bibliotecas, sem reconstruir a stack ou misturar dados fictícios com cadastros reais.

A entrada de conta original em `/` e a autenticação permanecem disponíveis. Nenhuma migration histórica, fonte, valor, vigência legal ou registro de produção foi alterado. O acesso de demonstração não cria sessão Auth, usuário ou cadastro no Supabase. O acesso real depende das variáveis públicas do Supabase, do banco e das permissões do usuário; não exige a chave privada usada pelo login legado por nome de usuário.

## HTML e ZIP

- `/arquivos/gerador-de-jornadas-cont-contabil.html`: HTML enviado pelo usuário, preservado byte a byte, incluindo marca, recursos embutidos e avisos.
- `/arquivos/gerador-de-jornadas-cont-contabil.zip`: o mesmo HTML com instruções de abertura local.
- As duas URLs enviam `Content-Disposition: attachment`, para baixar o arquivo em vez de exibir seu código no navegador.

O arquivo HTML é uma exportação demonstrativa. Ele usa dados fictícios e reinicia ao recarregar, conforme a mensagem da própria ferramenta. Não executa as migrations do Supabase nem substitui o sistema online. Links de acesso à conta no HTML foram preservados exatamente como recebidos.

As regras e suas fontes permanecem sujeitos à conferência humana já indicada no aplicativo. Disponibilizar a demonstração não certifica aprovação jurídica.

## Verificação

Os testes verificam a entrada direta em modo de demonstração pela rota separada, ausência de chamadas ao Supabase nesse modo, isolamento das alterações temporárias, cabeçalhos/arquivos de download e responsividade. Os testes existentes continuam cobrindo motor, SQL/RLS, histórico, autenticação, calendário, modelos, relatórios e exportações. Os testes de autenticação usam transporte local simulado; não equivalem a login real em produção.
