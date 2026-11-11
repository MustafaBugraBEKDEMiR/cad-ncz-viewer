/**
 * CAD & NCZ Viewer (cad-ncz-viewer) — Main Application Controller
 */

import { EntityType, computeEntityArea, computeEntityLength } from './core/model.js';
import { buildSpatialIndex, displayXY, findSnapPoint, hitTest } from './core/spatial.js';
import { CadRenderer } from './core/renderer.js';
import { exportDocument } from './core/exporter.js';
import { parseCadFile } from './parsers/index.js';

const I18N = {
  tr: {
    openFile: 'Dosya Aç',
    samples: 'Örnekler',
    select: 'Seç',
    pan: 'Kaydır',
    measure: 'Mesafe',
    area: 'Alan',
    grid: 'Izgara',
    fit: 'Sığdır',
    export: 'Dışa Aktar',
    layersTab: 'Katmanlar',
    searchTab: 'Öğe Arama',
    selectedEntity: 'Seçili Öğe',
    projectInfo: 'Proje & Metaveri',
    allOn: 'Tümünü Aç',
    allOff: 'Tümünü Kapat',
    emptyEntity: 'İncelemek için çizim üzerinde bir nesneye tıklayın.',
    measureHint: 'Ölçüm noktaları eklemek için tıklayın • Bitirmek için sağ tıklayın veya ESC',
    orbitHint: '3D Yörünge: Sürükleyerek döndürün • Sağ/Orta tuş ile kaydırın'
  },
  en: {
    openFile: 'Open File',
    samples: 'Samples',
    select: 'Select',
    pan: 'Pan',
    measure: 'Distance',
    area: 'Area',
    grid: 'Grid',
    fit: 'Fit View',
    export: 'Export',
    layersTab: 'Layers',
    searchTab: 'Search',
    selectedEntity: 'Selected Entity',
    projectInfo: 'Project & Metadata',
    allOn: 'Show All',
    allOff: 'Hide All',
    emptyEntity: 'Click any entity on the canvas to inspect its properties.',
    measureHint: 'Click points to measure • Right-click or ESC to clear',
    orbitHint: '3D Orbit: Drag to rotate • Right/Middle drag to pan'
  }
};

const TYPE_LABELS = {
  POINT: 'Nokta (Point)',
  LINE: 'Doğru (Line)',
  POLYLINE: 'Çoklu Doğru (Polyline)',
  POLYGON: 'Kapalı Alan (Polygon)',
  CIRCLE: 'Çember (Circle)',
  ARC: 'Yay (Arc)',
  ELLIPSE: 'Elips (Ellipse)',
  TEXT: 'Yazı (Text)',
  SYMBOL: 'Sembol / Blok',
  FACE3D: '3D Yüzey (Face)'
};

const state = {
  doc: null,
  spatial: null,
  tool: 'select',
  osnap: true,
  showGrid: true,
  swapAxes: false,
  selectedId: null,
  hoveredEntity: null,
  snapPoint: null,
  measurePoints: [],
  measureCursor: null,
  themeOrder: ['dark', 'charcoal', 'light'],
  themeIdx: 0,
  lang: 'tr',
  dragging: false,
  dragMode: 'pan',
  dragStart: { x: 0, y: 0 },
  dragMoved: false,
  camStart: null,
  lastUrlRevoke: null
};

const canvas = document.getElementById('cad-canvas');
const viewport = document.getElementById('viewport');
const renderer = new CadRenderer(canvas);

