// Meme editor: layered text on a canvas.
// - Drag a text layer to move it (mouse or touch, Pointer Events)
// - Drag the orange corner handle to resize; two-finger pinch also resizes
// - Drag the top handle to rotate; slider + +/-15° buttons too
// - Click the red × handle on the image to delete that layer directly
// - Double-click / double-tap a layer to edit it in place on the image
// - Quick color swatches float over the image for the selected layer
// - Editor state is kept in sessionStorage, so switching language keeps the edit
// - Everything is local: images never leave the device.

const STR = window.__STR__ || { topDefault: 'TOP TEXT', bottomDefault: 'BOTTOM TEXT', copied: 'Link copied' };
const TEMPLATES = window.__TEMPLATES__ || [];

const FONT_STACKS = {
  pressuru: `'Pressuru', 'Noto Sans SC', 'PingFang SC', sans-serif`,
  oswald: `'Oswald', 'Noto Sans SC', 'PingFang SC', sans-serif`,
  impact: `Impact, 'Arial Black', 'Noto Sans SC', 'PingFang SC', sans-serif`,
  sans: `system-ui, 'Segoe UI', 'Noto Sans SC', sans-serif`,
  serif: `Georgia, 'Times New Roman', 'Noto Serif SC', serif`,
  mono: `'Courier New', 'Noto Sans Mono', monospace`,
};
const PRESET_COLORS = ['#ffffff','#000000','#ffd400','#ff3b30','#ff8a3d','#34c759','#5b8cff','#bf5af2','#ff5b8f','#00c7be'];
const STATE_KEY = 'meme-editor-state-v2';
const RESTORE_FLAG = 'meme-editor-restore-once';
const BASE_DATA_KEY = 'meme-editor-base-data-v2';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');

let baseImage = null;
let baseInfo = { type: 'template', name: 'this-is-fine.jpg' };
let layers = [];
let selectedId = null;
let uidSeq = 0;
let restoring = false;

const $ = (id) => document.getElementById(id);
const els = {
  file: $('fileInput'), tplStrip: $('tplStrip'),
  text: $('textInput'), font: $('fontSelect'),
  size: $('sizeRange'), sizeOut: $('sizeOut'),
  rotate: $('rotateRange'), rotateOut: $('rotateOut'),
  fill: $('fillColor'), stroke: $('strokeColor'),
  strokeW: $('strokeRange'), strokeOut: $('strokeOut'),
  opacity: $('opacityRange'), opacityOut: $('opacityOut'),
  align: $('alignGroup'),
  quickBar: $('quickBar'), quickFill: $('quickFillColor'), quickStroke: $('quickStrokeColor'),
  inline: $('inlineEditor'), shareNote: $('shareNote'),
};

function selected() { return layers.find((l) => l.id === selectedId) || null; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function normDeg(d) { d = ((d + 180) % 360 + 360) % 360 - 180; return Math.round(d); }
const rad = (deg) => (deg || 0) * Math.PI / 180;

// ---------- persistence (language switch keeps the edit) ----------
let saveTimer = null;
function saveState(immediate = false) {
  if (restoring) return;
  const write = () => {
    try {
      const data = {
        v: 2, ts: Date.now(),
        canvas: { w: canvas.width, h: canvas.height },
        baseInfo,
        uidSeq, selectedId,
        layers: layers.map((l) => ({
          ...l,
          x: canvas.width ? l.x / canvas.width : 0.5,
          y: canvas.height ? l.y / canvas.height : 0.5,
          fontSize: canvas.width ? l.fontSize / canvas.width : 0.07,
          strokeWidth: canvas.width ? l.strokeWidth / canvas.width : 0.01,
        })),
      };
      sessionStorage.setItem(STATE_KEY, JSON.stringify(data));
    } catch { /* quota: keep working without persistence */ }
  };
  if (immediate) { clearTimeout(saveTimer); write(); return; }
  clearTimeout(saveTimer); saveTimer = setTimeout(write, 180);
}
function saveBaseData(dataUrl) {
  try {
    if (dataUrl) sessionStorage.setItem(BASE_DATA_KEY, dataUrl);
    else sessionStorage.removeItem(BASE_DATA_KEY);
  } catch { /* large custom image may exceed quota; layers still persist */ }
}
function readSavedState() {
  try {
    // Only a language switch restores the edit, and only once:
    // a plain refresh starts fresh.
    if (sessionStorage.getItem(RESTORE_FLAG) !== '1') return null;
    sessionStorage.removeItem(RESTORE_FLAG);
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 2 || !data.baseInfo) return null;
    if (Date.now() - (data.ts || 0) > 30 * 60 * 1000) return null;
    return data;
  } catch { return null; }
}

