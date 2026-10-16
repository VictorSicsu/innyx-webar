const DB_NAME = 'innyx-webar';
const STORE = 'projects';
let db;
let projects = [];
let activeFilter = 'all';
let activeView = 'projects';
let markerUpload = null;
let modelUpload = null;
let descriptorUpload = null;
let modelUrl = null;
let toastTimer;
const thumbUrls = new Map();
const memoryProjects = new Map();
const $ = (id) => document.getElementById(id);
const dialog = $('project-dialog');
const modelViewer = $('model-preview');

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB indisponível neste navegador.'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function allProjects() {
  if (!db) return Promise.resolve([...memoryProjects.values()]);
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => {
      const combined = new Map(request.result.map((project) => [project.id, project]));
      memoryProjects.forEach((project, id) => combined.set(id, project));
      resolve([...combined.values()]);
    };
    request.onerror = () => reject(request.error);
  });
}
function saveRecord(project) {
  memoryProjects.set(project.id, project);
  if (!db) return Promise.resolve({ volatile: true });
  return new Promise((resolve, reject) => {
    let transaction;
    try { transaction = db.transaction(STORE, 'readwrite'); }
    catch (error) {
      if (['InvalidStateError', 'SecurityError', 'QuotaExceededError'].includes(error.name)) return resolve({ volatile: true });
      return reject(error);
    }
    const request = transaction.objectStore(STORE).put(project);
    request.onsuccess = () => resolve({ volatile: false });
    request.onerror = () => {
      const error = request.error || transaction.error;
      if (['InvalidStateError', 'SecurityError', 'QuotaExceededError'].includes(error?.name)) resolve({ volatile: true });
      else reject(error || new Error('Falha ao gravar no armazenamento do navegador.'));
    };
  });
}
function deleteRecord(id) {
  memoryProjects.delete(id);
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}
function newId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function formatDate(value) { return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)).replace('.', ''); }
function sizeLabel(bytes) { return bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes > 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : bytes > 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${bytes} B`; }
function notify(message) {
  const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function artFor(project) {
  if (project.markerBlob) {
    if (!thumbUrls.has(project.id)) thumbUrls.set(project.id, URL.createObjectURL(project.markerBlob));
    return `<img src="${thumbUrls.get(project.id)}" alt="" style="width:100%;height:100%;object-fit:cover">`;
  }
  if (project.markerPreviewUrl) return `<img src="${escapeHtml(project.markerPreviewUrl)}" alt="" style="width:100%;height:100%;object-fit:cover">`;
  return project.mode === 'location' ? '⌖' : (project.symbol || '✳');
}
function render() {
  const query = $('search-input').value.trim().toLocaleLowerCase('pt-BR');
  const ready = projects.filter(isPackageReady).length;
  const markers = projects.filter((p) => p.markerBlob || p.markerPreviewUrl || p.github?.assets?.markerImagePath).length;
  $('project-count').textContent = projects.length;
  $('stat-projects').textContent = projects.length;
  $('stat-published').textContent = ready;
  $('stat-markers').textContent = markers;
  $('count-all').textContent = projects.length;
  $('count-published').textContent = ready;
  $('count-draft').textContent = projects.length - ready;
  $('list-summary').textContent = `${projects.length} ${projects.length === 1 ? 'projeto' : 'projetos'}`;
  const used = projects.reduce((sum, p) => sum + (p.markerBlob?.size || 0) + (p.modelBlob?.size || 0), 0);
  $('storage-value').textContent = sizeLabel(used);
  $('storage-track').style.width = `${Math.min(100, Math.max(3, used / (500 * 1024 ** 2) * 100))}%`;
  const filtered = projects.filter((p) => {
    const matchesQuery = `${p.name} ${p.markerName || ''} ${p.modelName || ''}`.toLocaleLowerCase('pt-BR').includes(query);
    const matchesFilter = activeFilter === 'all' || (activeFilter === 'published' ? isPackageReady(p) : !isPackageReady(p));
    const matchesView = activeView === 'projects' || (activeView === 'markers' ? !!p.markerBlob || !!p.markerPreviewUrl || !!p.github?.assets?.markerImagePath : activeView === 'assets' ? !!p.modelBlob || !!p.github?.assets?.modelPath || !!p.markerBlob || !!p.markerPreviewUrl : true);
    return matchesQuery && matchesFilter && matchesView;
  });
  const list = $('project-list');
  list.innerHTML = filtered.map((p) => `<article class="project-row" data-id="${escapeHtml(p.id)}">
    <div class="project-main"><div class="project-thumb ${p.tint || 'violet'}">${artFor(p)}</div><div class="project-info"><strong>${escapeHtml(p.name)}</strong><span>${p.updatedAt ? `Editado ${formatDate(p.updatedAt)}` : 'Rascunho novo'}</span></div></div>
    <div class="marker-cell"><span class="marker-mini ${p.markerBlob ? '' : 'empty'}">${p.mode === 'location' ? '⌖' : p.markerBlob ? '⌗' : '＋'}</span><span class="marker-name">${escapeHtml(p.mode === 'location' ? (p.latitude != null && p.longitude != null ? `${p.latitude}, ${p.longitude}` : 'Definir coordenadas GPS') : (p.markerName || 'Adicionar imagem'))}</span></div>
    <div class="model-cell"><span class="model-cube">◇</span><span class="model-name">${escapeHtml(p.modelName || 'Adicionar GLB')}</span></div>
    <div class="status-cell"><span class="status ${isPackageReady(p) ? 'ready' : 'draft'}">${isPackageReady(p) ? 'Pronto' : 'Rascunho'}</span></div>
    <span class="row-date">${p.updatedAt ? formatDate(p.updatedAt) : '—'}</span><button class="row-more" data-action="menu" aria-label="Opções de ${escapeHtml(p.name)}">···</button>
  </article>`).join('');
  $('empty-state').classList.toggle('hidden', filtered.length > 0);
  $('empty-state').querySelector('strong').textContent = projects.length ? 'Nenhum resultado encontrado' : 'Nenhum projeto por aqui';
  $('empty-state').querySelector('span').textContent = projects.length ? 'Tente outra busca ou altere os filtros.' : 'Crie sua primeira experiência e dê vida a uma imagem.';
}
async function refresh() { projects = (await allProjects()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); render(); }
window.findInnyxProject = (id) => projects.find((project) => project.id === id) || memoryProjects.get(id) || null;
window.rememberInnyxProject = (project) => {
  memoryProjects.set(project.id, project);
  const index = projects.findIndex((item) => item.id === project.id);
  if (index < 0) projects.unshift(project); else projects[index] = project;
  projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  render();
  return project;
};
function clearDialog() {
  $('project-form').reset(); $('project-id').value = ''; $('dialog-error').textContent = '';
  $('marker-file-name').textContent = 'Nenhum arquivo selecionado'; $('model-file-name').textContent = 'Nenhum arquivo selecionado';
  $('model-editor').classList.add('hidden'); $('delete-project').classList.add('hidden'); $('dialog-title').textContent = 'Nova experiência';
  $('mode-marker').checked = true; $('mode-location').checked = false; $('latitude').value = ''; $('longitude').value = ''; $('altitude').value = '';
  $('location-fields').classList.add('hidden'); document.querySelectorAll('.marker-only').forEach((el) => el.classList.remove('hidden'));
  window.__cloudMarkerEdited = false; window.__cloudModelEdited = false; window.__cloudDescriptorsEdited = false;
  markerUpload = null; modelUpload = null;
  descriptorUpload = null;
  $('descriptor-files').value = ''; $('descriptor-file-name').textContent = 'Gerados para esta imagem no gerador oficial do AR.js';
  $('download-package').classList.add('hidden');
  if (modelUrl) URL.revokeObjectURL(modelUrl); modelUrl = null; modelViewer.removeAttribute('src');
  $('animation-select').innerHTML = '<option value="">Sem animação</option>';
  $('model-scale').value = 1; $('scale-value').textContent = '1.0×';
}
function openEditor(project) {
  clearDialog();
  if (project) {
    $('project-id').value = project.id; $('project-name').value = project.name;
    $('mode-location').checked = project.mode === 'location'; $('mode-marker').checked = project.mode !== 'location';
    $('latitude').value = project.latitude ?? ''; $('longitude').value = project.longitude ?? ''; $('altitude').value = project.altitude ?? '';
    $('location-fields').classList.toggle('hidden', project.mode !== 'location'); document.querySelectorAll('.marker-only').forEach((el) => el.classList.toggle('hidden', project.mode === 'location'));
    $('dialog-title').textContent = 'Editar experiência'; $('delete-project').classList.remove('hidden');
    $('marker-file-name').textContent = project.markerName || (project.github?.assets?.markerImagePath ? 'Imagem publicada no GitHub' : 'Nenhum arquivo selecionado');
    $('model-file-name').textContent = project.modelName || (project.github?.assets?.modelPath ? 'Modelo publicado no GitHub' : 'Nenhum arquivo selecionado');
    if (project.descriptorFiles?.length) $('descriptor-file-name').textContent = project.descriptorFiles.map((f) => f.name).join(' · ');
    if (isPackageReady(project) && project.mode !== 'location' && !project.github?.publishedAt) $('download-package').classList.remove('hidden');
    if (project.modelBlob) setModelFile(project.modelBlob, project.modelName, project.animation || '', project.scale || 1);
  }
  dialog.showModal(); setTimeout(() => $('project-name').focus(), 60);
}
function setModelFile(file, name, selectedAnimation = '', scale = 1) {
  if (modelUrl) URL.revokeObjectURL(modelUrl);
  modelUpload = file; modelUrl = URL.createObjectURL(file);
  $('model-file-name').textContent = name || file.name || 'Modelo GLB';
  $('model-editor').classList.remove('hidden'); $('animation-select').innerHTML = `<option value="">Sem animação</option>${selectedAnimation ? `<option value="${escapeHtml(selectedAnimation)}" selected>${escapeHtml(selectedAnimation)}</option>` : ''}`;
  $('model-scale').value = scale; $('scale-value').textContent = `${Number(scale).toFixed(1)}×`;
  modelViewer.setAttribute('src', modelUrl);
  modelViewer.addEventListener('load', () => {
    const animations = modelViewer.availableAnimations || [];
    $('animation-select').innerHTML = '<option value="">Sem animação</option>' + animations.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
    if (selectedAnimation && animations.includes(selectedAnimation)) $('animation-select').value = selectedAnimation;
    modelViewer.animationName = $('animation-select').value || null;
    modelViewer.autoplay = !!modelViewer.animationName;
  }, { once: true });
}
function isPackageReady(project) {
  const exts = (project.descriptorFiles || []).map((file) => file.name.split('.').pop().toLowerCase());
  const hasModel = !!project.modelBlob || !!project.github?.assets?.modelPath;
  if (project.mode === 'location') return hasModel && project.latitude != null && project.longitude != null && Number.isFinite(Number(project.latitude)) && Number.isFinite(Number(project.longitude));
  const remoteDescriptors = project.github?.assets?.descriptorPaths || [];
  return hasModel && !!(project.markerBlob || project.markerPreviewUrl || project.github?.assets?.markerImagePath)
    && (['fset','fset3','iset'].every((ext) => exts.includes(ext)) || ['fset','fset3','iset'].every((ext) => remoteDescriptors.some((path) => path.endsWith(`.${ext}`))));
}
async function exportExperience(project) {
  if (!isPackageReady(project)) { notify('Adicione o modelo GLB e os 3 descritores NFT para baixar a experiência.'); return; }
  if (!window.JSZip) { notify('O gerador de pacote não carregou. Atualize a página e tente novamente.'); return; }
  const zip = new JSZip();
  const assets = zip.folder('assets');
  if (project.mode === 'location') { notify('Para compartilhar projetos Local Based, use Salvar e publicar.'); return; }
  const markerExt = project.markerName.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const animation = project.animation ? `animation-mixer="clip: ${escapeHtml(project.animation)}; loop: repeat"` : '';
  const scale = Math.max(0.1, Math.min(3, Number(project.scale) || 1));
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#211436"><title>${escapeHtml(project.name)} · InnyxWebAR</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#100c18;font-family:Arial,sans-serif}.hint{position:fixed;z-index:5;top:20px;left:50%;transform:translateX(-50%);padding:10px 16px;border:1px solid #ffffff30;border-radius:22px;background:#20163de0;color:white;font-size:13px;text-align:center;white-space:nowrap}.arjs-loader{position:fixed;z-index:10;inset:0;display:grid;place-items:center;background:#171020;color:white;font-size:14px}.arjs-loader.done{display:none}</style><script src="https://aframe.io/releases/1.6.0/aframe.min.js"></script><script src="https://cdn.jsdelivr.net/gh/AR-js-org/AR.js@3.4.7/aframe/build/aframe-ar-nft.js"></script><script src="https://cdn.jsdelivr.net/npm/aframe-extras@7.5.0/dist/aframe-extras.min.js"></script></head><body><div class="arjs-loader" id="loader">Iniciando câmera…</div><div class="hint">Aponte a câmera para a imagem do marcador</div><a-scene embedded vr-mode-ui="enabled:false" renderer="logarithmicDepthBuffer:true; antialias:true; alpha:true" arjs="trackingMethod:best; sourceType:webcam; debugUIEnabled:false"><a-nft type="nft" url="assets/marker" smooth="true" smoothCount="10" smoothTolerance="0.01" smoothThreshold="5"><a-entity gltf-model="url(assets/model.glb)" position="50 150 0" scale="${scale} ${scale} ${scale}" ${animation}></a-entity></a-nft><a-entity camera></a-entity></a-scene><script>const loader=document.getElementById('loader');document.querySelector('a-scene').addEventListener('loaded',()=>setTimeout(()=>loader.classList.add('done'),500));window.addEventListener('arjs-nft-loaded',()=>loader.classList.add('done'));</script></body></html>`;
  zip.file('index.html', html);
  zip.file('assets/model.glb', project.modelBlob);
  zip.file(`assets/marker.${markerExt}`, project.markerBlob);
  for (const file of project.descriptorFiles) zip.file(`assets/marker.${file.name.split('.').pop().toLowerCase()}`, file.blob);
  zip.file('README.txt', `Experiência ${project.name}\n\nPublique a pasta inteira em um host HTTPS e abra index.html no celular. Permita o acesso à câmera e aponte para a imagem original do marcador.\n\nRuntime: A-Frame 1.6.0 + AR.js 3.4.7 (rastreamento NFT).\nSe usar outro nome ou localização para os arquivos, ajuste o caminho em index.html.\n`);
  const blob = await zip.generateAsync({ type: 'blob' });
  const filename = project.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'experiencia';
  download(`${filename}-webar.zip`, blob); notify('Pacote AR.js gerado. Hospede todos os arquivos juntos em HTTPS.');
}
function fileToDataUrl(blob) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
}
function dataUrlToBlob(value) { const [head, data] = value.split(','); const mime = head.match(/:(.*?);/)[1]; const bytes = atob(data); const array = Uint8Array.from(bytes, (c) => c.charCodeAt(0)); return new Blob([array], { type: mime }); }
function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelectorAll('#create-button,#hero-create,#empty-create').forEach((button) => button.addEventListener('click', () => openEditor()));
document.querySelectorAll('#close-dialog,#cancel-dialog').forEach((button) => button.addEventListener('click', () => dialog.close()));
dialog.addEventListener('close', clearDialog);
document.querySelectorAll('.dropzone').forEach((zone) => {
  zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (event) => { event.preventDefault(); zone.classList.remove('dragover'); const input = zone.querySelector('input'); if (event.dataTransfer.files[0]) { const transfer = new DataTransfer(); transfer.items.add(event.dataTransfer.files[0]); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); } });
});
$('marker-file').addEventListener('change', (event) => {
  const file = event.target.files[0]; if (!file) return;
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { $('dialog-error').textContent = 'Escolha uma imagem JPG, PNG ou WEBP.'; return; }
  if (file.size > 20 * 1024 ** 2) { $('dialog-error').textContent = 'A imagem precisa ter menos de 20 MB.'; return; }
  markerUpload = file; descriptorUpload = [];
  if (!window.__cloudHydrating) window.__cloudMarkerEdited = true;
  $('descriptor-files').value = ''; $('descriptor-file-name').textContent = 'Imagem alterada — gere novos descritores NFT.';
  $('download-package').classList.add('hidden');
  $('marker-file-name').textContent = file.name; $('dialog-error').textContent = '';
});
$('model-file').addEventListener('change', (event) => {
  const file = event.target.files[0]; if (!file) return;
  if (!file.name.toLowerCase().endsWith('.glb')) { $('dialog-error').textContent = 'Escolha um modelo .glb.'; return; }
  if (file.size > 50 * 1024 ** 2) { $('dialog-error').textContent = 'O GLB precisa ter até 50 MB para ser hospedado no repositório GitHub.'; return; }
  $('dialog-error').textContent = ''; setModelFile(file, file.name);
  if (!window.__cloudHydrating) window.__cloudModelEdited = true;
});
$('descriptor-files').addEventListener('change', (event) => {
  const files = [...event.target.files];
  if (!files.length) return;
  const found = new Set(files.map((file) => file.name.split('.').pop().toLowerCase()));
  if (files.length !== 3 || !['fset','fset3','iset'].every((ext) => found.has(ext))) {
    descriptorUpload = null; event.target.value = '';
    $('descriptor-file-name').textContent = 'Selecione um arquivo .fset, um .fset3 e um .iset.';
    $('dialog-error').textContent = 'Os descritores NFT precisam incluir os três formatos: .fset, .fset3 e .iset.'; return;
  }
  descriptorUpload = files.map((file) => ({ name: file.name, blob: file }));
  if (!window.__cloudHydrating) window.__cloudDescriptorsEdited = true;
  $('descriptor-file-name').textContent = files.map((file) => file.name).join(' · ');
  $('dialog-error').textContent = '';
  const old = projects.find((p) => p.id === $('project-id').value);
  if (isPackageReady({ markerBlob: markerUpload || old?.markerBlob, modelBlob: modelUpload || old?.modelBlob, descriptorFiles: descriptorUpload })) $('download-package').classList.remove('hidden');
});
$('animation-select').addEventListener('change', () => { modelViewer.animationName = $('animation-select').value || null; modelViewer.autoplay = !!modelViewer.animationName; });
$('model-scale').addEventListener('input', (event) => { $('scale-value').textContent = `${Number(event.target.value).toFixed(1)}×`; });