// UI Element References
const el = {
  fileInput: document.getElementById('file-input'),
  docBadge: document.getElementById('doc-badge'),
  layerList: document.getElementById('layer-list'),
  layerFilter: document.getElementById('layer-filter'),
  entitySearch: document.getElementById('entity-search'),
  searchResults: document.getElementById('search-results'),
  entityInspector: document.getElementById('entity-inspector'),
  projectInspector: document.getElementById('project-inspector'),
  thumbWrap: document.getElementById('thumbnail-wrap'),
  thumbImg: document.getElementById('ncz-thumbnail'),
  btnZoomSelected: document.getElementById('btn-zoom-selected'),
  statusFormat: document.getElementById('status-format'),
  statusCoords: document.getElementById('status-coords'),
  statusSnap: document.getElementById('status-snap'),
  statusCounts: document.getElementById('status-counts'),
  statusZoom: document.getElementById('status-zoom'),
  scaleBarLabel: document.getElementById('scale-bar-label'),
  scaleBarLine: document.getElementById('scale-bar-line'),
  floatingHint: document.getElementById('floating-hint'),
  floatingHintText: document.getElementById('floating-hint-text'),
  btnClearMeasure: document.getElementById('btn-clear-measure'),
  dropOverlay: document.getElementById('drop-overlay'),
  toast: document.getElementById('toast'),
  btnOsnap: document.getElementById('btn-osnap'),
  btnGrid: document.getElementById('btn-grid'),
  btn3d: document.getElementById('btn-3d'),
  btnSwapAxes: document.getElementById('btn-swap-axes'),
  btnLang: document.getElementById('btn-lang'),
  helpModal: document.getElementById('help-modal')
};

let rafPending = false;
function requestRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    renderer.render(state.doc, state.spatial, state);
    updateScaleBar();
  });
}

let toastTimer = null;
function showToast(msg, ms = 3200) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatNum(v, dec = 2) {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('tr-TR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function updateFloatingHint() {
  const dict = I18N[state.lang];
  if (state.tool === 'distance' || state.tool === 'area') {
    el.floatingHintText.textContent = dict.measureHint;
    el.btnClearMeasure.hidden = state.measurePoints.length === 0;
    el.floatingHint.hidden = false;
  } else if (renderer.camera.view3D) {
    el.floatingHintText.textContent = dict.orbitHint;
    el.btnClearMeasure.hidden = true;
    el.floatingHint.hidden = false;
  } else {
    el.floatingHint.hidden = true;
  }
}

function updateScaleBar() {
  const pxTarget = 90;
  const worldSpan = pxTarget / renderer.camera.scale;
  if (!Number.isFinite(worldSpan) || worldSpan <= 0) return;
  const pow10 = Math.pow(10, Math.floor(Math.log10(worldSpan)));
  const norm = worldSpan / pow10;
  let nice = pow10;
  if (norm > 5) nice = 10 * pow10;
  else if (norm > 2) nice = 5 * pow10;
  else if (norm > 1) nice = 2 * pow10;

  const widthPx = Math.max(24, Math.min(180, nice * renderer.camera.scale));
  el.scaleBarLine.style.width = `${Math.round(widthPx)}px`;
  const unit = state.doc?.metadata?.units || 'm';
  if (unit === 'm' && nice >= 1000) {
    el.scaleBarLabel.textContent = `${(nice / 1000).toFixed(nice % 1000 === 0 ? 0 : 1)} km`;
  } else {
    const dec = nice < 1 ? Math.min(3, Math.ceil(-Math.log10(nice))) : 0;
    el.scaleBarLabel.textContent = `${nice.toFixed(dec)} ${unit}`.trim();
  }

  // Update Zoom % relative to fit scale
  if (state.fitScale > 0) {
    const pct = Math.round((renderer.camera.scale / state.fitScale) * 100);
    el.statusZoom.textContent = `${pct}%`;
  }
}

function loadDocument(doc) {
  if (state.lastUrlRevoke) {
    URL.revokeObjectURL(state.lastUrlRevoke);
    state.lastUrlRevoke = null;
  }

  state.doc = doc;
  state.spatial = buildSpatialIndex(doc);
  state.selectedId = null;
  state.hoveredEntity = null;
  state.snapPoint = null;
  state.measurePoints = [];
  state.measureCursor = null;
  state.swapAxes = false;

  renderer.swapAxes = false;
  renderer.camera.view3D = Boolean(doc.defaultView3D);
  el.btn3d.classList.toggle('active', renderer.camera.view3D);
  el.btnSwapAxes.classList.toggle('active', state.swapAxes);

  renderer.fitBounds(doc.bounds);
  state.fitScale = renderer.camera.scale;

  if (doc.metadata?.thumbnailDataUrl?.startsWith('blob:')) {
    state.lastUrlRevoke = doc.metadata.thumbnailDataUrl;
  }

  el.docBadge.textContent = `${doc.fileName} (${doc.format})`;
  el.statusFormat.textContent = doc.format;
  el.statusCounts.textContent = `${doc.entities.length.toLocaleString('tr-TR')} nesne • ${doc.layers.size} katman`;

  renderLayerList();
  renderProjectInspector();
  renderEntityInspector(null);
  renderSearchResults('');
  updateFloatingHint();
  requestRender();
}

async function openFileBuffer(buffer, fileName) {
  try {
    const doc = await parseCadFile(buffer, fileName);
    loadDocument(doc);
    showToast(`${fileName} yüklendi (${doc.entities.length} nesne, ${doc.layers.size} katman).`);
  } catch (err) {
    console.error(err);
    showToast(`Hata: ${err.message}`, 5000);
  }
}

async function loadSampleUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    const name = url.split('/').pop();
    await openFileBuffer(buffer, name);
  } catch (err) {
    console.warn('Örnek dosya yüklenemedi:', err);
    showToast('Örnek dosya yüklenemedi; dosya aç butonunu veya sürükle-bırakı kullanabilirsiniz.', 4500);
  }
}

