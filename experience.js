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
  let cameraStartupTimer = 0;
  let cameraFrameTimer = 0;
  let cameraEventHandlers = null;
  let cameraStream = null;
  let cameraBridge = null;
  let cameraBridgeAvailable = false;
  let cameraPreview = null;
  let arViewportHandler = null;
  let nftEventHandlers = null;
  let nftLoadTimer = 0;
  let nftDetectionTimer = 0;
  let restoreNFTVideoEventReplay = null;

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

  function markerDescriptorBase(data) {
    const path = String(data.marker?.descriptorBasePath || '');
    const match = path.match(/^assets\/([a-f0-9-]{36})\/(\d{10,16})\/marker$/i);
    if (!match) return data.marker?.descriptorBaseUrl || '';
    // Read NFT files through the same Vercel origin. The upstream GitHub raw
    // host can serve the GLB directly while its binary NFT responses fail
    // AR.js's descriptor XHR/CORS loading on some mobile browsers.
    return `${location.origin}/api/ar-descriptor/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/marker`;
  }

  async function verifyNFTDescriptors(data) {
    const base = markerDescriptorBase(data);
    if (!base) throw new Error('Este projeto não contém os três arquivos de rastreamento do marcador. Publique-o novamente no Studio.');
    const extensions = ['fset', 'fset3', 'iset'];
    await Promise.all(extensions.map(async (extension) => {
      const response = await fetch(`${base}.${extension}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Arquivo ${extension} indisponível (${response.status}). Publique o marcador novamente no Studio.`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength < 4) throw new Error(`Arquivo ${extension} vazio ou incompleto. Publique o marcador novamente no Studio.`);
    }));
  }

  function cameraErrorMessage(error) {
    const name = error?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'A câmera foi bloqueada. Permita o acesso à câmera para este site nas configurações do navegador e tente novamente.';
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'Nenhuma câmera foi encontrada neste dispositivo.';
    if (name === 'NotReadableError' || name === 'TrackStartError') return 'A câmera está sendo usada por outro aplicativo. Feche-o e tente novamente.';
    if (name === 'OverconstrainedError') return 'A câmera traseira solicitada não está disponível. Verifique o dispositivo e tente novamente.';
    return 'Não foi possível iniciar a câmera. Confira a permissão do navegador e feche outros aplicativos que possam estar usando a câmera.';
  }

  function cleanupCameraEvents() {
    if (cameraStartupTimer) window.clearTimeout(cameraStartupTimer);
    if (cameraFrameTimer) window.clearTimeout(cameraFrameTimer);
    cameraStartupTimer = 0;
    cameraFrameTimer = 0;
    if (!cameraEventHandlers) return;
    window.removeEventListener('camera-init', cameraEventHandlers.onInit);
    window.removeEventListener('camera-error', cameraEventHandlers.onError);
    window.removeEventListener('arjs-video-loaded', cameraEventHandlers.onVideoLoaded);
    cameraEventHandlers = null;
  }

  function restoreCameraBridge() {
    try {
      if (cameraBridge) {
        const { mediaDevices, ownDescriptor } = cameraBridge;
        if (ownDescriptor) Object.defineProperty(mediaDevices, 'getUserMedia', ownDescriptor);
        else delete mediaDevices.getUserMedia;
      }
    } finally {
      cameraBridge = null;
      cameraBridgeAvailable = false;
    }
  }

  function reuseCameraStreamForARJS(stream) {
    const mediaDevices = navigator.mediaDevices;
    try {
      const ownDescriptor = Object.getOwnPropertyDescriptor(mediaDevices, 'getUserMedia');
      const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
      Object.defineProperty(mediaDevices, 'getUserMedia', {
        configurable: true,
        writable: true,
        value: (constraints) => constraints?.video && stream.active
          ? Promise.resolve(stream)
          : originalGetUserMedia(constraints)
      });
      cameraBridge = { mediaDevices, ownDescriptor };
      cameraBridgeAvailable = true;
      return true;
    } catch {
      // A few browsers expose getUserMedia as a non-overridable method. Keep
      // the preview alive while scripts load, then let AR.js request the
      // already-authorized camera through the native API.
      cameraBridgeAvailable = false;
      return false;
    }
  }

  async function requestCameraFromTap() {
    const mediaDevices = navigator.mediaDevices;
    const nativeGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
    const preferred = {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };
    try {
      cameraStream = await nativeGetUserMedia(preferred);
    } catch (error) {
      if (error?.name !== 'OverconstrainedError' && error?.name !== 'NotFoundError') throw error;
      cameraStream = await nativeGetUserMedia({ audio: false, video: true });
    }

    reuseCameraStreamForARJS(cameraStream);
    cameraPreview = document.createElement('video');
    cameraPreview.id = 'innyx-camera-preview';
    cameraPreview.autoplay = true;
    cameraPreview.playsInline = true;
    cameraPreview.muted = true;
    cameraPreview.srcObject = cameraStream;
    styleARVideo(cameraPreview);
    document.body.appendChild(cameraPreview);
    cameraPreview.addEventListener('loadeddata', () => {
      if (!arStarted || cameraPreview?.videoWidth <= 0) return;
      $('ar-loader').classList.add('hidden');
      setARStatus('Câmera ativa · preparando o rastreamento…');
    }, { once: true });
    await cameraPreview.play();
  }

  function styleARVideo(video) {
    Object.assign(video.style, {
      position: 'fixed', inset: '0', width: '100vw', height: '100vh',
      margin: '0', objectFit: 'cover', zIndex: '0', display: 'block'
    });
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.muted = true;
    syncARViewport();
  }

  function syncARViewport() {
    if (!arStarted) return;
    const viewport = window.visualViewport;
    const width = Math.max(1, Math.round(viewport?.width || window.innerWidth));
    const height = Math.max(1, Math.round(viewport?.height || window.innerHeight));
    const left = Math.round(viewport?.offsetLeft || 0);
    const top = Math.round(viewport?.offsetTop || 0);
    const setViewportBox = (element) => {
      if (!element) return;
      element.style.setProperty('position', 'fixed', 'important');
      element.style.setProperty('inset', 'auto', 'important');
      element.style.setProperty('left', `${left}px`, 'important');
      element.style.setProperty('top', `${top}px`, 'important');
      element.style.setProperty('right', 'auto', 'important');
      element.style.setProperty('bottom', 'auto', 'important');
      element.style.setProperty('width', `${width}px`, 'important');
      element.style.setProperty('height', `${height}px`, 'important');
      element.style.setProperty('max-width', 'none', 'important');
      element.style.setProperty('max-height', 'none', 'important');
      element.style.setProperty('margin', '0', 'important');
    };

    setViewportBox(scene);
    setViewportBox(scene?.canvas);
    setViewportBox(document.getElementById('arjs-video'));
    setViewportBox(cameraPreview);
    setViewportBox($('ar-hud'));
    if (scene?.renderer && scene.canvas) scene.renderer.setSize(width, height, false);
  }

  function bindARViewport() {
    if (!arViewportHandler) {
      arViewportHandler = () => window.requestAnimationFrame(syncARViewport);
      window.addEventListener('resize', arViewportHandler, { passive: true });
      window.visualViewport?.addEventListener('resize', arViewportHandler, { passive: true });
      window.visualViewport?.addEventListener('scroll', arViewportHandler, { passive: true });
    }
    syncARViewport();
  }

  function unbindARViewport() {
    if (!arViewportHandler) return;
    window.removeEventListener('resize', arViewportHandler);
    window.visualViewport?.removeEventListener('resize', arViewportHandler);
    window.visualViewport?.removeEventListener('scroll', arViewportHandler);
    arViewportHandler = null;
  }

  function markCameraReady(local, startId) {
    if (!arStarted || startId !== arStartId) return;
    window.clearTimeout(cameraStartupTimer);
    window.clearTimeout(cameraFrameTimer);
    cameraStartupTimer = 0;
    cameraFrameTimer = 0;
    $('ar-loader').classList.add('hidden');
    setARStatus(local ? 'Câmera ativa · buscando posição GPS…' : 'Câmera ativa · aponte para a imagem do marcador.');
  }

  function waitForARVideo(local, startId) {
    let attempts = 0;
    const findVideo = () => {
      if (!arStarted || startId !== arStartId) return;
      const video = document.getElementById('arjs-video');
      if (!video) {
        if (++attempts < 120) window.requestAnimationFrame(findVideo);
        return;
      }
      styleARVideo(video);
      const checkFrame = () => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          if (cameraPreview) {
            cameraPreview.srcObject = null;
            cameraPreview.remove();
            cameraPreview = null;
          }
          markCameraReady(local, startId);
          return;
        }
        cameraFrameTimer = window.setTimeout(checkFrame, 200);
      };
      const playResult = video.play();
      if (playResult?.catch) playResult.catch((error) => {
        if (arStarted && startId === arStartId) failAR(cameraErrorMessage(error));
      });
      checkFrame();
    };
    findVideo();
  }

  function watchCameraStartup(local, startId) {
    cleanupCameraEvents();
    const onInit = () => waitForARVideo(local, startId);
    const onVideoLoaded = () => {
      const video = document.getElementById('arjs-video');
      if (video) styleARVideo(video);
      if (video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        if (cameraPreview) {
          cameraPreview.srcObject = null;
          cameraPreview.remove();
          cameraPreview = null;
        }
        markCameraReady(local, startId);
      }
    };
    const onError = (event) => {
      if (!arStarted || startId !== arStartId) return;
      failAR(cameraErrorMessage(event.error || event.detail?.error || event));
    };
    cameraEventHandlers = { onInit, onError, onVideoLoaded };
    window.addEventListener('camera-init', onInit);
    window.addEventListener('camera-error', onError);
    window.addEventListener('arjs-video-loaded', onVideoLoaded);
    cameraStartupTimer = window.setTimeout(() => {
      if (arStarted && startId === arStartId) {
        failAR('A câmera não enviou imagem. Permita o acesso à câmera e tente novamente; se a permissão já estiver ativa, feche outros aplicativos que a estejam usando.');
      }
    }, 20000);
  }

  function attachARScene(data) {
    const local = data.mode === 'location';
    const startId = arStartId;
    if (!cameraBridgeAvailable && cameraStream) {
      if (cameraPreview) {
        cameraPreview.srcObject = null;
        cameraPreview.remove();
        cameraPreview = null;
      }
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    watchCameraStartup(local, startId);
    if (!local) restoreNFTVideoEventReplay = window.installNFTVideoEventReplay(window);
    scene = document.createElement('a-scene');
    scene.className = 'ar-scene';
    scene.setAttribute('embedded', '');
    scene.setAttribute('vr-mode-ui', 'enabled: false');
    scene.setAttribute('renderer', 'antialias: true; alpha: true; logarithmicDepthBuffer: true');
    scene.addEventListener('renderstart', () => {
      scene.renderer?.setClearColor(0x000000, 0);
      scene.renderer?.setClearAlpha(0);
      syncARViewport();
    }, { once: true });
    scene.setAttribute('arjs', local
      ? 'sourceType: webcam; videoTexture: true; debugUIEnabled: false'
      : 'trackingMethod: best; sourceType: webcam; debugUIEnabled: false');
    let nftTrackerReady = false;
    const onNFTLoaded = () => {
      if (nftTrackerReady || !arStarted || startId !== arStartId) return;
      nftTrackerReady = true;
      restoreNFTVideoEventReplay?.();
      restoreNFTVideoEventReplay = null;
      window.clearTimeout(nftLoadTimer);
      nftLoadTimer = 0;
      if (markerVisible) setARStatus('Marcador identificado · modelo 3D carregado.');
      else if (modelReady) setARStatus('Rastreador e modelo prontos · enquadre a imagem inteira do marcador.');
      else setARStatus('Rastreador pronto · carregando o modelo 3D…');
      nftDetectionTimer = window.setTimeout(() => {
        if (!arStarted || startId !== arStartId || markerVisible || modelAnchored) return;
        setARStatus('Rastreador pronto, mas ainda sem detectar. Aproxime e mantenha o marcador inteiro, nítido e bem iluminado na câmera.');
      }, 15000);
    };
    if (!local) {
      // AR.js dispatches arjs-nft-loaded on window. Keep the scene listener too
      // for compatible builds that dispatch it from the scene element.
      window.addEventListener('arjs-nft-loaded', onNFTLoaded);
      scene.addEventListener('arjs-nft-loaded', onNFTLoaded);
      nftEventHandlers = { onNFTLoaded, scene };
      nftLoadTimer = window.setTimeout(() => {
        if (!arStarted || startId !== arStartId || nftTrackerReady) return;
        setARStatus('Os arquivos do marcador foram lidos, mas o rastreador AR.js não iniciou. Feche a câmera e tente novamente.');
      }, 25000);
    }

    const camera = document.createElement(local ? 'a-camera' : 'a-entity');
    if (local) {
      camera.setAttribute('gps-new-camera', 'gpsMinDistance: 5');
      camera.setAttribute('rotation', '0 0 0');
    } else camera.setAttribute('camera', '');
    scene.appendChild(camera);
    // Keep the retained object in Three.js space. Moving an A-Frame entity in
    // the DOM destroys its gltf-model component and removes the loaded mesh.
    const anchoredObject = !local ? new THREE.Group() : null;
    if (anchoredObject) {
      anchoredObject.visible = false;
      camera.object3D.add(anchoredObject);
    }

    const model = document.createElement('a-entity');
    model.setAttribute('gltf-model', `url(${data.model.url})`);
    const factor = Math.max(0.1, Math.min(3, Number(data.model.scale) || 1));
    let target = null;
    let markerRecognized = false;
    let markerVisible = false;
    let modelReady = false;
    let modelAnchored = false;
    let modelCentered = false;
    let modelUpright = false;
    let modelBaseDimension = 0;
    let markerMetrics = null;
    const markerImage = $('marker-preview').querySelector('img');
    markerMetrics = {
      width: (markerImage?.naturalWidth || 480) / 72 * 25.4,
      height: (markerImage?.naturalHeight || 480) / 72 * 25.4
    };
    const modelLoadTimer = window.setTimeout(() => {
      if (!modelReady && arStarted) {
        setARStatus(markerRecognized
          ? 'Marcador identificado · o GLB ainda está sendo baixado. Mantenha esta tela aberta.'
          : 'Baixando o modelo 3D · aguarde antes de apontar para o marcador.');
      }
    }, 5000);

    model.addEventListener('model-loaded', () => {
      window.clearTimeout(modelLoadTimer);
      modelReady = true;
      if (!local) {
        const gltf = model.getObject3D('mesh');
        if (gltf) {
          let meshCount = 0;
          gltf.traverse((node) => { if (node.isMesh) meshCount += 1; });
          if (meshCount === 0) {
            modelReady = false;
            console.error('[InnyxWebAR] GLB carregado sem malhas renderizáveis.');
            setARStatus('O GLB foi aberto, mas não contém malhas 3D renderizáveis.');
            return;
          }
        }
        fitModelToMarker();
        scheduleModelFit();
        model.object3D.visible = true;
        if (markerVisible) {
          installModelGestures();
          setARStatus('Marcador identificado · 1 dedo gira; pinça ajusta a escala.');
        }
        else if (markerRecognized) retainModelInScene();
        else if (nftTrackerReady) setARStatus('Rastreador e modelo prontos · enquadre a imagem inteira do marcador.');
        else setARStatus('Modelo 3D carregado · preparando os descritores do marcador…');
      }
    });
    model.addEventListener('model-error', (event) => {
      window.clearTimeout(modelLoadTimer);
      const reason = event.detail?.src || event.detail?.error?.message || 'resposta inválida do arquivo';
      console.error('[InnyxWebAR] Falha ao carregar GLB:', reason, event.detail);
      setARStatus('Falha ao carregar o GLB. Verifique a conexão do celular e se o arquivo está público no GitHub.');
    });

    function fitModelToMarker() {
      if (!markerMetrics || !modelReady) return false;
      const gltf = model.getObject3D('mesh');
      if (!gltf) return false;
      const previousScale = model.object3D.scale.clone();
      model.object3D.scale.setScalar(1);
      model.object3D.updateMatrixWorld(true);
      gltf.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(gltf);
      if (bounds.isEmpty()) {
        model.object3D.scale.copy(previousScale);
        return false;
      }
      if (!modelUpright) {
        const rawSize = bounds.getSize(new THREE.Vector3());
        const verticalThreshold = 1.15;
        if (rawSize.x > rawSize.y * verticalThreshold && rawSize.x >= rawSize.z) {
          model.setAttribute('rotation', `0 0 90`);
        } else if (rawSize.z > rawSize.y * verticalThreshold && rawSize.z > rawSize.x) {
          model.setAttribute('rotation', `-90 0 0`);
        }
        modelUpright = true;
        model.object3D.updateMatrixWorld(true);
        gltf.updateMatrixWorld(true);
        bounds.setFromObject(gltf);
      }
      if (!modelCentered) {
        const center = model.object3D.worldToLocal(bounds.getCenter(new THREE.Vector3()));
        gltf.position.sub(center);
        modelCentered = true;
        model.object3D.updateMatrixWorld(true);
        gltf.updateMatrixWorld(true);
        bounds.setFromObject(gltf);
      }
      const size = bounds.getSize(new THREE.Vector3());
      modelBaseDimension = Math.max(size.x, size.y, size.z);
      if (!(modelBaseDimension > 0) || !Number.isFinite(modelBaseDimension)) {
        model.object3D.scale.copy(previousScale);
        return false;
      }
      const targetSize = Math.min(markerMetrics.width, markerMetrics.height) * 0.2 * factor;
      const fittedScale = Math.max(0.001, Math.min(100, targetSize / modelBaseDimension));
      model.setAttribute('scale', `${fittedScale} ${fittedScale} ${fittedScale}`);
      // AR.js NFT image coordinates start at an edge; its official example
      // places centered content at half the physical image width and height.
      model.setAttribute('position', `${markerMetrics.width / 2} ${markerMetrics.height / 2} 0`);
      return true;
    }

    function scheduleModelFit(attempt = 0) {
      if (attempt >= 20) return;
      window.requestAnimationFrame(() => {
        if (!arStarted || !modelReady || local) return;
        if (!fitModelToMarker()) scheduleModelFit(attempt + 1);
      });
    }

    function applyNFTMarkerMetrics(event) {
      const { width, height, dpi } = event.detail || {};
      const numericWidth = Number(width);
      const numericHeight = Number(height);
      const numericDpi = Number(dpi);
      if (!(numericWidth > 0 && numericHeight > 0 && numericDpi > 0)) return;
      // AR.js NFT coordinates use millimeters, as in its official Three.js example.
      markerMetrics = {
        width: numericWidth / numericDpi * 25.4,
        height: numericHeight / numericDpi * 25.4
      };
      fitModelToMarker();
    }

    function retainModelInScene() {
      if (local || !markerRecognized || !modelReady || modelAnchored || markerVisible) return;
      if (!model.object3D.parent || !scene?.object3D) return;
      scene.object3D.updateMatrixWorld(true);
      model.object3D.updateMatrixWorld(true);
      // Keep the last marker pose in scene coordinates. The model follows the
      // marker while tracked, then remains at that world-space pose when lost.
      scene.object3D.attach(model.object3D);
      model.object3D.visible = true;
      modelAnchored = true;
      installModelGestures();
      setARStatus('Modelo fixado na posição do marcador · 1 dedo gira; pinça ajusta a escala.');
    }

    function installModelGestures() {
      const canvas = scene.canvas;
      if (!canvas || canvas.dataset.innyxGestures === 'true') return;
      canvas.dataset.innyxGestures = 'true';
      canvas.style.touchAction = 'none';
      const pointers = new Map();
      let pinchStartDistance = 0;
      let pinchStartScale = 1;
      const distance = () => {
        const points = [...pointers.values()];
        if (points.length < 2) return 0;
        return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      };
      const center = () => {
        const points = [...pointers.values()];
        return points.length
          ? points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 })
          : null;
      };
      canvas.addEventListener('pointerdown', (event) => {
        if (!markerRecognized) return;
        event.preventDefault();
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size === 2) {
          pinchStartDistance = distance();
          pinchStartScale = model.object3D.scale.x;
        }
        canvas.setPointerCapture?.(event.pointerId);
      }, { passive: false });
      canvas.addEventListener('pointermove', (event) => {
        const previous = pointers.get(event.pointerId);
        if (!previous) return;
        event.preventDefault();
        const before = center();
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const after = center();
        if (pointers.size === 1) {
          model.object3D.rotation.y += (event.clientX - previous.x) * 0.01;
          model.object3D.rotation.x += (event.clientY - previous.y) * 0.01;
        } else if (before && after) {
          const fov = Number(camera.getAttribute('camera')?.fov) || 80;
          const cameraDistance = Math.max(0.5, Math.abs(model.object3D.position.z));
          const worldUnitsPerPixel = (2 * cameraDistance * Math.tan((fov * Math.PI) / 360)) / Math.max(1, window.innerHeight);
          model.object3D.position.x += (after.x - before.x) * worldUnitsPerPixel;
          model.object3D.position.y -= (after.y - before.y) * worldUnitsPerPixel;
          const currentDistance = distance();
          if (pinchStartDistance > 0 && currentDistance > 0) {
            const scale = THREE.MathUtils.clamp(pinchStartScale * currentDistance / pinchStartDistance, 0.01, 100);
            model.object3D.scale.setScalar(scale);
          }
        }
      }, { passive: false });
      const releasePointer = (event) => {
        pointers.delete(event.pointerId);
        if (pointers.size < 2) {
          pinchStartDistance = 0;
          if (pointers.size === 1) pinchStartScale = model.object3D.scale.x;
        }
        if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      };
      canvas.addEventListener('pointerup', releasePointer);
      canvas.addEventListener('pointercancel', releasePointer);
    }

    if (local) {
      const locationData = data.location || {};
      const place = `latitude: ${Number(locationData.latitude)}; longitude: ${Number(locationData.longitude)}`;
      model.setAttribute('gps-new-entity-place', place);
      model.setAttribute('position', `0 ${Number(locationData.altitude) || 0} 0`);
      model.setAttribute('scale', `${factor} ${factor} ${factor}`);
    } else {
      window.addEventListener('arjs-nft-init-data', applyNFTMarkerMetrics);
      nftEventHandlers = { ...nftEventHandlers, onNFTInitData: applyNFTMarkerMetrics };
      model.setAttribute('position', `${markerMetrics.width / 2} ${markerMetrics.height / 2} 0`);
      model.setAttribute('scale', '1 1 1');
      target = document.createElement('a-nft');
      target.setAttribute('type', 'nft');
      target.setAttribute('url', markerDescriptorBase(data));
      target.setAttribute('emitevents', 'true');
      target.setAttribute('smooth', 'true');
      target.setAttribute('smoothCount', '10');
      target.setAttribute('smoothTolerance', '0.01');
      target.setAttribute('smoothThreshold', '5');
      target.addEventListener('markerFound', () => {
        if (modelAnchored) return;
        window.clearTimeout(nftDetectionTimer);
        nftDetectionTimer = 0;
        markerRecognized = true;
        markerVisible = true;
        model.object3D.visible = true;
        installModelGestures();
        setARStatus(modelReady
          ? 'Marcador identificado · 1 dedo gira; pinça ajusta a escala.'
          : 'Marcador identificado · carregando o modelo 3D…');
      });
      target.addEventListener('markerLost', () => {
        markerVisible = false;
        if (modelReady) retainModelInScene();
        else if (markerRecognized) setARStatus('Marcador saiu do quadro · aguardando o GLB terminar de carregar.');
      });
      target.appendChild(model);
      scene.appendChild(target);
    }
    if (data.model.animation) model.setAttribute('animation-mixer', `clip: ${data.model.animation}; loop: repeat`);
    if (local) scene.insertBefore(model, camera);
    document.body.appendChild(scene);
    window.requestAnimationFrame(syncARViewport);
  }

  function failAR(message) {
    $('ar-loader').classList.add('hidden');
    stopAR();
    $('start-ar').disabled = false;
    showStatus(message, true);
  }

  function stopAR() {
    arStartId += 1;
    cleanupCameraEvents();
    restoreNFTVideoEventReplay?.();
    restoreNFTVideoEventReplay = null;
    restoreCameraBridge();
    unbindARViewport();
    if (nftEventHandlers) {
      window.removeEventListener('arjs-nft-loaded', nftEventHandlers.onNFTLoaded);
      if (nftEventHandlers.onNFTInitData) window.removeEventListener('arjs-nft-init-data', nftEventHandlers.onNFTInitData);
      nftEventHandlers.scene?.removeEventListener('arjs-nft-loaded', nftEventHandlers.onNFTLoaded);
      nftEventHandlers = null;
    }
    window.clearTimeout(nftLoadTimer);
    window.clearTimeout(nftDetectionTimer);
    nftLoadTimer = 0;
    nftDetectionTimer = 0;
    document.querySelectorAll('video').forEach((video) => {
      video.srcObject?.getTracks?.().forEach((track) => track.stop());
      video.srcObject = null;
      video.remove();
    });
    cameraStream?.getTracks?.().forEach((track) => track.stop());
    cameraStream = null;
    cameraPreview = null;
    scene?.remove();
    scene = null;
    arStarted = false;
    document.body.classList.remove('ar-active');
    document.documentElement.classList.remove('ar-active');
    $('ar-hud').classList.add('hidden');
    $('ar-loader').classList.add('hidden');
  }

  async function startAR() {
    if (!window.isSecureContext) return showStatus('A câmera exige HTTPS. Abra este link pelo domínio publicado na Vercel.', true);
    if (!navigator.mediaDevices?.getUserMedia) return showStatus('Este navegador não oferece câmera WebRTC para WebAR.', true);
    $('start-ar').disabled = true;
    $('ar-loader').classList.remove('hidden');
    $('ar-hud').classList.remove('hidden');
    document.documentElement.classList.add('ar-active');
    document.body.classList.add('ar-active');
    bindARViewport();
    arStarted = true;
    const startId = ++arStartId;
    try {
      setARStatus('Solicitando acesso à câmera…');
      await requestCameraFromTap();
      if (!arStarted || startId !== arStartId) return;
      if (manifest.mode !== 'location') {
        setARStatus('Câmera ativa · conferindo os arquivos do marcador…');
        await verifyNFTDescriptors(manifest);
      }
      if (!arStarted || startId !== arStartId) return;
      await loadScript('https://aframe.io/releases/1.6.0/aframe.min.js');
      if (manifest.mode === 'location') {
        await loadScript('https://raw.githack.com/AR-js-org/AR.js/3.4.8/three.js/build/ar-threex-location-only.js');
        await loadScript('https://raw.githack.com/AR-js-org/AR.js/3.4.8/aframe/build/aframe-ar.js');
      } else {
        await loadScript('https://raw.githack.com/AR-js-org/AR.js/3.4.8/aframe/build/aframe-ar-nft.js');
      }
      if (manifest.model.animation) await loadScript('https://cdn.jsdelivr.net/npm/aframe-extras@7.5.0/dist/aframe-extras.min.js');
      if (!arStarted || startId !== arStartId) return;
      attachARScene(manifest);
    } catch (error) {
      const cameraErrors = ['NotAllowedError', 'SecurityError', 'NotFoundError', 'DevicesNotFoundError', 'NotReadableError', 'TrackStartError', 'OverconstrainedError'];
      failAR(cameraErrors.includes(error?.name) ? cameraErrorMessage(error) : error.message || 'Erro ao iniciar a experiência WebAR.');
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
