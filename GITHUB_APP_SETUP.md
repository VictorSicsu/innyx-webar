# Configuração do login GitHub no InnyxWebAR

O Studio usa um GitHub App para autenticar a conta, criar uma sessão HttpOnly e gerar uma autorização de publicação curta, limitada ao repositório `innyx-webar`. Os links públicos de experiência continuam sem login para que possam abrir em qualquer celular.

## 1. Criar o GitHub App

Na conta GitHub que administra o repositório, abra **Settings → Developer settings → GitHub Apps → New GitHub App** e configure:

- **GitHub App name:** `InnyxWebAR Studio` (ou outro nome disponível).
- **Homepage URL:** `https://innyx-webar.vercel.app/`.
- **Callback URL:** `https://innyx-webar.vercel.app/api/auth/callback`.
- **Setup URL:** `https://innyx-webar.vercel.app/api/auth/installation`.
- Ative **Request user authorization (OAuth) during installation**.
- Desative webhooks: o Studio não precisa receber eventos do GitHub.
- Em **Repository permissions**, conceda somente **Contents: Read and write**. A permissão **Metadata: Read-only** é automática.
- Não conceda permissões de organização ou de conta.

Salve o App, anote o **App ID**, o **Client ID**, o **Client secret** e o *slug* que aparece no endereço `github.com/apps/SLUG`. Em seguida, gere uma chave privada em **Private keys → Generate a private key**. Guarde o arquivo `.pem` em local seguro.

## 2. Instalar o App no repositório

Na página do GitHub App, selecione **Install App** para a conta que fará login. Escolha **Only select repositories** e selecione apenas `innyx-webar`. O repositório precisa ser público para os links de experiência e os arquivos GLB abrirem sem login em outros celulares.

## 3. Criar uma chave de sessão

Gere uma frase aleatória com pelo menos 32 caracteres para `GITHUB_SESSION_SECRET`. Não reutilize o Client secret, a chave privada ou um token pessoal.

## 4. Cadastrar variáveis no Vercel

No projeto Vercel `innyx-webar`, abra **Settings → Environment Variables**. Adicione as variáveis abaixo para **Production**, **Preview** e **Development** conforme necessário:

| Nome | Valor |
| --- | --- |
| `APP_URL` | `https://innyx-webar.vercel.app` |
| `GITHUB_APP_ID` | App ID numérico do GitHub App |
| `GITHUB_APP_SLUG` | Slug de `github.com/apps/SLUG` |
| `GITHUB_CLIENT_ID` | Client ID do GitHub App |
| `GITHUB_CLIENT_SECRET` | Client secret do GitHub App |
| `GITHUB_APP_PRIVATE_KEY` | Conteúdo completo do arquivo `.pem` gerado pelo GitHub |
| `GITHUB_SESSION_SECRET` | Segredo aleatório com no mínimo 32 caracteres |
| `GITHUB_REPO_NAME` | `innyx-webar` |

Os campos de segredo devem ser cadastrados diretamente no painel do Vercel. Não coloque valores secretos no GitHub, no código ou no chat. Depois de salvar as variáveis, faça um novo deploy de produção.

## 5. Entrar

Abra `https://innyx-webar.vercel.app/` e escolha **Continuar com GitHub**. O primeiro acesso autoriza a conta e confirma a instalação do App. Depois disso o portal abre o Workspace. O token de instalação é criado sob demanda, dura pouco tempo e recebe acesso `Contents: Read and write` somente ao repositório instalado.

## Variáveis de ambiente local

Para testar localmente, crie um arquivo `.env.local` fora do Git com as mesmas variáveis e rode o projeto com a Vercel CLI. Nunca publique esse arquivo.
