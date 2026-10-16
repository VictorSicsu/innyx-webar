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

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
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

  async function commitTree(files, removals, message) {
    const ref = await api(`/git/ref/heads/${BRANCH}`);
    const parentSha = ref.object.sha;
    const parent = await api(`/git/commits/${parentSha}`);
    const elements = [];
    for (const item of files) {
      const content = typeof item.blob === 'string' ? encodeText(item.blob) : await toBase64(item.blob);
      const blob = await api('/git/blobs', { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) });
      elements.push({ path: item.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    removals.filter((path) => !files.some((item) => item.path === path)).forEach((path) => {
      elements.push({ path, mode: '100644', type: 'blob', sha: null });
    });
    const tree = await api('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: parent.tree.sha, tree: elements }) });
    const commit = await api('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }) });
    await api(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
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
      if (!['fset', 'fset3', 'iset'].every((ext) => assets.descriptorPaths.some((path) => path.endsWith(`.${ext}`)))) {
        throw new Error('Gere e adicione os descritores .fset, .fset3 e .iset para esta imagem.');
      }
    } else {
      const lat = Number(project.latitude), lon = Number(project.longitude);
      if (project.latitude == null || project.longitude == null || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
        throw new Error('Informe uma latitude entre -90 e 90 e uma longitude entre -180 e 180.');
      }
    }

    const { files, assets, paths } = projectFiles(project);
    const manifestPath = `experiences/${project.id}.json`;
    const shareUrl = `${location.origin}/experience.html?id=${encodeURIComponent(project.id)}`;
    const manifest = buildManifest(project, assets, shareUrl, paths);
    const oldPaths = [...(project.github?.assets?.files || [])].filter((path) => !paths.includes(path));
    if (project.github?.manifestPath) oldPaths.push(project.github.manifestPath);
    files.push({ path: manifestPath, blob: JSON.stringify(manifest, null, 2) });
    say('Enviando modelo e dados ao GitHub…');
    await commitTree(files, oldPaths, `Publish WebAR: ${project.name}`);
    project.github = { publishedAt: project.updatedAt, manifestPath, shareUrl, assets: { ...assets, files: paths } };
    project.markerPreviewUrl = assets.markerImagePath ? rawUrl(assets.markerImagePath) : '';
    project.markerChanged = false;
    project.modelChanged = false;
    project.descriptorsChanged = false;
    await saveProject(project);
    if (typeof window.refresh === 'function') await window.refresh();
    say('Publicado no GitHub. O link da experiência já está pronto para compartilhar.');
    return true;
  }

  window.publishProjectById = async (id) => {
    try {
      const project = await getProject(id);
      if (!project) throw new Error('Projeto não encontrado neste navegador.');
      return await publishProject(project);
    } catch (error) {
      say(error.message || 'Falha ao publicar no GitHub.');
      return false;
    }
  };

  async function fetchManifest(url) {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}refresh=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Não foi possível sincronizar um manifesto do GitHub.');
    return await response.json();
  }

  async function syncFromGitHub() {
    const listing = await api('/contents/experiences?ref=' + BRANCH).catch((error) => {
      if (/GitHub 404/.test(error.message)) return [];
      throw error;
    });
    const manifests = Array.isArray(listing) ? listing.filter((item) => item.type === 'file' && item.name.endsWith('.json')) : [];
    let count = 0;
    for (const item of manifests) {
      const manifest = await fetchManifest(item.download_url || rawUrl(item.path));
      if (manifest.format !== 'innyx-webar-experience' || !manifest.id) continue;
      const old = await getProject(manifest.id);
      const assets = manifest.assets || {};
      const project = {
        ...(old || {}),
        id: manifest.id,
        name: manifest.name || 'Experiência sem título',
        mode: manifest.mode || 'marker',
        createdAt: manifest.createdAt || old?.createdAt || Date.now(),
        updatedAt: manifest.updatedAt || Date.now(),
        markerName: manifest.marker?.name || assets.markerName || old?.markerName || '',
        markerPreviewUrl: manifest.marker?.imageUrl || '',
        modelName: manifest.model?.name || assets.modelName || old?.modelName || 'model.glb',
        animation: manifest.model?.animation || '',
        scale: manifest.model?.scale || 1,
        latitude: manifest.location?.latitude ?? null,
        longitude: manifest.location?.longitude ?? null,
        altitude: manifest.location?.altitude ?? null,
        markerBlob: old?.markerBlob || null,
        modelBlob: old?.modelBlob || null,
        descriptorFiles: old?.descriptorFiles || [],
        github: {
          publishedAt: manifest.updatedAt || Date.now(),
          manifestPath: item.path,
          shareUrl: manifest.shareUrl || `${location.origin}/experience.html?id=${encodeURIComponent(manifest.id)}`,
          assets: { ...assets, files: assets.files || [] }
        }
      };
      await saveProject(project);
      count += 1;
    }
    if (typeof window.refresh === 'function') await window.refresh();
    say(`${count} experiência(s) sincronizada(s) do GitHub.`);
    return count;
  }

  async function unpublishProject(id) {
    const project = await getProject(id);
    if (!project?.github?.publishedAt) return;
    const paths = [...(project.github.assets?.files || []), project.github.manifestPath].filter(Boolean);
    say('Removendo publicação do GitHub…');
    await commitTree([], paths, `Unpublish WebAR: ${project.name}`);
    delete project.github;
    project.markerPreviewUrl = '';
    await saveProject(project);
    if (typeof window.refresh === 'function') await window.refresh();
    say('Publicação removida. Os arquivos locais continuam salvos neste navegador.');
  }

  function decorateRows(projectList) {
    const byId = new Map(projectList.map((item) => [item.id, item]));
    document.querySelectorAll('.project-row').forEach((row) => {
      const project = byId.get(row.dataset.id);
      if (!project) return;
      const info = row.querySelector('.project-info');
      const status = row.querySelector('.status-cell .status');
      if (status && project.github?.publishedAt) {
        status.className = 'status published';
        status.textContent = 'Publicado';
      } else if (status && project.mode === 'location' && window.isPackageReady?.(project)) {
        status.className = 'status ready';
        status.textContent = 'Pronto';
      }
      let actions = info.querySelector('.cloud-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'cloud-actions';
        info.appendChild(actions);
      }
      if (project.github?.publishedAt) {
        const href = project.github.shareUrl || `${location.origin}/experience.html?id=${encodeURIComponent(project.id)}`;
        actions.innerHTML = `<a href="${href}" data-action="open" target="_blank" rel="noopener">Abrir experiência ↗</a><button type="button" data-cloud-action="copy" data-id="${project.id}">Copiar link</button><button type="button" data-cloud-action="unpublish" data-id="${project.id}">Despublicar</button>`;
      } else {
        actions.innerHTML = `<button type="button" class="publish-link" data-cloud-action="publish" data-id="${project.id}">Publicar no GitHub ↗</button>`;
      }
    });
  }

  const originalRender = window.render;
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

