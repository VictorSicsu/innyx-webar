(() => {
  const OWNER = 'VictorSicsu';
  const REPO = 'innyx-webar';
  const BRANCH = 'main';
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;
  const $ = (id) => document.getElementById(id);
  const githubDialog = $('github-dialog');
  let token = '';
  let connectedUser = '';
  let pendingPublishId = '';
  let cloudDb;

  function say(message) {
    if (typeof window.notify === 'function') window.notify(message);
    else {
      const toast = $('toast');
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3200);
    }
  }

  const DEPLOY_ESTIMATES_KEY = 'innyx-webar:vercel-deploy-estimates';
  const DEPLOY_POLL_MS = 3500;
  const DEPLOY_TIMEOUT_MS = 180000;
  let progressTimer = 0;
  let progressHideTimer = 0;
  let progressStartedAt = 0;
  let progressValue = 0;
  let progressActive = false;
  let activePublishId = '';

  function formatProgressTime(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }

  function getDeployEstimate() {
    try {
      const values = JSON.parse(localStorage.getItem(DEPLOY_ESTIMATES_KEY) || '[]').filter((value) => Number.isFinite(value) && value > 0);
      if (!values.length) return 30000;
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      return Math.max(12000, Math.min(90000, average));
    } catch { return 30000; }
  }

  function rememberDeployDuration(milliseconds) {
    try {
      const values = JSON.parse(localStorage.getItem(DEPLOY_ESTIMATES_KEY) || '[]').filter((value) => Number.isFinite(value) && value > 0);
      values.push(Math.max(5000, Math.min(120000, milliseconds)));
      localStorage.setItem(DEPLOY_ESTIMATES_KEY, JSON.stringify(values.slice(-5)));
    } catch {}
  }

  function setPublishProgress(percent, title, step, detail, state = 'uploading', estimate = 0) {
    if (!progressActive) return;
    const value = state === 'complete' ? 100 : Math.min(97, Math.max(progressValue, Math.round(Number(percent) || 0)));
    progressValue = value;
    const panel = $('publish-progress');
    panel.classList.remove('hidden');
    panel.dataset.state = state;
    $('publish-progress-title').textContent = title;
    $('publish-progress-percent').textContent = value + '%';
    $('publish-progress-fill').style.width = value + '%';
    const bar = $('publish-progress-bar');
    bar.setAttribute('aria-valuenow', String(value));
    bar.setAttribute('aria-valuetext', value + '% — ' + step);
    $('publish-progress-step').textContent = step;
    $('publish-progress-detail').textContent = detail || '';
    if (progressStartedAt) {
      $('publish-progress-time').textContent = 'Tempo ' + formatProgressTime(Date.now() - progressStartedAt) + (estimate ? ' / ~' + formatProgressTime(estimate) : '');
    }
  }

  function updatePublishTime() {
    if (progressActive && progressStartedAt) {
      $('publish-progress-time').textContent = 'Tempo ' + formatProgressTime(Date.now() - progressStartedAt);
    }
  }

  function beginPublishProgress(projectName) {
    clearInterval(progressTimer);
    clearTimeout(progressHideTimer);
    progressStartedAt = Date.now();
    progressValue = 0;
    progressActive = true;
    $('publish-progress-open').classList.add('hidden');
    $('publish-progress-open').removeAttribute('href');
    setPublishProgress(2, 'Publicando ' + projectName, 'Validando arquivos', 'Preparando o envio seguro para o GitHub.');
    progressTimer = window.setInterval(updatePublishTime, 1000);
  }

  function finishPublishProgress(shareUrl) {
    if (!progressActive) return;
    const elapsed = Date.now() - progressStartedAt;
    setPublishProgress(100, 'Experiência pronta', 'Deploy confirmado pela Vercel', 'O link já pode ser aberto no celular.', 'complete');
    const link = $('publish-progress-open');
    link.href = shareUrl;
    link.classList.remove('hidden');
    $('publish-progress-time').textContent = 'Concluído em ' + formatProgressTime(elapsed);
    progressActive = false;
    clearInterval(progressTimer);
    progressTimer = 0;
    progressHideTimer = window.setTimeout(() => {
      $('publish-progress').classList.add('hidden');
      link.classList.add('hidden');
      progressStartedAt = 0;
    }, 10000);
  }

  function failPublishProgress(message) {
    if (!progressActive) return false;
    const elapsed = Date.now() - progressStartedAt;
    setPublishProgress(progressValue, 'Publicação interrompida', 'Confira o motivo abaixo', message, 'error');
    $('publish-progress-open').classList.add('hidden');
    $('publish-progress-time').textContent = 'Interrompida após ' + formatProgressTime(elapsed);
    progressActive = false;
    clearInterval(progressTimer);
    progressTimer = 0;
    progressHideTimer = window.setTimeout(() => {
      $('publish-progress').classList.add('hidden');
      progressStartedAt = 0;
    }, 15000);
    return true;
  }

  function setPublishActionDisabled(projectId, disabled) {
    document.querySelectorAll('[data-cloud-action="publish"]').forEach((button) => {
      if (button.dataset.id === projectId) {
        button.disabled = disabled;
        button.setAttribute('aria-busy', String(disabled));
      }
    });
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function openCloudDb() {
    if (cloudDb) return Promise.resolve(cloudDb);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('innyx-webar', 1);
      request.onsuccess = () => { cloudDb = request.result; resolve(cloudDb); };
      request.onerror = () => reject(request.error);
    });
  }

  async function getProject(id) {
    const db = await openCloudDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction('projects').objectStore('projects').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveProject(project) {
    const db = await openCloudDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction('projects', 'readwrite').objectStore('projects').put(project);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });
  }

  async function api(path, options = {}) {
    if (!token) throw new Error('Conecte o GitHub para publicar projetos.');
    const url = path.startsWith('https://api.github.com/') ? path : `${API}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = body.message || response.statusText;
      if (response.status === 401) throw new Error('Token inválido ou expirado. Conecte um token fine-grained com permissão Contents: Read and write.');
      if (response.status === 403) throw new Error('O token não tem permissão para gravar neste repositório. Revise Contents: Read and write.');
      if (response.status === 404) throw new Error('Repositório não encontrado ou token sem acesso a VictorSicsu/innyx-webar.');
      throw new Error(`${detail} (GitHub ${response.status})`);
    }
    return body;
  }

  function setConnection(user) {
    connectedUser = user || connectedUser || 'GitHub';
    const button = $('github-connect');
    button.textContent = token ? `GitHub · ${connectedUser}` : 'Conectar GitHub';
    button.classList.toggle('connected', !!token);
    $('disconnect-github').classList.toggle('hidden', !token);
  }

  function toBase64(file, onProgress = () => {}) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      };
      reader.onload = () => {
        onProgress(1);
        resolve(String(reader.result).split(',')[1]);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  function encodeText(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function rawUrl(path) { return `${RAW}/${path.split('/').map(encodeURIComponent).join('/')}`; }
  function extension(name) { return String(name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, ''); }

  async function fileBlob(path) {
    if (!path) return null;
    const response = await fetch(rawUrl(path), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Não foi possível baixar ${path} do GitHub.`);
    return await response.blob();
  }

  function setInputFiles(input, files) {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function hydrateProject(project) {
    const assets = project.github?.assets || {};
    window.__cloudHydrating = true;
    try {
      if (!project.modelBlob && assets.modelPath) {
        const blob = await fileBlob(assets.modelPath);
        project.modelBlob = new File([blob], project.modelName || 'model.glb', { type: 'model/gltf-binary' });
        window.setModelFile(project.modelBlob, project.modelName || 'Modelo GLB', project.animation || '', project.scale || 1);
      }
      if (!project.markerBlob && assets.markerImagePath) {
        const blob = await fileBlob(assets.markerImagePath);
        project.markerBlob = new File([blob], project.markerName || 'marker.jpg', { type: blob.type || 'image/jpeg' });
        setInputFiles($('marker-file'), [project.markerBlob]);
      }
      if ((!project.descriptorFiles || !project.descriptorFiles.length) && (assets.descriptorPaths || []).length) {
        const descriptors = [];
        for (const path of assets.descriptorPaths) {
          const blob = await fileBlob(path);
          descriptors.push({ name: path.split('/').pop(), blob: new File([blob], path.split('/').pop(), { type: 'application/octet-stream' }) });
        }
        project.descriptorFiles = descriptors;
        setInputFiles($('descriptor-files'), descriptors.map((item) => item.blob));
      }
    } finally {
      window.__cloudHydrating = false;
    }
    await saveProject(project);
    if (typeof window.refresh === 'function') await window.refresh();
    return project;
  }

  const originalOpenEditor = window.openEditor;
  window.openEditor = function (project) {
    originalOpenEditor(project);
    if (project?.github?.publishedAt && (!project.modelBlob || (project.mode === 'marker' && !project.markerBlob))) {
      $('save-hint').textContent = 'Carregando arquivos do GitHub para editar…';
      hydrateProject(project).then(() => { $('save-hint').textContent = 'Arquivos sincronizados do GitHub'; })
        .catch((error) => { $('save-hint').textContent = 'Falha ao carregar arquivos'; $('dialog-error').textContent = error.message; });
    } else {
      $('save-hint').textContent = project?.github?.publishedAt ? 'Publicado e sincronizado com o GitHub' : 'Rascunho salvo neste navegador';
    }
  };

  function projectFiles(project) {
    const previous = project.github?.assets || {};
    const files = [];
    const assets = { modelPath: '', markerImagePath: '', descriptorPaths: [] };
    const add = (path, blob) => files.push({ path, blob });
    const versionDir = `assets/${project.id}/${project.updatedAt || Date.now()}`;

    if (project.modelBlob && (project.modelChanged || !previous.modelPath)) {
      assets.modelPath = `${versionDir}/model.glb`;
      add(assets.modelPath, project.modelBlob);
    } else if (previous.modelPath) assets.modelPath = previous.modelPath;

    if (project.mode === 'marker') {
      if (project.markerBlob && (project.markerChanged || !previous.markerImagePath)) {
        const ext = extension(project.markerName) || 'jpg';
        assets.markerImagePath = `${versionDir}/marker.${ext}`;
        add(assets.markerImagePath, project.markerBlob);
      } else if (previous.markerImagePath) assets.markerImagePath = previous.markerImagePath;

      const descriptorFiles = project.descriptorFiles || [];
      if (project.markerChanged && !project.descriptorsChanged) {
        throw new Error('A imagem do marcador foi alterada. Gere e envie os novos descritores NFT antes de publicar.');
      }
      if (descriptorFiles.length && (project.descriptorsChanged || !previous.descriptorPaths?.length)) {
        for (const item of descriptorFiles) {
          const ext = extension(item.name);
          if (!['fset', 'fset3', 'iset'].includes(ext)) continue;
          const path = `${versionDir}/marker.${ext}`;
          assets.descriptorPaths.push(path);
          add(path, item.blob);
        }
      } else {
        assets.descriptorPaths = previous.descriptorPaths || [];
      }
    }

    const paths = new Set(files.map((item) => item.path));
    if (assets.modelPath) paths.add(assets.modelPath);
    if (assets.markerImagePath) paths.add(assets.markerImagePath);
    assets.descriptorPaths.forEach((path) => paths.add(path));
    assets.modelName = project.modelName || previous.modelName || 'model.glb';
    assets.markerName = project.markerName || previous.markerName || '';
    return { files, assets, paths: [...paths] };
  }

  function uploadBlobWithProgress(payload, onProgress) {
    return new Promise((resolve, reject) => {
      if (!token) return reject(new Error('Conecte o GitHub para publicar projetos.'));
      const request = new XMLHttpRequest();
      request.open('POST', API + '/git/blobs');
      request.setRequestHeader('Accept', 'application/vnd.github+json');
      request.setRequestHeader('Authorization', 'Bearer ' + token);
      request.setRequestHeader('X-GitHub-Api-Version', '2022-11-28');
      request.setRequestHeader('Content-Type', 'application/json');
      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      });
      request.addEventListener('load', () => {
        let body = {};
        try { body = JSON.parse(request.responseText || '{}'); } catch {}
        if (request.status < 200 || request.status >= 300) {
          const detail = body.message || request.statusText;
          if (request.status === 401) return reject(new Error('Token inválido ou expirado. Conecte um token fine-grained com permissão Contents: Read and write.'));
          if (request.status === 403) return reject(new Error('O token não tem permissão para gravar neste repositório. Revise Contents: Read and write.'));
          if (request.status === 404) return reject(new Error('Repositório não encontrado ou token sem acesso a VictorSicsu/innyx-webar.'));
          return reject(new Error(detail + ' (GitHub ' + request.status + ')'));
        }
        onProgress(1);
        resolve(body);
      });
      request.addEventListener('error', () => reject(new Error('Falha de rede ao enviar um arquivo para o GitHub. Confira sua conexão e tente novamente.')));
      request.addEventListener('abort', () => reject(new Error('O envio do arquivo para o GitHub foi interrompido.')));
      request.send(payload);
    });
  }

  async function readVercelCommitStatus(commitSha) {
    const response = await fetch(API + '/commits/' + encodeURIComponent(commitSha) + '/status', {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      cache: 'no-store'
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'GitHub não conseguiu consultar o status público do deploy.');
    return body;
  }

  async function waitForVercel(commitSha) {
    const startedAt = Date.now();
    const estimate = getDeployEstimate();
    const timeoutAt = startedAt + DEPLOY_TIMEOUT_MS;
    let consecutiveErrors = 0;
    setPublishProgress(80, 'Preparando o link WebAR', 'Aguardando a Vercel', 'O percentual desta etapa é estimado; a conclusão será confirmada pelo status real do deploy.', 'waiting', estimate);

    while (Date.now() < timeoutAt) {
      let result;
      try {
        result = await readVercelCommitStatus(commitSha);
        consecutiveErrors = 0;
      } catch (error) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 3) {
          throw new Error('Os arquivos chegaram ao GitHub, mas não foi possível confirmar o deploy da Vercel: ' + error.message);
        }
        setPublishProgress(80, 'Preparando o link WebAR', 'Reconectando ao status da Vercel', 'Os arquivos já estão no GitHub; tentando consultar o deploy novamente.', 'waiting', estimate);
        await new Promise((resolve) => window.setTimeout(resolve, DEPLOY_POLL_MS));
        continue;
      }

      const checks = (result.statuses || [])
        .filter((status) => /vercel/i.test(status.context || ''))
        .sort((a, b) => Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0));
      const vercel = checks[0];
      if (vercel?.state === 'success') {
        rememberDeployDuration(Date.now() - startedAt);
        setPublishProgress(97, 'Finalizando experiência', 'Deploy confirmado pela Vercel', 'Atualizando o projeto e liberando o link para o celular.', 'waiting', estimate);
        return vercel;
      }
      if (vercel?.state === 'failure' || vercel?.state === 'error') {
        throw new Error('O commit foi enviado ao GitHub, mas a Vercel informou falha no deploy. Confira o projeto Vercel antes de tentar novamente.');
      }

      const elapsed = Date.now() - startedAt;
      const estimatedPercent = 80 + Math.min(16, Math.round((elapsed / estimate) * 16));
      const state = vercel?.state === 'pending' ? 'A Vercel está construindo a versão de produção.' : 'Aguardando a Vercel iniciar a construção.';
      setPublishProgress(estimatedPercent, 'Preparando o link WebAR', 'Aguardando a Vercel', state + ' O percentual é uma estimativa até a confirmação final.', 'waiting', estimate);
      await new Promise((resolve) => window.setTimeout(resolve, DEPLOY_POLL_MS));
    }

    throw new Error('O commit está no GitHub, mas a Vercel ainda não confirmou que a experiência está pronta. Confira o deploy e tente novamente em instantes.');
  }

  async function commitTree(files, removals, message) {
    setPublishProgress(4, 'Preparando publicação no GitHub', 'Lendo a versão atual do repositório', 'Organizando o commit da experiência.');
    const ref = await api('/git/ref/heads/' + BRANCH);
    const parentSha = ref.object.sha;
    const parent = await api('/git/commits/' + parentSha);
    const elements = [];
    const weights = files.map((item) => typeof item.blob === 'string'
      ? Math.max(1, new TextEncoder().encode(item.blob).byteLength)
      : Math.max(1, Number(item.blob?.size) || 1));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    let completedWeight = 0;

    for (let index = 0; index < files.length; index += 1) {
      const item = files[index];
      const weight = weights[index];
      const fileName = item.path.split('/').pop();
      const reportFileProgress = (fraction, detail) => {
        const transferred = completedWeight + weight * Math.max(0, Math.min(1, fraction));
        setPublishProgress(8 + 59 * (transferred / totalWeight), 'Enviando arquivos ao GitHub', 'Arquivo ' + (index + 1) + ' de ' + files.length + ': ' + fileName, detail || (formatBytes(transferred) + ' de ' + formatBytes(totalWeight)), 'uploading');
      };
      const content = typeof item.blob === 'string'
        ? encodeText(item.blob)
        : await toBase64(item.blob, (fraction) => reportFileProgress(fraction * 0.12, 'Preparando o arquivo para envio.'));
      const payload = JSON.stringify({ content, encoding: 'base64' });
      reportFileProgress(0.12, 'Enviando os dados ao GitHub.');
      const blob = await uploadBlobWithProgress(payload, (fraction) => reportFileProgress(0.12 + fraction * 0.88, 'Transferindo os dados ao GitHub.'));
      elements.push({ path: item.path, mode: '100644', type: 'blob', sha: blob.sha });
      completedWeight += weight;
      reportFileProgress(1, 'Arquivo enviado.');
    }

    removals.filter((path) => !files.some((item) => item.path === path)).forEach((path) => {
      elements.push({ path, mode: '100644', type: 'blob', sha: null });
    });
    setPublishProgress(69, 'Gravando publicação no GitHub', 'Montando os arquivos do commit', 'Os arquivos foram enviados; registrando a nova versão.');
    const tree = await api('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: parent.tree.sha, tree: elements }) });
    setPublishProgress(73, 'Gravando publicação no GitHub', 'Criando commit', 'Finalizando a versão do projeto.');
    const commit = await api('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }) });
    setPublishProgress(77, 'Gravando publicação no GitHub', 'Atualizando a branch principal', 'A Vercel será acionada assim que o commit entrar em main.');
    await api('/git/refs/heads/' + BRANCH, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
    setPublishProgress(80, 'Preparando o link WebAR', 'Commit enviado ao GitHub', 'Aguardando o início do deploy de produção.');
    return commit.sha;
  }
  function buildManifest(project, assets, shareUrl, paths) {
    const descriptorBasePath = assets.descriptorPaths[0]?.replace(/\.fset3?$|\.iset$/i, '') || '';
    const marker = project.mode === 'marker' ? {
      name: assets.markerName,
      imagePath: assets.markerImagePath,
      imageUrl: assets.markerImagePath ? rawUrl(assets.markerImagePath) : '',
      descriptorBasePath,
      descriptorBaseUrl: descriptorBasePath ? rawUrl(descriptorBasePath) : '',
      descriptorPaths: assets.descriptorPaths,
      descriptorUrls: assets.descriptorPaths.map(rawUrl)
    } : null;
    return {
      format: 'innyx-webar-experience',
      version: 1,
      id: project.id,
      name: project.name,
      mode: project.mode || 'marker',
      createdAt: project.createdAt || Date.now(),
      updatedAt: project.updatedAt || Date.now(),
      shareUrl,
      model: {
        name: assets.modelName,
        path: assets.modelPath,
        url: assets.modelPath ? rawUrl(assets.modelPath) : '',
        animation: project.animation || '',
        scale: Math.max(0.1, Math.min(3, Number(project.scale) || 1))
      },
      marker,
      location: project.mode === 'location' ? {
        latitude: Number(project.latitude),
        longitude: Number(project.longitude),
        altitude: project.altitude == null ? null : Number(project.altitude)
      } : null,
      assets: { ...assets, files: paths }
    };
  }

  async function publishProject(project) {
    if (!token) {
      pendingPublishId = project.id;
      githubDialog.showModal();
      $('github-token').focus();
      return false;
    }
    project.updatedAt = Date.now();
    const mode = project.mode || 'marker';
    if (!project.modelBlob && !project.github?.assets?.modelPath) throw new Error('Adicione um arquivo GLB antes de publicar.');
    if (mode === 'marker') {
      if (!(project.markerBlob || project.github?.assets?.markerImagePath)) throw new Error('Adicione uma imagem natural para o marcador.');
      const { assets } = projectFiles(project);
      if (!['fset', 'fset3', 'iset'].every((ext) => assets.descriptorPaths.some((path) => path.endsWith('.' + ext)))) {
        throw new Error('Gere e adicione os descritores .fset, .fset3 e .iset para esta imagem.');
      }
    } else {
      const lat = Number(project.latitude), lon = Number(project.longitude);
      if (project.latitude == null || project.longitude == null || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
        throw new Error('Informe uma latitude entre -90 e 90 e uma longitude entre -180 e 180.');
      }
    }

    const { files, assets, paths } = projectFiles(project);
    const manifestPath = 'experiences/' + project.id + '.json';
    const shareUrl = location.origin + '/experience.html?id=' + encodeURIComponent(project.id);
    const manifest = buildManifest(project, assets, shareUrl, paths);
    const oldPaths = [...(project.github?.assets?.files || [])].filter((path) => !paths.includes(path));
    if (project.github?.manifestPath) oldPaths.push(project.github.manifestPath);
    files.push({ path: manifestPath, blob: JSON.stringify(manifest, null, 2) });
    beginPublishProgress(project.name);
    const commitSha = await commitTree(files, oldPaths, 'Publish WebAR: ' + project.name);
    await waitForVercel(commitSha);
    project.github = { publishedAt: project.updatedAt, manifestPath, shareUrl, commitSha, deploymentState: 'ready', assets: { ...assets, files: paths } };
    project.markerPreviewUrl = assets.markerImagePath ? rawUrl(assets.markerImagePath) : '';
    project.markerChanged = false;
    project.modelChanged = false;
    project.descriptorsChanged = false;
    await saveProject(project);
    if (typeof window.refresh === 'function') await window.refresh();
    finishPublishProgress(shareUrl);
    return true;
  }

  window.publishProjectById = async (id) => {
    if (activePublishId) {
      say('Já existe uma publicação em andamento. Aguarde a conclusão.');
      return false;
    }
    activePublishId = id;
    setPublishActionDisabled(id, true);
    try {
      const project = await getProject(id);
      if (!project) throw new Error('Projeto não encontrado neste navegador.');
      return await publishProject(project);
    } catch (error) {
      if (!failPublishProgress(error.message || 'Falha ao publicar a experiência.')) say(error.message || 'Falha ao publicar no GitHub.');
      return false;
    } finally {
      setPublishActionDisabled(id, false);
      activePublishId = '';
    }
  };
  window.render = function () {
    originalRender();
    openCloudDb().then(async (db) => {
      const items = await new Promise((resolve, reject) => {
        const req = db.transaction('projects').objectStore('projects').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      decorateRows(items);
    }).catch(() => {});
  };

  $('project-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-cloud-action]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const { cloudAction: action, id } = button.dataset;
    if (action === 'publish') await window.publishProjectById(id);
    if (action === 'copy') {
      const project = await getProject(id);
      const url = project?.github?.shareUrl;
      if (!url) return say('Link de experiência indisponível.');
      await navigator.clipboard.writeText(url);
      say('Link copiado. Envie-o para abrir em outro celular.');
    }
    if (action === 'unpublish') {
      const project = await getProject(id);
      if (project && confirm(`Remover “${project.name}” do GitHub? O link público deixará de funcionar.`)) {
        try { await unpublishProject(id); } catch (error) { say(error.message); }
      }
    }
  }, true);

  $('github-connect').addEventListener('click', async () => {
    if (!token) { githubDialog.showModal(); $('github-token').focus(); return; }
    try { await syncFromGitHub(); }
    catch (error) { say(error.message || 'Falha ao sincronizar com o GitHub.'); }
  });

  $('github-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('connect-github-submit');
    button.disabled = true;
    $('github-error').textContent = '';
    try {
      token = $('github-token').value.trim();
      if (!token) throw new Error('Cole seu token fine-grained do GitHub.');
      await api('');
      $('github-token').value = '';
      setConnection(OWNER);
      githubDialog.close();
      await syncFromGitHub();
      const waiting = pendingPublishId;
      pendingPublishId = '';
      if (waiting) await window.publishProjectById(waiting);
    } catch (error) {
      token = '';
      $('github-error').textContent = error.message || 'Não foi possível conectar ao GitHub.';
    } finally {
      button.disabled = false;
    }
  });

  $('close-github').addEventListener('click', () => githubDialog.close());
  $('cancel-github').addEventListener('click', () => githubDialog.close());
  $('disconnect-github').addEventListener('click', () => {
    token = '';
    connectedUser = '';
    $('github-token').value = '';
    setConnection('');
    githubDialog.close();
    say('GitHub desconectado desta aba.');
  });

  $('project-form').addEventListener('change', (event) => {
    if (!event.target.matches('input[name="experience-mode"]')) return;
    const isLocation = $('mode-location').checked;
    $('location-fields').classList.toggle('hidden', !isLocation);
    document.querySelectorAll('.marker-only').forEach((el) => el.classList.toggle('hidden', isLocation));
  });

  $('use-location').addEventListener('click', () => {
    if (!navigator.geolocation) return say('Este navegador não oferece localização GPS.');
    $('use-location').disabled = true;
    navigator.geolocation.getCurrentPosition((position) => {
      $('latitude').value = position.coords.latitude.toFixed(6);
      $('longitude').value = position.coords.longitude.toFixed(6);
      $('use-location').disabled = false;
      say('Coordenadas preenchidas. Ajuste o ponto se precisar.');
    }, () => {
      $('use-location').disabled = false;
      say('Não foi possível ler a localização. Permita o acesso ao GPS e tente novamente.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });

  $('help-button').addEventListener('click', () => {
    const help = $('help-dialog');
    if (!help.open) help.showModal();
  });

  setConnection('');
})();