// ---------- layers ----------
function addLayer(text, xRatio, yRatio, fontSize, extra = {}) {
  const layer = {
    id: ++uidSeq,
    text,
    x: canvas.width * xRatio,
    y: canvas.height * yRatio,
    fontSize: fontSize || Math.round(canvas.width * 0.075),
    font: 'pressuru',
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: Math.round((fontSize || canvas.width * 0.075) * 0.12),
    align: 'center',
    rotation: 0,
    opacity: 1,
    ...extra,
  };
  layers.push(layer);
  selectedId = layer.id;
  syncPanel();
  render();
  return layer;
}
function deleteLayer(id) {
  layers = layers.filter((l) => l.id !== id);
  if (selectedId === id) selectedId = layers.length ? layers[layers.length - 1].id : null;
  hideInline(false);
  syncPanel(); render(); saveState();
}
function deleteSelected() { if (selectedId != null) deleteLayer(selectedId); }

function setBase(source, info) {
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  const scale = Math.min(1, 2048 / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  baseImage = source;
  if (info) baseInfo = info;
  stage.classList.add('ready');
  for (const l of layers) {
    l.x = clamp(l.x, 0, canvas.width);
    l.y = clamp(l.y, 0, canvas.height);
  }
  render();
  if (typeof boot === 'function') boot();
}
function loadImageSource(src, info) {
  const img = new Image();
  img.onload = () => setBase(img, info);
  img.src = src;
}
function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result);
    saveBaseData(dataUrl);
    loadImageSource(dataUrl, { type: 'dataUrl' });
    markActiveThumb(null);
  };
  reader.readAsDataURL(file);
}

function linesOf(layer) { return (layer.text || '').split('\n'); }
function layerBox(layer) {
  ctx.font = `700 ${layer.fontSize}px ${FONT_STACKS[layer.font] || FONT_STACKS.pressuru}`;
  const widths = linesOf(layer).map((line) => ctx.measureText(line).width);
  const w = Math.max(10, ...widths);
  const lineH = layer.fontSize * 1.16;
  const h = lineH * linesOf(layer).length;
  return { w, h, lineH };
}
function rotatedPoint(layer, lx, ly) {
  const a = rad(layer.rotation || 0);
  return { x: layer.x + lx * Math.cos(a) - ly * Math.sin(a), y: layer.y + lx * Math.sin(a) + ly * Math.cos(a) };
}

function drawLayer(layer) {
  const { w, lineH } = layerBox(layer);
  const lines = linesOf(layer);
  ctx.save();
  ctx.globalAlpha = layer.opacity == null ? 1 : layer.opacity;
  ctx.translate(layer.x, layer.y);
  ctx.rotate(rad(layer.rotation || 0));
  ctx.font = `700 ${layer.fontSize}px ${FONT_STACKS[layer.font] || FONT_STACKS.pressuru}`;
  ctx.textAlign = layer.align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const anchorX = layer.align === 'left' ? -w / 2 : layer.align === 'right' ? w / 2 : 0;
  const startY = -(lineH * (lines.length - 1)) / 2;
  lines.forEach((line, i) => {
    const y = startY + i * lineH;
    if (layer.strokeWidth > 0) {
      ctx.strokeStyle = layer.stroke;
      ctx.lineWidth = layer.strokeWidth;
      ctx.strokeText(line, anchorX, y);
    }
    ctx.fillStyle = layer.fill;
    ctx.fillText(line, anchorX, y);
  });
  ctx.restore();
}

