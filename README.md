# InnyxWebAR Studio

Studio WebAR da INNYX para criar experiências Marker Based e Local Based, escolher animações GLB e compartilhar visualizações que funcionam pelo navegador do celular.

O login GitHub usa um GitHub App instalado somente no repositório público `innyx-webar`. Antes de ativar o login em uma nova instalação, siga o guia [GITHUB_APP_SETUP.md](./GITHUB_APP_SETUP.md) e cadastre os segredos no projeto Vercel.

## Abrir o portal

- Portal: [innyx-webar.vercel.app](https://innyx-webar.vercel.app/)
- Código e projetos publicados: [VictorSicsu/innyx-webar](https://github.com/VictorSicsu/innyx-webar)
- Visualizador de uma experiência: `https://innyx-webar.vercel.app/experience.html?id=ID_DO_PROJETO`

## Conectar o GitHub

O portal salva rascunhos no navegador. Para publicar e sincronizar entre dispositivos:

1. Configure o GitHub App e as variáveis Vercel seguindo [GITHUB_APP_SETUP.md](./GITHUB_APP_SETUP.md).
2. Entre pelo botão **Continuar com GitHub** e instale o App somente no repositório público `innyx-webar` da sua conta.
3. Crie ou abra um projeto e escolha **Salvar e publicar**. O portal grava arquivos e manifesto no repositório em um commit.
4. Copie o link **Abrir experiência** e envie para o celular. A página da experiência é pública e não exige login.

O repositório é público. GLBs, imagens, descritores e manifestos publicados ficam visíveis para qualquer pessoa e podem ser baixados. Commits em `main` iniciam o deploy automático da Vercel; cada publicação de projeto também atualiza o conteúdo servido pelo domínio.

## Tipos de experiência

### Marker Based

A câmera detecta uma imagem natural sem a borda preta do Hiro. Ao selecionar a imagem no projeto, o portal prepara automaticamente os descritores `.fset`, `.fset3` e `.iset` usando o gerador oficial do AR.js, diretamente no navegador. “NFT” aqui significa *Natural Feature Tracking* (rastreamento de características naturais), não um token. Os descritores são necessários apenas em projetos Marker Based; Local Based usa GPS e não precisa deles.

### Local Based

Escolha ou informe latitude e longitude. A opção **Usar minha localização** lê as coordenadas do dispositivo atual; para publicar um local distante, edite os números depois. A altura relativa opcional posiciona o modelo acima ou abaixo do nível da câmera. O celular precisa permitir câmera, localização e orientação.

### Modelo

Envie um GLB de até 50 MiB, selecione uma animação existente e ajuste a escala. Otimize modelos grandes para carregar com rapidez em conexões móveis.

## Dados e limites

- Rascunhos locais e arquivos de edição ficam no IndexedDB do navegador.
- A lista publicada é lida do repositório da conta conectada. Rascunhos não publicados continuam no navegador que os criou. Quando abre um projeto sincronizado para edição, os assets são baixados sob demanda.
- O limite de envio no portal é 50 MiB por GLB. O GitHub avisa para arquivos maiores que 50 MiB e bloqueia arquivos acima de 100 MiB em repositórios Git comuns. Os binários permanecem no histórico dos commits; prefira GLBs otimizados.
- Permissões de câmera e GPS exigem HTTPS. A compatibilidade depende do navegador e dos sensores do dispositivo. O [AR.js Docs](https://ar-js-org.github.io/AR.js-Docs/) descreve os tipos suportados e limitações conhecidas de orientação/GPS.

O runtime usa A-Frame 1.6.0 e AR.js 3.4.7. O portal é HTML, CSS e JavaScript estáticos, servido pelo projeto Vercel vinculado ao repositório.