/* ==================== Layers & Search ==================== */
function renderLayerList() {
  const doc = state.doc;
  el.layerList.innerHTML = '';
  if (!doc) return;

  const q = el.layerFilter.value.trim().toLowerCase();
  const layers = Array.from(doc.layers.values())
    .filter((l) => !q || l.name.toLowerCase().includes(q))
    .sort((a, b) => b.entityCount - a.entityCount || a.name.localeCompare(b.name));

  for (const layer of layers) {
    const li = document.createElement('li');
    li.className = `layer-item${layer.visible ? '' : ' hidden-layer'}`;

    const eye = document.createElement('button');
    eye.className = 'layer-eye';
    eye.title = layer.visible ? 'Katmanı Gizle' : 'Katmanı Göster';
    eye.innerHTML = layer.visible
      ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    eye.addEventListener('click', (ev) => {
      ev.stopPropagation();
      layer.visible = !layer.visible;
      renderLayerList();
      requestRender();
    });

    const swatch = document.createElement('span');
    swatch.className = 'layer-swatch';
    swatch.style.background = layer.color;

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = layer.name;
    name.title = `${layer.name} (Çift tıkla: İzole et)`;

    const isoBtn = document.createElement('button');
    isoBtn.className = 'layer-action';
    isoBtn.textContent = '◎';
    isoBtn.title = 'Katmana Odaklan';
    isoBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      zoomToLayer(layer.name);
    });

    const count = document.createElement('span');
    count.className = 'layer-count';
    count.textContent = layer.entityCount;

    li.addEventListener('click', () => {
      layer.visible = !layer.visible;
      renderLayerList();
      requestRender();
    });

    li.addEventListener('dblclick', () => {
      for (const l of doc.layers.values()) {
        l.visible = l.name === layer.name;
      }
      renderLayerList();
      zoomToLayer(layer.name);
      showToast(`Yalnızca "${layer.name}" katmanı izole edildi.`);
    });

    li.append(eye, swatch, name, isoBtn, count);
    el.layerList.appendChild(li);
  }
}

function zoomToLayer(layerName) {
  if (!state.doc) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;
  for (const e of state.doc.entities) {
    if (e.layer !== layerName || !e.bounds) continue;
    minX = Math.min(minX, e.bounds.minX);
    minY = Math.min(minY, e.bounds.minY);
    maxX = Math.max(maxX, e.bounds.maxX);
    maxY = Math.max(maxY, e.bounds.maxY);
    found = true;
  }
  if (found) {
    renderer.fitBounds({ minX, minY, maxX, maxY, minZ: 0, maxZ: 0, valid: true }, 0.14);
    requestRender();
  }
}

