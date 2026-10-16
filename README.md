# InnyxWebAR Studio

Studio WebAR da INNYX para criar experiências Marker Based e Local Based, escolher animações GLB e compartilhar visualizações que funcionam pelo navegador do celular.

## Abrir o portal

- Portal: [innyx-webar.vercel.app](https://innyx-webar.vercel.app/)
- Código e projetos publicados: [VictorSicsu/innyx-webar](https://github.com/VictorSicsu/innyx-webar)
- Visualizador de uma experiência: `https://innyx-webar.vercel.app/experience.html?id=ID_DO_PROJETO`

## Conectar o GitHub

O portal salva rascunhos no navegador. Para publicar e sincronizar entre dispositivos:

1. Crie um token **fine-grained** no GitHub com owner `VictorSicsu`, acesso somente ao repositório `innyx-webar` e permissão **Contents: Read and write**.
2. No portal, escolha **Conectar GitHub** e cole o token. O token fica somente na memória da página aberta e é enviado diretamente à API do GitHub. Ao recarregar ou fechar a página, conecte novamente.
3. Crie ou abra um projeto e escolha **Salvar e publicar**. O portal grava os arquivos e o manifesto no repositório em um commit.
4. Copie o link **Abrir experiência** da linha do projeto e envie para o celular. Ao conectar o GitHub em outro dispositivo, use o botão do cabeçalho para sincronizar a lista.

O repositório é público. GLBs, imagens, descritores e manifestos publicados ficam visíveis para qualquer pessoa e podem ser baixados. Commits em `main` iniciam o deploy automático da Vercel; cada publicação de projeto também atualiza o conteúdo servido pelo domínio.

## Tipos de experiência

### Marker Based

A câmera detecta uma imagem natural sem a borda preta do Hiro. Envie uma imagem com detalhes variados e gere os três descritores NFT `.fset`, `.fset3` e `.iset` no [gerador oficial do AR.js](https://ar-js-org.github.io/AR.js/three.js/examples/marker-training/examples/generator.html). Carregue os três arquivos no projeto junto com o GLB.

### Local Based

Escolha ou informe latitude e longitude. A opção **Usar minha localização** lê as coordenadas do dispositivo atual; para publicar um local distante, edite os números depois. A altura relativa opcional posiciona o modelo acima ou abaixo do nível da câmera. O celular precisa permitir câmera, localização e orientação.

### Modelo

Envie um GLB de até 50 MiB, selecione uma animação existente e ajuste a escala. Otimize modelos grandes para carregar com rapidez em conexões móveis.

## Dados e limites

- Rascunhos locais e arquivos de edição ficam no IndexedDB do navegador.
- A lista publicada é lida do repositório depois que você conecta o GitHub. Quando abre um projeto sincronizado para edição, os assets são baixados sob demanda.
- O limite de envio no portal é 50 MiB por GLB. O GitHub avisa para arquivos maiores que 50 MiB e bloqueia arquivos acima de 100 MiB em repositórios Git comuns. Os binários permanecem no histórico dos commits; prefira GLBs otimizados.
- Permissões de câmera e GPS exigem HTTPS. A compatibilidade depende do navegador e dos sensores do dispositivo. O [AR.js Docs](https://ar-js-org.github.io/AR.js-Docs/) descreve os tipos suportados e limitações conhecidas de orientação/GPS.

O runtime usa A-Frame 1.6.0 e AR.js 3.4.7. O portal é HTML, CSS e JavaScript estáticos, servido pelo projeto Vercel vinculado ao repositório.

