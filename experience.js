(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || location.pathname.match(/^\/p\/([^/]+)/)?.[1] || '';
  const safeSegment = (value, fallback) => /^[A-Za-z0-9_.-]{1,100}$/.test(value || '') ? value : fallback;
  const OWNER = safeSegment(params.get('owner'), 'VictorSicsu');
  const REPO = safeSegment(params.get('repo'), 'innyx-webar');
  const BRANCH = 'main';
  const rawBase = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;
  let manifest;
  let scene;
  let arStarted = false;
  let arStartId = 0;

  function showStatus(message, error = false) {
    const status = $('viewer-status');
    status.classList.toggle('error', error);
    status.innerHTML = error ? '' : '<span class="spinner"></span>';
    const label = document.createElement('span');
    label.textContent = message;
    status.appendChild(label);
  }

  function manifestUrl() {
    const safeId = encodeURIComponent(id);
    return `${rawBase}/experiences/${safeId}.json?v=${Date.now()}`;
  }

  async function loadManifest() {
    if (!id) throw new Error('Este link não contém o código da experiência.');
    const response = await fetch(manifestUrl(), { cache: 'no-store' });
    if (response.status === 404) throw new Error('Experiência não encontrada. Confirme se o projeto continua publicado.');
    if (!response.ok) throw new Error('Não foi possível carregar os dados publicados no GitHub.');
    const data = await response.json();
    if (data.format !== 'innyx-webar-experience' || !data.model?.url) throw new Error('O manifesto desta experiência está incompleto.');
    return data;
  }

  function setupCard(data) {
    $('experience-title').textContent = data.name || 'Experiência INNYX';
    const local = data.mode === 'location';
    $('experience-description').textContent = local
      ? 'O modelo está posicionado em um ponto real. Vá até as coordenadas e abra a câmera.'
      : 'A câmera reconhecerá a imagem do marcador e mostrará o modelo 3D por cima dela.';
    $('experience-meta').innerHTML = '';
    const chips = [local ? 'Local Based · GPS' : 'Marker Based · NFT'];
    if (data.model.animation) chips.push(`Animação · ${data.model.animation}`);
    if (local && data.location) chips.push(`${Number(data.location.latitude).toFixed(5)}, ${Number(data.location.longitude).toFixed(5)}`);
    chips.forEach((label) => {
      const chip = document.createElement('span');
      chip.className = 'meta-chip';
      chip.textContent = label;
      $('experience-meta').appendChild(chip);
    });
    $('permission-copy').textContent = local
      ? 'Ao iniciar, o navegador solicitará acesso à câmera e à localização. A experiência precisa estar próxima do ponto GPS publicado.'
      : 'Ao iniciar, o navegador solicitará acesso à câmera. Aponte para a imagem cadastrada, sem adicionar uma borda preta.';
    if (!local && data.marker?.imageUrl) {
      const image = document.createElement('img');
      image.src = data.marker.imageUrl;
      image.alt = `Imagem de referência do marcador para ${data.name}`;
      $('marker-preview').appendChild(image);
    }
    $('start-ar').disabled = false;
    showStatus('Pronto para iniciar no celular.');
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find((script) => script.src === src);
      if (existing?.dataset.loaded === 'true') return resolve();
      const script = existing || document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
      script.onerror = () => reject(new Error('Não foi possível carregar o runtime AR. Confira a conexão e tente novamente.'));
      if (!existing) document.head.appendChild(script);
    });
  }

  function setARStatus(message) {
    $('ar-hint').textContent = message;
  }

  function attachARScene(data) {
    const local = data.mode === 'location';
    scene = document.createElement('a-scene');
    scene.className = 'ar-scene';
    scene.setAttribute('embedded', '');
    scene.setAttribute('vr-mode-ui', 'enabled: false');
    scene.setAttribute('renderer', 'antialias: true; alpha: true; logarithmicDepthBuffer: true');
    scene.setAttribute('arjs', local
      ? 'sourceType: webcam; videoTexture: true; debugUIEnabled: false'
      : 'trackingMethod: best; sourceType: webcam; debugUIEnabled: false');
    scene.addEventListener('camera-init', () => {
      $('ar-loader').classList.add('hidden');
      setARStatus(local ? 'AR ativo · aproxime-se do ponto publicado.' : 'Aponte a câmera para a imagem do marcador.');
    }, { once: true });
    scene.addEventListener('camera-error', () => failAR('Não foi possível iniciar a câmera. Verifique a permissão do navegador e tente novamente.'), { once: true });
    scene.addEventListener('arjs-nft-loaded', () => {
      $('ar-loader').classList.add('hidden');
      setARStatus('Imagem reconhecida · mova o celular lentamente para enquadrar.');
    }, { once: true });
    scene.addEventListener('loaded', () => {
      window.setTimeout(() => {
        if (arStarted && !$('ar-loader').classList.contains('hidden')) {
          $('ar-loader').classList.add('hidden');
          setARStatus(local ? 'Buscando posição GPS…' : 'Câmera ativa · aponte para a imagem do marcador.');
        }
      }, 9000);
    }, { once: true });

    const camera = document.createElement(local ? 'a-camera' : 'a-entity');
    if (local) {
      camera.setAttribute('gps-new-camera', 'gpsMinDistance: 5');
      camera.setAttribute('rotation', '0 0 0');
    } else camera.setAttribute('camera', '');
    scene.appendChild(camera);

    const model = document.createElement('a-entity');
    model.setAttribute('gltf-model', `url(${data.model.url})`);
    const factor = Math.max(0.1, Math.min(3, Number(data.model.scale) || 1));
    if (local) {
      const locationData = data.location || {};
      const place = `latitude: ${Number(locationData.latitude)}; longitude: ${Number(locationData.longitude)}`;
      model.setAttribute('gps-new-entity-place', place);
      model.setAttribute('position', `0 ${Number(locationData.altitude) || 0} 0`);
      model.setAttribute('scale', `${factor} ${factor} ${factor}`);
    } else {
      model.setAttribute('position', '50 150 0');
      const size = factor * 0.05;
      model.setAttribute('scale', `${size} ${size} ${size}`);
      const target = document.createElement('a-nft');
      target.setAttribute('type', 'nft');
      target.setAttribute('url', data.marker?.descriptorBaseUrl || '');
      target.setAttribute('smooth', 'true');
      target.setAttribute('smoothCount', '10');
      target.setAttribute('smoothTolerance', '0.01');
      target.setAttribute('smoothThreshold', '5');
      target.appendChild(model);
      scene.appendChild(target);
    }
    if (data.model.animation) model.setAttribute('animation-mixer', `clip: ${data.model.animation}; loop: repeat`);
    if (local) scene.insertBefore(model, camera);
    document.body.appendChild(scene);
  }

  function failAR(message) {
    $('ar-loader').classList.add('hidden');
    stopAR();
    $('start-ar').disabled = false;
    showStatus(message, true);
  }

  function stopAR() {
    arStartId += 1;
    document.querySelectorAll('video').forEach((video) => {
      video.srcObject?.getTracks?.().forEach((track) => track.stop());
      video.srcObject = null;
    });
    scene?.remove();
    scene = null;
    arStarted = false;
    document.body.classList.remove('ar-active');
    $('ar-hud').classList.add('hidden');
    $('ar-loader').classList.add('hidden');
  }

  async function startAR() {
    if (!window.isSecureContext) return showStatus('A câmera exige HTTPS. Abra este link pelo domínio publicado na Vercel.', true);
    if (!navigator.mediaDevices?.getUserMedia) return showStatus('Este navegador não oferece câmera WebRTC para WebAR.', true);
    $('start-ar').disabled = true;
    $('ar-loader').classList.remove('hidden');
    $('ar-hud').classList.remove('hidden');
    document.body.classList.add('ar-active');
    arStarted = true;
    const startId = ++arStartId;
    try {
      await loadScript('https://aframe.io/releases/1.6.0/aframe.min.js');
      if (manifest.mode === 'location') {
        await loadScript('https://cdn.jsdelivr.net/gh/AR-js-org/AR.js@3.4.7/three.js/build/ar-threex-location-only.js');
        await loadScript('https://cdn.jsdelivr.net/gh/AR-js-org/AR.js@3.4.7/aframe/build/aframe-ar.js');
      } else {
        await loadScript('https://cdn.jsdelivr.net/gh/AR-js-org/AR.js@3.4.7/aframe/build/aframe-ar-nft.js');
      }
      if (manifest.model.animation) await loadScript('https://cdn.jsdelivr.net/npm/aframe-extras@7.5.0/dist/aframe-extras.min.js');
      if (!arStarted || startId !== arStartId) return;
      attachARScene(manifest);
    } catch (error) {
      failAR(error.message || 'Erro ao iniciar a experiência WebAR.');
    }
  }

  $('start-ar').addEventListener('click', startAR);
  $('exit-ar').addEventListener('click', () => {
    stopAR();
    $('start-ar').disabled = false;
    showStatus('Experiência pausada. Toque em iniciar para voltar à câmera.');
  });

  loadManifest().then((data) => {
    manifest = data;
    document.title = `${data.name || 'Experiência'} · INNYX WebAR`;
    setupCard(data);
  }).catch((error) => {
    $('experience-title').textContent = 'Link indisponível';
    $('experience-description').textContent = error.message;
    $('start-ar').disabled = true;
    showStatus(error.message, true);
  });
})();