document.getElementById('project-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('dialog-error').textContent = '';
  const publishNow = event.submitter?.id === 'publish-now';
  const id = $('project-id').value; const old = projects.find((p) => p.id === id);
  const name = $('project-name').value.trim();
  if (!name) { $('dialog-error').textContent = 'Informe um nome para o projeto.'; return; }
  const project = { ...(old || {}), id: id || newId(), name,
    mode: $('mode-location').checked ? 'location' : 'marker',
    markerChanged: !!window.__cloudMarkerEdited, modelChanged: !!window.__cloudModelEdited,
    descriptorsChanged: !!window.__cloudDescriptorsEdited,
    latitude: $('latitude').value === '' ? null : Number($('latitude').value),
    longitude: $('longitude').value === '' ? null : Number($('longitude').value),
    altitude: $('altitude').value === '' ? null : Number($('altitude').value),
    markerBlob: markerUpload || old?.markerBlob || null, markerName: markerUpload?.name || old?.markerName || '',
    modelBlob: modelUpload || old?.modelBlob || null, modelName: modelUpload?.name || old?.modelName || '',
    animation: $('animation-select').value || '', scale: Number($('model-scale').value || 1),
    descriptorFiles: descriptorUpload || old?.descriptorFiles || [],
    tint: old?.tint || ['violet','peach','blue','green'][projects.length % 4],
    updatedAt: Date.now(), createdAt: old?.createdAt || Date.now() };
  if (markerUpload && thumbUrls.has(project.id)) { URL.revokeObjectURL(thumbUrls.get(project.id)); thumbUrls.delete(project.id); }
  try {
    const result = await saveRecord(project);
    await refresh(); dialog.close();
    if (publishNow && window.publishProjectById) await window.publishProjectById(project.id, project);
    else notify(result?.volatile
      ? 'Rascunho mantido nesta aba. Publique no GitHub para guardar os arquivos e gerar o link.'
      : 'Rascunho salvo neste navegador. Publique no GitHub para gerar o link compartilhável.');
  } catch (error) {
    if (publishNow && window.publishProjectById) {
      window.rememberInnyxProject(project);
      dialog.close();
      await window.publishProjectById(project.id, project);
      return;
    }
    $('dialog-error').textContent = error?.name === 'QuotaExceededError'
      ? 'O armazenamento local está cheio. Use “Salvar e publicar” para guardar este projeto no GitHub.'
      : `Falha ao salvar no navegador${error?.name ? ` (${error.name})` : ''}. Tente “Salvar e publicar” para enviar o projeto ao GitHub.`;
  }
});
$('project-list').addEventListener('click', async (event) => {
  const row = event.target.closest('.project-row'); if (!row) return;
  const item = projects.find((p) => p.id === row.dataset.id); if (!item) return;
  if (event.target.closest('[data-action="menu"]')) {
    const current = row.querySelector('.row-menu');
    document.querySelectorAll('.row-menu').forEach((menu) => menu.remove());
    if (current) return;
    row.insertAdjacentHTML('beforeend', `<div class="row-menu"><button data-action="edit">Editar projeto</button>${isPackageReady(item) && item.mode !== 'location' && !item.github?.publishedAt ? '<button data-action="download">Baixar pacote</button>' : ''}<button class="menu-danger" data-action="delete">Excluir projeto</button></div>`);
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) { openEditor(item); return; }
  if (action === 'edit') openEditor(item);
  if (action === 'download') await exportExperience(item);
  if (action === 'delete' && confirm(`Excluir “${item.name}” e seus arquivos deste navegador?`)) { URL.revokeObjectURL(thumbUrls.get(item.id) || ''); thumbUrls.delete(item.id); await deleteRecord(item.id); await refresh(); notify('Projeto excluído.'); }
});
$('delete-project').addEventListener('click', async () => {
  const id = $('project-id').value; const item = projects.find((p) => p.id === id);
  if (item && confirm(`Excluir “${item.name}” e seus arquivos deste navegador?`)) { URL.revokeObjectURL(thumbUrls.get(item.id) || ''); thumbUrls.delete(item.id); await deleteRecord(id); await refresh(); dialog.close(); notify('Projeto excluído.'); }
});
$('download-package').addEventListener('click', async () => {
  const project = projects.find((p) => p.id === $('project-id').value);
  if (project) await exportExperience({ ...project, name: $('project-name').value.trim() || project.name,
    markerBlob: markerUpload || project.markerBlob, markerName: markerUpload?.name || project.markerName,
    modelBlob: modelUpload || project.modelBlob, modelName: modelUpload?.name || project.modelName,
    descriptorFiles: descriptorUpload || project.descriptorFiles, animation: $('animation-select').value || project.animation,
    scale: Number($('model-scale').value || project.scale || 1) });
});
$('search-input').addEventListener('input', render);
document.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => {
  activeFilter = chip.dataset.filter; document.querySelectorAll('.chip').forEach((el) => el.classList.toggle('active', el === chip)); render();
}));
document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
  activeView = button.dataset.view; document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el === button));
  const titles = { projects: ['Experiências','Crie, organize e publique suas experiências de realidade aumentada.'], markers: ['Marcadores','Organize as imagens associadas aos seus projetos.'], assets: ['Biblioteca de assets','Encontre modelos GLB e imagens adicionados aos projetos.'], settings: ['Configurações','Seus dados ficam armazenados localmente neste navegador.'] };
  $('breadcrumb-current').textContent = titles[activeView][0]; $('page-title').textContent = titles[activeView][0]; $('page-description').textContent = titles[activeView][1]; render();
}));
$('filter-button').addEventListener('click', () => { activeFilter = activeFilter === 'all' ? 'draft' : activeFilter === 'draft' ? 'published' : 'all'; document.querySelectorAll('.chip').forEach((el) => el.classList.toggle('active', el.dataset.filter === activeFilter)); render(); });
$('help-button').addEventListener('click', () => $('help-dialog').showModal()); $('close-help').addEventListener('click', () => $('help-dialog').close());

