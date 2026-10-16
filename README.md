# InnyxWebAR Studio

Portal responsivo para preparar experiências WebAR com a identidade INNYX, modelos GLB animados e rastreamento por imagem natural usando NFT do AR.js. O editor permite organizar projetos, escolher animações e escala do modelo, exportar/importar backup e baixar cada experiência como pacote independente.

## Abrir e publicar

O projeto está publicado em [innyx-webar.vercel.app](https://innyx-webar.vercel.app/) e conectado ao repositório [VictorSicsu/innyx-webar](https://github.com/VictorSicsu/innyx-webar). O projeto Vercel `innyx-webar` acompanha a branch `main`; commits nessa branch iniciam novos deploys. O portal é HTML, CSS e JavaScript estáticos e o endereço HTTPS permite abrir experiências em navegadores móveis que suportam câmera e WebGL.

## Marcadores e GLB

O painel aceita uma imagem natural para marcador, arquivo GLB e os descritores `.fset`, `.fset3` e `.iset`. Gere os descritores no [gerador oficial do AR.js](https://ar-js-org.github.io/AR.js/three.js/examples/marker-training/examples/generator.html), depois carregue-os na experiência. Use **Baixar experiência** para criar um pacote ZIP com os assets e um visualizador AR.js pronto para HTTPS. A seleção da animação e a escala ficam configuradas no pacote.

O rastreamento NFT dispensa o quadro preto do Hiro, mas precisa dos descritores extraídos da imagem. O preview do modelo usa [`model-viewer`](https://modelviewer.dev/). O pacote exportado usa o runtime de [image tracking do AR.js](https://ar-js-org.github.io/AR.js-Docs/image-tracking/).

## Estado dos dados

Esta versão salva projetos e arquivos no IndexedDB do navegador e permite backups JSON. Assim, a interface pode ser aberta em diferentes dispositivos, mas o conteúdo salvo em um dispositivo não é sincronizado automaticamente com os outros.

O repositório GitHub guarda o código do portal. Com o repositório conectado à Vercel, alterações de código enviadas para `main` geram um novo deploy automaticamente. Os projetos e uploads feitos dentro do portal continuam locais a cada navegador; sincronizá-los entre dispositivos exige armazenamento remoto e autenticação de administrador, que não fazem parte desta versão.