function renderSearchResults(query) {
  el.searchResults.innerHTML = '';
  if (!state.doc) return;
  const q = query.trim().toLowerCase();
  if (!q) {
    el.searchResults.innerHTML = '<li class="muted-empty">Metin, nokta adı veya parsel (VT_) anahtarı aramak için yazın.</li>';
    return;
  }

  const matches = [];
  for (const e of state.doc.entities) {
    const hay = [e.text, e.label, e.dbKey, e.dbTable, e.layer].filter(Boolean).join(' ').toLowerCase();
    if (hay.includes(q)) {
      matches.push(e);
      if (matches.length >= 80) break;
    }
  }

  if (matches.length === 0) {
    el.searchResults.innerHTML = '<li class="muted-empty">Eşleşen nesne bulunamadı.</li>';
    return;
  }

  for (const e of matches) {
    const li = document.createElement('li');
    li.className = 'search-item';
    const title = e.text || e.label || e.dbKey || `${TYPE_LABELS[e.type] || e.type} #${e.id}`;
    li.innerHTML = `<strong>${escapeHtml(title)}</strong><small>${escapeHtml(e.layer)} • ${TYPE_LABELS[e.type] || e.type}</small>`;
    li.addEventListener('click', () => {
      const layer = state.doc.layers.get(e.layer);
      if (layer) layer.visible = true;
      state.selectedId = e.id;
      renderLayerList();
      renderEntityInspector(e);
      zoomToEntity(e);
    });
    el.searchResults.appendChild(li);
  }
}

function zoomToEntity(e) {
  if (!e?.bounds) return;
  const spanX = Math.max(20, (e.bounds.maxX - e.bounds.minX) * 2.5);
  const spanY = Math.max(20, (e.bounds.maxY - e.bounds.minY) * 2.5);
  const cx = (e.bounds.minX + e.bounds.maxX) * 0.5;
  const cy = (e.bounds.minY + e.bounds.maxY) * 0.5;
  renderer.fitBounds({
    minX: cx - spanX * 0.5,
    maxX: cx + spanX * 0.5,
    minY: cy - spanY * 0.5,
    maxY: cy + spanY * 0.5,
    minZ: e.bounds.minZ || 0,
    maxZ: e.bounds.maxZ || 0,
    valid: true
  }, 0.2);
  requestRender();
}

/* ==================== Inspectors ==================== */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function kvRow(k, v) {
  return `<div class="kv-row"><span class="kv-key">${escapeHtml(k)}</span><span class="kv-val">${escapeHtml(v)}</span></div>`;
}

function renderEntityInspector(e) {
  if (!e) {
    el.btnZoomSelected.hidden = true;
    el.entityInspector.innerHTML = `<p class="muted-empty">${I18N[state.lang].emptyEntity}</p>`;
    return;
  }

  el.btnZoomSelected.hidden = false;
  const rows = [];
  rows.push(kvRow('Tür', e.nczType || TYPE_LABELS[e.type] || e.type));
  rows.push(kvRow('Katman', e.layer));
  if (e.label) rows.push(kvRow('Etiket / Ad', e.label));
  if (e.text) rows.push(kvRow('Metin', e.text));
  if (e.dbTable) rows.push(kvRow('NCZ Tablo', e.dbTable));
  if (e.dbKey) rows.push(kvRow('VT Anahtarı', e.dbKey));
  if (e.symbolId !== undefined) rows.push(kvRow('Sembol No', `#${e.symbolId}`));

  const isSurvey = state.doc?.defaultSwapAxes && !state.swapAxes;
  const xLbl = isSurvey ? 'Y (Sağa)' : 'X';
  const yLbl = isSurvey ? 'X (Yukarı)' : 'Y';

  if (e.x !== undefined && e.y !== undefined) {
    const d = displayXY(e.x, e.y, state.swapAxes);
    rows.push(kvRow(xLbl, formatNum(d.x, 3)));
    rows.push(kvRow(yLbl, formatNum(d.y, 3)));
    if (e.z) rows.push(kvRow('Kot (Z)', `${formatNum(e.z, 3)} m`));
  } else if (e.x1 !== undefined) {
    const d1 = displayXY(e.x1, e.y1, state.swapAxes);
    const d2 = displayXY(e.x2, e.y2, state.swapAxes);
    rows.push(kvRow(`Başlangıç ${xLbl}/${yLbl}`, `${formatNum(d1.x, 2)} / ${formatNum(d1.y, 2)}`));
    rows.push(kvRow(`Bitiş ${xLbl}/${yLbl}`, `${formatNum(d2.x, 2)} / ${formatNum(d2.y, 2)}`));
  } else if (e.cx !== undefined) {
    const c = displayXY(e.cx, e.cy, state.swapAxes);
    rows.push(kvRow(`Merkez ${xLbl}/${yLbl}`, `${formatNum(c.x, 2)} / ${formatNum(c.y, 2)}`));
    rows.push(kvRow('Yarıçap (R)', `${formatNum(e.r, 3)} m`));
  } else if (e.points?.length) {
    rows.push(kvRow('Köşe Sayısı', String(e.points.length)));
    if (e.bounds && (Math.abs(e.bounds.minZ) > 1e-4 || Math.abs(e.bounds.maxZ) > 1e-4)) {
      rows.push(kvRow('Kot Aralığı (Z)', `${formatNum(e.bounds.minZ, 2)} .. ${formatNum(e.bounds.maxZ, 2)} m`));
    }
  }

  const len = computeEntityLength(e);
  if (len > 0) rows.push(kvRow('Uzunluk / Çevre', `${formatNum(len, 2)} m`));

  const area = computeEntityArea(e);
  if (area > 0) {
    rows.push(kvRow('Alan (m²)', `${formatNum(area, 2)} m²`));
    if (area >= 1000) rows.push(kvRow('Alan (Dönüm/Ha)', `${formatNum(area / 1000, 3)} da / ${formatNum(area / 10000, 4)} ha`));
  }

  if (e.props && typeof e.props === 'object') {
    for (const [k, v] of Object.entries(e.props).slice(0, 8)) {
      if (v !== null && v !== undefined && v !== '') rows.push(kvRow(k, String(v)));
    }
  }

  el.entityInspector.innerHTML = rows.join('');
}