$('backup-button').addEventListener('click', async () => {
  try {
    const payload = await Promise.all(projects.map(async (p) => ({ ...p,
      markerBlob: p.markerBlob ? await fileToDataUrl(p.markerBlob) : null,
      modelBlob: p.modelBlob ? await fileToDataUrl(p.modelBlob) : null,
      descriptorFiles: await Promise.all((p.descriptorFiles || []).map(async (file) => ({ name: file.name, blob: await fileToDataUrl(file.blob) }))) })));
    download(`innyx-webar-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify({ format: 'innyx-webar-backup', version: 1, projects: payload }, null, 2), 'application/json');
    notify('Backup exportado. Guarde o arquivo em local seguro.');
  } catch { notify('Não foi possível exportar o backup.'); }
});
$('import-input').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== 'innyx-webar-backup' || !Array.isArray(data.projects)) throw new Error('Formato não reconhecido');
    for (const project of data.projects) {
      project.id ||= newId(); project.updatedAt = Date.now();
      if (typeof project.markerBlob === 'string') project.markerBlob = dataUrlToBlob(project.markerBlob);
      if (typeof project.modelBlob === 'string') project.modelBlob = dataUrlToBlob(project.modelBlob);
      project.descriptorFiles = (project.descriptorFiles || []).map((item) => ({ ...item, blob: typeof item.blob === 'string' ? dataUrlToBlob(item.blob) : item.blob }));
      await saveRecord(project);
    }
    await refresh(); notify(`${data.projects.length} projeto(s) importado(s).`);
  } catch { notify('Esse arquivo não parece ser um backup válido do InnyxWebAR.'); }
  event.target.value = '';
});

(async function init() {
  try { db = await openDatabase(); await refresh(); }
  catch {
    db = null;
    await refresh();
    notify('Armazenamento local indisponível. “Salvar e publicar” guarda o projeto no GitHub; rascunhos ficam nesta aba.');
  }
})();