const HANDLE_R = () => Math.max(16, canvas.width * 0.022);
const ROTATE_OFFSET = () => Math.max(34, canvas.width * 0.05);
function resizeHandlePos(layer) { const { w, h } = layerBox(layer); return rotatedPoint(layer, w / 2, h / 2); }
function rotateHandlePos(layer) { const { h } = layerBox(layer); return rotatedPoint(layer, 0, -h / 2 - ROTATE_OFFSET()); }
function deleteHandlePos(layer) { const { w, h } = layerBox(layer); return rotatedPoint(layer, -w / 2, -h / 2); }

function drawHandle(pos, bg, glyph, fg = '#fff') {
  ctx.fillStyle = bg; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, canvas.width * 0.003);
  ctx.beginPath(); ctx.arc(pos.x, pos.y, HANDLE_R(), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = fg;
  ctx.font = `700 ${HANDLE_R() * 1.15}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(glyph, pos.x, pos.y + 1);
}
function render(showSelection = true) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (baseImage) ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
  for (const layer of layers) drawLayer(layer);
  const sel = selected();
  if (showSelection && sel) {
    const { w, h } = layerBox(sel);
    ctx.save();
    ctx.translate(sel.x, sel.y); ctx.rotate(rad(sel.rotation || 0));
    ctx.strokeStyle = '#5b8cff'; ctx.lineWidth = Math.max(2, canvas.width * 0.003);
    ctx.setLineDash([10, 7]); ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.setLineDash([]);
    ctx.strokeStyle = '#5b8cff'; ctx.beginPath(); ctx.moveTo(0, -h / 2); ctx.lineTo(0, -h / 2 - ROTATE_OFFSET()); ctx.stroke();
    ctx.restore();
    drawHandle(deleteHandlePos(sel), '#ff5b6a', '×');
    drawHandle(rotateHandlePos(sel), '#5b8cff', '↻');
    drawHandle(resizeHandlePos(sel), '#ff8a3d', '⤡', '#20130a');
  }
  if (showSelection) saveState();
}

// ---------- pointer interaction ----------
const pointers = new Map();
let drag = null;
function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
}
function hitLayer(p) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    const { w, h } = layerBox(l);
    const a = rad(-(l.rotation || 0));
    const dx = p.x - l.x, dy = p.y - l.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    const pad = l.fontSize * 0.25;
    if (lx >= -w / 2 - pad && lx <= w / 2 + pad && ly >= -h / 2 - pad && ly <= h / 2 + pad) return l;
  }
  return null;
}
const near = (pos, p) => Math.hypot(p.x - pos.x, p.y - pos.y) <= HANDLE_R() * 1.6;

let lastTap = { t: 0, x: 0, y: 0, id: null };
canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  const p = toCanvas(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 2) {
    const sel = selected();
    if (sel) {
      const [a, b] = [...pointers.values()];
      drag = { mode: 'pinch', id: sel.id, d0: Math.hypot(a.x - b.x, a.y - b.y), size0: sel.fontSize, cx: sel.x, cy: sel.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
    return;
  }
  const sel = selected();
  if (sel && near(deleteHandlePos(sel), p)) { deleteSelected(); return; }
  if (sel && near(rotateHandlePos(sel), p)) {
    drag = { mode: 'rotate', id: sel.id, a0: Math.atan2(p.y - sel.y, p.x - sel.x), rot0: sel.rotation || 0 };
    return;
  }
  if (sel && near(resizeHandlePos(sel), p)) {
    drag = { mode: 'resize', id: sel.id, cx: sel.x, cy: sel.y, d0: Math.max(10, Math.hypot(p.x - sel.x, p.y - sel.y)), size0: sel.fontSize };
    return;
  }
  const hit = hitLayer(p);
  // double-tap (touch) -> inline edit
  const now = Date.now();
  if (hit && lastTap.id === hit.id && now - lastTap.t < 380 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 42) {
    lastTap = { t: 0, x: 0, y: 0, id: null };
    selectedId = hit.id; syncPanel(); render();
    startInlineEdit(hit);
    return;
  }
  lastTap = { t: now, x: p.x, y: p.y, id: hit ? hit.id : null };
  if (hit) {
    if (hit.id !== selectedId) { selectedId = hit.id; syncPanel(); }
    drag = { mode: 'move', id: hit.id, dx: hit.x - p.x, dy: hit.y - p.y };
  } else {
    selectedId = null; syncPanel();
  }
  render();
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const p = toCanvas(e);
  pointers.set(e.pointerId, p);
  if (!drag) return;
  const layer = layers.find((l) => l.id === drag.id);
  if (!layer) return;
  if (drag.mode === 'move') {
    layer.x = clamp(p.x + drag.dx, 0, canvas.width);
    layer.y = clamp(p.y + drag.dy, 0, canvas.height);
  } else if (drag.mode === 'resize') {
    const d = Math.max(10, Math.hypot(p.x - drag.cx, p.y - drag.cy));
    layer.fontSize = clamp(Math.round(drag.size0 * (d / drag.d0)), 10, 600);
    syncPanel();
  } else if (drag.mode === 'rotate') {
    const a = Math.atan2(p.y - layer.y, p.x - layer.x);
    layer.rotation = normDeg(drag.rot0 + (a - drag.a0) * 180 / Math.PI);
    syncPanel();
  } else if (drag.mode === 'pinch') {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (drag.d0 > 0) layer.fontSize = clamp(Math.round(drag.size0 * (d / drag.d0)), 10, 600);
    layer.x = drag.cx + ((a.x + b.x) / 2 - drag.mx);
    layer.y = drag.cy + ((a.y + b.y) / 2 - drag.my);
    syncPanel();
  }
  render();
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) drag = null;
  else if (drag && drag.mode === 'pinch') drag = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('dblclick', (e) => {
  const p = toCanvas(e);
  const hit = hitLayer(p);
  if (hit) { selectedId = hit.id; syncPanel(); render(); startInlineEdit(hit); }
  else {
    const l = addLayer(STR.topDefault, p.x / canvas.width, p.y / canvas.height);
    startInlineEdit(l);
  }
});

// ---------- inline editing on the image ----------
let inlineLayerId = null, inlineOriginal = '';
function startInlineEdit(layer) {
  inlineLayerId = layer.id; inlineOriginal = layer.text;
  selectedId = layer.id; syncPanel();
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
  const { w } = layerBox(layer);
  els.inline.hidden = false;
  els.inline.value = layer.text;
  els.inline.style.left = `${canvas.offsetLeft + layer.x * sx}px`;
  els.inline.style.top = `${canvas.offsetTop + layer.y * sy}px`;
  els.inline.style.width = `${Math.max(150, w * sx + 44)}px`;
  els.inline.style.fontSize = `${Math.max(15, layer.fontSize * sx)}px`;
  els.inline.style.color = layer.fill;
  els.inline.style.transform = `translate(-50%,-50%) rotate(${layer.rotation || 0}deg)`;
  els.inline.focus(); els.inline.select();
}
function hideInline(commit = true) {
  if (els.inline.hidden || inlineLayerId == null) return;
  const layer = layers.find((l) => l.id === inlineLayerId);
  if (layer) {
    layer.text = commit ? els.inline.value : inlineOriginal;
    syncPanel(); render(); saveState();
  }
  els.inline.hidden = true; inlineLayerId = null;
}
els.inline.addEventListener('blur', () => hideInline(true));
els.inline.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); hideInline(false); }
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); hideInline(true); }
  e.stopPropagation();
});
els.inline.addEventListener('pointerdown', (e) => e.stopPropagation());

// ---------- panel ----------
function buildSwatches(container, kind) {
  if (!container) return;
  container.innerHTML = '';
  for (const color of PRESET_COLORS) {
    const b = document.createElement('button');
    b.type = 'button'; b.style.background = color; b.dataset.color = color; b.title = color;
    b.setAttribute('aria-label', color);
    b.addEventListener('click', () => {
      const l = selected(); if (!l) return;
      if (kind === 'fill') l.fill = color; else l.stroke = color;
      syncPanel(); render(); saveState();
    });
    container.appendChild(b);
  }
}
buildSwatches($('fillSwatches'), 'fill');
buildSwatches($('strokeSwatches'), 'stroke');
buildSwatches($('fillSwatchesPanel'), 'fill');
buildSwatches($('strokeSwatchesPanel'), 'stroke');

function syncPanel() {
  const l = selected();
  const disabled = !l;
  for (const el of [els.text, els.font, els.size, els.rotate, els.fill, els.stroke, els.strokeW, els.opacity, els.quickFill, els.quickStroke]) if (el) el.disabled = disabled;
  $('btnDelete').disabled = disabled;
  $('btnDuplicate').disabled = disabled;
  if (els.quickBar) els.quickBar.hidden = disabled;
  if (!l) { els.text.value = ''; return; }
  els.text.value = l.text;
  els.font.value = l.font;
  els.size.value = l.fontSize; els.sizeOut.textContent = l.fontSize;
  els.rotate.value = l.rotation || 0; els.rotateOut.textContent = `${l.rotation || 0}°`;
  els.fill.value = l.fill; els.stroke.value = l.stroke;
  if (els.quickFill) els.quickFill.value = l.fill;
  if (els.quickStroke) els.quickStroke.value = l.stroke;
  els.strokeW.value = l.strokeWidth; els.strokeOut.textContent = l.strokeWidth;
  const op = Math.round((l.opacity == null ? 1 : l.opacity) * 100);
  els.opacity.value = op; els.opacityOut.textContent = `${op}%`;
  els.align.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.align === l.align));
  document.querySelectorAll('#fillSwatches button, #fillSwatchesPanel button').forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === l.fill.toLowerCase()));
  document.querySelectorAll('#strokeSwatches button, #strokeSwatchesPanel button').forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === l.stroke.toLowerCase()));
}
els.text.addEventListener('input', () => { const l = selected(); if (l) { l.text = els.text.value; render(); } });
els.font.addEventListener('change', () => { const l = selected(); if (l) { l.font = els.font.value; render(); } });
els.size.addEventListener('input', () => { const l = selected(); if (l) { l.fontSize = +els.size.value; els.sizeOut.textContent = l.fontSize; render(); } });
els.rotate.addEventListener('input', () => { const l = selected(); if (l) { l.rotation = +els.rotate.value; els.rotateOut.textContent = `${l.rotation}°`; render(); } });
els.fill.addEventListener('input', () => { const l = selected(); if (l) { l.fill = els.fill.value; syncPanel(); render(); } });
els.stroke.addEventListener('input', () => { const l = selected(); if (l) { l.stroke = els.stroke.value; syncPanel(); render(); } });
if (els.quickFill) els.quickFill.addEventListener('input', () => { const l = selected(); if (l) { l.fill = els.quickFill.value; syncPanel(); render(); } });
if (els.quickStroke) els.quickStroke.addEventListener('input', () => { const l = selected(); if (l) { l.stroke = els.quickStroke.value; syncPanel(); render(); } });
els.strokeW.addEventListener('input', () => { const l = selected(); if (l) { l.strokeWidth = +els.strokeW.value; els.strokeOut.textContent = l.strokeWidth; render(); } });
els.opacity.addEventListener('input', () => { const l = selected(); if (l) { l.opacity = +els.opacity.value / 100; els.opacityOut.textContent = `${els.opacity.value}%`; render(); } });
els.align.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  const l = selected(); if (!l) return;
  l.align = b.dataset.align; syncPanel(); render();
}));
function rotateBy(delta) { const l = selected(); if (!l) return; l.rotation = normDeg((l.rotation || 0) + delta); syncPanel(); render(); saveState(); }
$('btnRotateLeft').addEventListener('click', () => rotateBy(-15));
$('btnRotateRight').addEventListener('click', () => rotateBy(15));
$('btnRotateLeft2').addEventListener('click', () => rotateBy(-15));
$('btnRotateRight2').addEventListener('click', () => rotateBy(15));
$('btnRotateReset').addEventListener('click', () => { const l = selected(); if (l) { l.rotation = 0; syncPanel(); render(); saveState(); } });
$('btnQuickDelete').addEventListener('click', deleteSelected);
$('btnQuickEdit').addEventListener('click', () => { const l = selected(); if (l) startInlineEdit(l); });
$('btnAddText').addEventListener('click', () => {
  const l = addLayer(STR.topDefault, 0.5, 0.5);
  els.text.focus(); els.text.select();
  return l;
});
$('btnDelete').addEventListener('click', deleteSelected);
$('btnDuplicate').addEventListener('click', () => {
  const l = selected(); if (!l) return;
  const copy = addLayer(l.text, clamp((l.x + 24) / canvas.width, 0, 1), clamp((l.y + 24) / canvas.height, 0, 1), l.fontSize,
    { font: l.font, fill: l.fill, stroke: l.stroke, strokeWidth: l.strokeWidth, align: l.align, rotation: l.rotation || 0, opacity: l.opacity == null ? 1 : l.opacity });
  return copy;
});
window.addEventListener('keydown', (e) => {
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId != null) { e.preventDefault(); deleteSelected(); }
});

// ---------- image sources ----------
function markActiveThumb(name) {
  els.tplStrip.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.name === name));
}
for (const name of TEMPLATES) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.dataset.name = name; btn.setAttribute('role', 'option');
  const imgEl = document.createElement('img');
  imgEl.src = `../assets/templates/${name}`;
  imgEl.alt = name.replace(/\.[^.]+$/, '').replace(/-/g, ' ');
  imgEl.loading = 'lazy';
  btn.appendChild(imgEl);
  btn.addEventListener('click', () => {
    saveBaseData(null);
    loadImageSource(`../assets/templates/${name}`, { type: 'template', name });
    markActiveThumb(name);
  });
  els.tplStrip.appendChild(btn);
}
els.file.addEventListener('change', () => {
  const f = els.file.files && els.file.files[0];
  if (f) loadFile(f);
});
$('btnBlank').addEventListener('click', () => {
  const [w, h] = $('blankSize').value.split('x').map(Number);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  saveBaseData(null);
  setBase(c, { type: 'blank', w, h });
  markActiveThumb(null);
});
window.addEventListener('paste', (e) => {
  const item = [...((e.clipboardData || {}).items || [])].find((i) => i.type.startsWith('image/'));
  if (item) loadFile(item.getAsFile());
});
stage.addEventListener('dragover', (e) => e.preventDefault());
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});

// ---------- export & share ----------
function download(type) {
  hideInline(true);
  render(false);
  const mime = type === 'png' ? 'image/png' : 'image/jpeg';
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `meme.${type === 'png' ? 'png' : 'jpg'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    render(true);
  }, mime, 0.92);
}
$('btnPng').addEventListener('click', () => download('png'));
$('btnJpg').addEventListener('click', () => download('jpg'));
$('btnShare').addEventListener('click', async () => {
  hideInline(true);
  render(false);
  const showNote = (msg) => { if (els.shareNote) { els.shareNote.textContent = msg; setTimeout(() => { els.shareNote.textContent = ''; }, 3200); } };
  try {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    render(true);
    if (blob && navigator.canShare) {
      const file = new File([blob], 'meme.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: document.title, text: document.querySelector('meta[name="description"]')?.content || document.title, url: location.href });
        return;
      }
    }
    if (navigator.share) {
      await navigator.share({ title: document.title, text: document.querySelector('meta[name="description"]')?.content || document.title, url: location.href });
      return;
    }
    throw new Error('no-web-share');
  } catch (err) {
    render(true);
    if (err && err.name === 'AbortError') return;
    try { await navigator.clipboard.writeText(location.href); showNote(STR.copied || 'Link copied'); }
    catch { showNote(location.href); }
  }
});