function renderProjectInspector() {
  const doc = state.doc;
  if (!doc) return;
  const rows = [];
  rows.push(kvRow('Dosya', doc.fileName));
  rows.push(kvRow('Boyut', formatSize(doc.fileSize)));
  rows.push(kvRow('Biçim / Sürüm', doc.metadata.version || doc.format));
  if (doc.metadata.author) rows.push(kvRow('Oluşturan', doc.metadata.author));
  if (doc.metadata.crs) rows.push(kvRow('Projeksiyon / CRS', doc.metadata.crs));
  if (doc.metadata.units) rows.push(kvRow('Birim', doc.metadata.units));

  if (doc.bounds?.valid) {
    const b0 = displayXY(doc.bounds.minX, doc.bounds.minY, state.swapAxes);
    const b1 = displayXY(doc.bounds.maxX, doc.bounds.maxY, state.swapAxes);
    rows.push(kvRow('Genişlik ΔX', `${formatNum(Math.abs(b1.x - b0.x), 2)}`));
    rows.push(kvRow('Yükseklik ΔY', `${formatNum(Math.abs(b1.y - b0.y), 2)}`));
    if (doc.hasZ) {
      rows.push(kvRow('Kot Z Min/Max', `${formatNum(doc.bounds.minZ, 2)} .. ${formatNum(doc.bounds.maxZ, 2)}`));
    }
  }

  for (const [k, v] of Object.entries(doc.metadata.extra || {})) {
    rows.push(kvRow(k, v));
  }

  el.projectInspector.innerHTML = rows.join('');

  if (doc.metadata.thumbnailDataUrl) {
    el.thumbImg.src = doc.metadata.thumbnailDataUrl;
    el.thumbWrap.hidden = false;
  } else {
    el.thumbWrap.hidden = true;
    el.thumbImg.removeAttribute('src');
  }
}

/* ==================== Tool & Navigation Handlers ==================== */
function setTool(toolName) {
  state.tool = toolName;
  document.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === toolName);
  });
  viewport.classList.toggle('tool-pan', toolName === 'pan');
  if (toolName !== 'distance' && toolName !== 'area') {
    state.measurePoints = [];
    state.measureCursor = null;
  }
  updateFloatingHint();
  requestRender();
}