// ---------- language switcher: preserve current edit ----------
$('langSelect').addEventListener('change', (e) => {
  hideInline(true);
  try { sessionStorage.setItem(RESTORE_FLAG, '1'); } catch {}
  saveState(true);
  const slug = e.target.value;
  window.location.href = `../${slug}/`;
});

// ---------- boot / restore ----------
let booted = false;
let pendingRestore = readSavedState();
function applyRestore(data) {
  restoring = true;
  layers = (data.layers || []).map((s, idx) => ({
    id: idx + 1,
    text: s.text || '',
    x: canvas.width * (s.x ?? 0.5),
    y: canvas.height * (s.y ?? 0.5),
    fontSize: Math.round(canvas.width * (s.fontSize ?? 0.07)),
    font: s.font || 'pressuru',
    fill: s.fill || '#ffffff',
    stroke: s.stroke || '#000000',
    strokeWidth: Math.round(canvas.width * (s.strokeWidth ?? 0.01)),
    align: s.align || 'center',
    rotation: s.rotation || 0,
    opacity: s.opacity == null ? 1 : s.opacity,
  }));
  uidSeq = layers.length;
  const selIdx = (data.layers || []).findIndex((s) => s.id === data.selectedId);
  selectedId = layers.length ? layers[selIdx >= 0 ? selIdx : layers.length - 1].id : null;
  restoring = false;
  syncPanel(); render();
}
function boot() {
  if (booted || !baseImage || !layersReady) return;
  booted = true;
  if (pendingRestore) {
    const data = pendingRestore; pendingRestore = null;
    applyRestore(data);
    return;
  }
  if (!layers.length) {
    addLayer(STR.topDefault, 0.5, 0.1);
    addLayer(STR.bottomDefault, 0.5, 0.9);
    selectedId = layers[layers.length - 1].id;
    syncPanel();
  }
  render();
}
let layersReady = false;
const waitFonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
waitFonts.then(() => { layersReady = true; boot(); });

if (pendingRestore) {
  const info = pendingRestore.baseInfo;
  if (info.type === 'template' && info.name) {
    loadImageSource(`../assets/templates/${info.name}`, info);
    markActiveThumb(info.name);
  } else if (info.type === 'dataUrl') {
    let dataUrl = null;
    try { dataUrl = sessionStorage.getItem(BASE_DATA_KEY); } catch {}
    if (dataUrl) loadImageSource(dataUrl, info);
    else { loadImageSource('../assets/templates/this-is-fine.jpg', { type: 'template', name: 'this-is-fine.jpg' }); markActiveThumb('this-is-fine.jpg'); }
  } else if (info.type === 'blank' && info.w && info.h) {
    const c = document.createElement('canvas');
    c.width = info.w; c.height = info.h;
    const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    setBase(c, info);
  } else {
    loadImageSource('../assets/templates/this-is-fine.jpg', { type: 'template', name: 'this-is-fine.jpg' });
    markActiveThumb('this-is-fine.jpg');
  }
} else {
  loadImageSource('../assets/templates/this-is-fine.jpg');
  markActiveThumb('this-is-fine.jpg');
}

// test/debug handle (also handy for automation)
window.__memeEditor = {
  get layers() { return layers; },
  get selectedId() { return selectedId; },
  get canvas() { return canvas; },
  addLayer, deleteSelected, startInlineEdit, saveState,
  setRotation(deg) { const l = selected(); if (l) { l.rotation = normDeg(deg); syncPanel(); render(); } },
};