function updateCursorHud(sx, sy) {
  const w = renderer.screenToWorld(sx, sy);
  let displayX = w.x;
  let displayY = w.y;
  let zText = '';

  if (state.osnap && state.doc && !renderer.camera.view3D) {
    const tol = 12 / renderer.camera.scale;
    const snap = findSnapPoint(state.doc, state.spatial, w.x, w.y, tol, state.swapAxes);
    state.snapPoint = snap;
    if (snap) {
      displayX = snap.x;
      displayY = snap.y;
      if (snap.z) zText = `  |  Z: ${snap.z.toFixed(2)}`;
      const kindTr = snap.kind === 'endpoint' ? 'UÇ' : (snap.kind === 'midpoint' ? 'ORTA' : 'MERKEZ');
      el.statusSnap.textContent = `OSNAP: ${kindTr}`;
      el.statusSnap.hidden = false;
    } else {
      el.statusSnap.hidden = true;
    }
  } else {
    state.snapPoint = null;
    el.statusSnap.hidden = true;
  }

  const isSurvey = state.doc?.defaultSwapAxes && !state.swapAxes;
  const xLabel = isSurvey ? 'Y' : 'X';
  const yLabel = isSurvey ? 'X' : 'Y';
  el.statusCoords.textContent = `${xLabel}: ${displayX.toFixed(2)}  |  ${yLabel}: ${displayY.toFixed(2)}${zText}`;

  if (state.tool === 'distance' || state.tool === 'area') {
    state.measureCursor = state.snapPoint ? { ...state.snapPoint } : { x: w.x, y: w.y, z: 0 };
  }
}

canvas.addEventListener('pointerdown', (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;

  state.dragging = true;
  state.dragMoved = false;
  state.dragStart = { x: ev.clientX, y: ev.clientY };
  state.camStart = { ...renderer.camera };

  const isMiddleOrRight = ev.button === 1 || ev.button === 2;
  if (isMiddleOrRight || state.tool === 'pan' || ev.shiftKey) {
    state.dragMode = 'pan';
    viewport.classList.add('panning');
  } else if (renderer.camera.view3D && ev.button === 0) {
    state.dragMode = 'orbit';
  } else {
    state.dragMode = 'select';
  }

  if (ev.button === 2 && (state.tool === 'distance' || state.tool === 'area')) {
    // Finish active measure chain on right-click
    state.measureCursor = null;
    requestRender();
  }
  void sx; void sy;
});

canvas.addEventListener('pointermove', (ev) => {
  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;

  if (state.dragging) {
    const dx = ev.clientX - state.dragStart.x;
    const dy = ev.clientY - state.dragStart.y;
    if (Math.hypot(dx, dy) > 3) state.dragMoved = true;

    if (state.dragMode === 'pan' || (state.dragMoved && state.tool === 'select' && !renderer.camera.view3D)) {
      renderer.camera.centerX = state.camStart.centerX - dx / renderer.camera.scale;
      renderer.camera.centerY = state.camStart.centerY + dy / renderer.camera.scale;
      requestRender();
      return;
    }
    if (state.dragMode === 'orbit') {
      renderer.camera.yaw = state.camStart.yaw - dx * 0.008;
      renderer.camera.pitch = Math.max(-1.45, Math.min(1.45, state.camStart.pitch + dy * 0.008));
      requestRender();
      return;
    }
  }

  updateCursorHud(sx, sy);

  if (state.doc && state.tool === 'select' && !renderer.camera.view3D && !state.dragging) {
    const w = renderer.screenToWorld(sx, sy);
    const tol = 8 / renderer.camera.scale;
    state.hoveredEntity = hitTest(state.doc, state.spatial, w.x, w.y, tol, state.swapAxes);
  } else {
    state.hoveredEntity = null;
  }
  requestRender();
});

canvas.addEventListener('pointerup', (ev) => {
  if (canvas.hasPointerCapture(ev.pointerId)) {
    canvas.releasePointerCapture(ev.pointerId);
  }
  const wasMoved = state.dragMoved;
  state.dragging = false;
  viewport.classList.remove('panning');

  if (wasMoved || ev.button !== 0) return;

  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;
  const w = renderer.screenToWorld(sx, sy);

  if (state.tool === 'distance' || state.tool === 'area') {
    const pt = state.snapPoint ? { ...state.snapPoint } : { x: w.x, y: w.y, z: 0 };
    state.measurePoints.push(pt);
    updateFloatingHint();
    requestRender();
    return;
  }

  if (state.tool === 'select' && state.doc) {
    const tol = 10 / renderer.camera.scale;
    const hit = hitTest(state.doc, state.spatial, w.x, w.y, tol, state.swapAxes);
    state.selectedId = hit ? hit.id : null;
    renderEntityInspector(hit);
    requestRender();
  }
});

canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;

  const before = renderer.screenToWorld(sx, sy);
  const factor = ev.deltaY < 0 ? 1.16 : 1 / 1.16;
  renderer.camera.scale = Math.max(1e-6, Math.min(1e7, renderer.camera.scale * factor));
  const after = renderer.screenToWorld(sx, sy);

  if (!renderer.camera.view3D) {
    renderer.camera.centerX += before.x - after.x;
    renderer.camera.centerY += before.y - after.y;
  }
  requestRender();
}, { passive: false });

/* ==================== UI Controls & Events ==================== */
document.querySelectorAll('[data-tool]').forEach((btn) => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

el.btnOsnap.addEventListener('click', () => {
  state.osnap = !state.osnap;
  el.btnOsnap.classList.toggle('active', state.osnap);
  if (!state.osnap) {
    state.snapPoint = null;
    el.statusSnap.hidden = true;
  }
  requestRender();
});

el.btnGrid.addEventListener('click', () => {
  state.showGrid = !state.showGrid;
  el.btnGrid.classList.toggle('active', state.showGrid);
  requestRender();
});

el.btn3d.addEventListener('click', () => {
  renderer.camera.view3D = !renderer.camera.view3D;
  el.btn3d.classList.toggle('active', renderer.camera.view3D);
  updateFloatingHint();
  requestRender();
});

el.btnSwapAxes.addEventListener('click', () => {
  state.swapAxes = !state.swapAxes;
  renderer.swapAxes = state.swapAxes;
  el.btnSwapAxes.classList.toggle('active', state.swapAxes);
  if (state.doc) {
    renderer.fitBounds(state.doc.bounds);
    renderProjectInspector();
    const sel = state.doc.entities.find((item) => item.id === state.selectedId) || null;
    renderEntityInspector(sel);
  }
  requestRender();
});

document.getElementById('btn-fit').addEventListener('click', () => {
  if (state.doc) {
    renderer.fitBounds(state.doc.bounds);
    state.fitScale = renderer.camera.scale;
    requestRender();
  }
});

document.getElementById('btn-theme').addEventListener('click', () => {
  state.themeIdx = (state.themeIdx + 1) % state.themeOrder.length;
  const theme = state.themeOrder[state.themeIdx];
  document.documentElement.setAttribute('data-theme', theme);
  renderer.setTheme(theme);
  requestRender();
});

el.btnLang.addEventListener('click', () => {
  state.lang = state.lang === 'tr' ? 'en' : 'tr';
  el.btnLang.textContent = state.lang.toUpperCase();
  const dict = I18N[state.lang];
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n;
    if (dict[key]) node.textContent = dict[key];
  });
  updateFloatingHint();
});

el.btnClearMeasure.addEventListener('click', () => {
  state.measurePoints = [];
  state.measureCursor = null;
  updateFloatingHint();
  requestRender();
});

el.btnZoomSelected.addEventListener('click', () => {
  const ent = state.doc?.entities.find((item) => item.id === state.selectedId);
  if (ent) zoomToEntity(ent);
});

// Dropdowns
function setupDropdown(btnId, menuId) {
  const btn = document.getElementById(btnId);
  const menu = document.getElementById(menuId);
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const wasOpen = menu.classList.contains('open');
    document.querySelectorAll('.dropdown-menu').forEach((m) => m.classList.remove('open'));
    if (!wasOpen) {
      const r = btn.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      if (menu.classList.contains('align-right')) {
        menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
        menu.style.left = 'auto';
      } else {
        menu.style.left = `${Math.max(8, r.left)}px`;
      }
      menu.classList.add('open');
    }
  });
}
setupDropdown('btn-samples', 'samples-menu');
setupDropdown('btn-export', 'export-menu');

document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown-menu').forEach((m) => m.classList.remove('open'));
});

document.querySelectorAll('[data-sample]').forEach((btn) => {
  btn.addEventListener('click', () => loadSampleUrl(btn.dataset.sample));
});

document.querySelectorAll('[data-export]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!state.doc) return showToast('Dışa aktarmak için önce bir çizim açın.');
    exportDocument(state.doc, btn.dataset.export, state.swapAxes, canvas);
    showToast(`${btn.dataset.export.toUpperCase()} çıktısı hazırlanıyor...`);
  });
});

// Sidebar Tabs & Layer Bulk Toggles
document.querySelectorAll('.panel-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.panel-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`pane-${tab.dataset.tab}`).classList.add('active');
  });
});

el.layerFilter.addEventListener('input', renderLayerList);
el.entitySearch.addEventListener('input', () => renderSearchResults(el.entitySearch.value));

document.getElementById('btn-layers-all').addEventListener('click', () => {
  if (!state.doc) return;
  for (const l of state.doc.layers.values()) l.visible = true;
  renderLayerList();
  requestRender();
});
document.getElementById('btn-layers-none').addEventListener('click', () => {
  if (!state.doc) return;
  for (const l of state.doc.layers.values()) l.visible = false;
  renderLayerList();
  requestRender();
});

// Mobile Drawer Toggles
document.getElementById('btn-toggle-left').addEventListener('click', () => {
  document.getElementById('sidebar-left').classList.toggle('open');
  document.getElementById('sidebar-right').classList.remove('open');
});
document.getElementById('btn-toggle-right').addEventListener('click', () => {
  document.getElementById('sidebar-right').classList.toggle('open');
  document.getElementById('sidebar-left').classList.remove('open');
});

// Help Modal
document.getElementById('btn-help').addEventListener('click', () => { el.helpModal.hidden = false; });
document.getElementById('btn-close-help').addEventListener('click', () => { el.helpModal.hidden = true; });
el.helpModal.addEventListener('click', (ev) => {
  if (ev.target === el.helpModal) el.helpModal.hidden = true;
});

// File Input & Drag/Drop
el.fileInput.addEventListener('change', async () => {
  const file = el.fileInput.files?.[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  await openFileBuffer(buf, file.name);
  el.fileInput.value = '';
});

let dragCounter = 0;
window.addEventListener('dragenter', (ev) => {
  ev.preventDefault();
  dragCounter++;
  el.dropOverlay.hidden = false;
});
window.addEventListener('dragover', (ev) => ev.preventDefault());
window.addEventListener('dragleave', () => {
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) el.dropOverlay.hidden = true;
});
window.addEventListener('drop', async (ev) => {
  ev.preventDefault();
  dragCounter = 0;
  el.dropOverlay.hidden = true;
  const file = ev.dataTransfer?.files?.[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  await openFileBuffer(buf, file.name);
});

// Keyboard Shortcuts
window.addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
  const k = ev.key.toLowerCase();
  if (k === 'v') setTool('select');
  else if (k === 'h') setTool('pan');
  else if (k === 'm') setTool('distance');
  else if (k === 'a') setTool('area');
  else if (k === 'f') document.getElementById('btn-fit').click();
  else if (k === 's') el.btnOsnap.click();
  else if (k === 'g') el.btnGrid.click();
  else if (k === '3') el.btn3d.click();
  else if (k === 'x') el.btnSwapAxes.click();
  else if (k === 'escape') {
    el.helpModal.hidden = true;
    state.measurePoints = [];
    state.measureCursor = null;
    state.selectedId = null;
    renderEntityInspector(null);
    updateFloatingHint();
    requestRender();
  }
});

window.addEventListener('resize', () => {
  renderer.resize();
  requestRender();
});

// Initialize
const SAMPLE_ALIASES = {
  ncz: './samples/ornek_imar_projesi.ncz',
  dxf: './samples/ornek_mimari_plan.dxf',
  ncn: './samples/ornek_arazi_noktalari.ncn'
};
const qSample = new URLSearchParams(window.location.search).get('sample');
const initialSample = SAMPLE_ALIASES[qSample] || (qSample && qSample.startsWith('./samples/') ? qSample : SAMPLE_ALIASES.ncz);
renderer.resize();
loadSampleUrl(initialSample);
