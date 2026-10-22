// Meme editor: layered text on a canvas.
// - Drag a text layer to move it (mouse or touch, Pointer Events)
// - Drag the orange corner handle to resize; two-finger pinch also resizes
// - Everything is local: images never leave the device.

const STR = window.__STR__ || { topDefault: 'TOP TEXT', bottomDefault: 'BOTTOM TEXT' };
const TEMPLATES = window.__TEMPLATES__ || [];

const FONT_STACKS = {
  pressuru: `'Pressuru', 'Noto Sans SC', 'PingFang SC', sans-serif`,
  oswald: `'Oswald', 'Noto Sans SC', 'PingFang SC', sans-serif`,
  impact: `Impact, 'Arial Black', 'Noto Sans SC', 'PingFang SC', sans-serif`,
  sans: `system-ui, 'Segoe UI', 'Noto Sans SC', sans-serif`,
  serif: `Georgia, 'Times New Roman', 'Noto Serif SC', serif`,
  mono: `'Courier New', 'Noto Sans Mono', monospace`,
};

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');

let baseImage = null; // HTMLImageElement | HTMLCanvasElement
let layers = [];
let selectedId = null;
let uidSeq = 0;

const $ = (id) => document.getElementById(id);
const els = {
  file: $('fileInput'), tplStrip: $('tplStrip'),
  text: $('textInput'), font: $('fontSelect'),
  size: $('sizeRange'), sizeOut: $('sizeOut'),
  fill: $('fillColor'), stroke: $('strokeColor'),
  strokeW: $('strokeRange'), strokeOut: $('strokeOut'),
  align: $('alignGroup'),
};

function selected() { return layers.find((l) => l.id === selectedId) || null; }

function addLayer(text, xRatio, yRatio, fontSize) {
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
  };
  layers.push(layer);
  selectedId = layer.id;
  syncPanel();
  render();
  return layer;
}

function setBase(source) {
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  const scale = Math.min(1, 2048 / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  baseImage = source;
  stage.classList.add('ready');
  // Reposition existing layers proportionally is complex; keep layers but clamp.
  for (const l of layers) {
    l.x = Math.min(Math.max(l.x, 0), canvas.width);
    l.y = Math.min(Math.max(l.y, 0), canvas.height);
  }
  render();
  if (typeof boot === 'function') boot();
}

function loadImageSource(src) {
  const img = new Image();
  img.onload = () => setBase(img);
  img.src = src;
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

function drawLayer(layer) {
  const { lineH } = layerBox(layer);
  const lines = linesOf(layer);
  ctx.font = `700 ${layer.fontSize}px ${FONT_STACKS[layer.font] || FONT_STACKS.pressuru}`;
  ctx.textAlign = layer.align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const anchorX = layer.align === 'left' ? layer.x - layerBox(layer).w / 2
    : layer.align === 'right' ? layer.x + layerBox(layer).w / 2 : layer.x;
  const startY = layer.y - (lineH * (lines.length - 1)) / 2;
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
}

const HANDLE_R = () => Math.max(16, canvas.width * 0.022);

function handlePos(layer) {
  const { w, h } = layerBox(layer);
  return { x: layer.x + w / 2, y: layer.y + h / 2 };
}

function render(showSelection = true) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (baseImage) ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
  for (const layer of layers) drawLayer(layer);
  const sel = selected();
  if (showSelection && sel) {
    const { w, h } = layerBox(sel);
    const x0 = sel.x - w / 2, y0 = sel.y - h / 2;
    ctx.save();
    ctx.strokeStyle = '#5b8cff';
    ctx.lineWidth = Math.max(2, canvas.width * 0.003);
    ctx.setLineDash([10, 7]);
    ctx.strokeRect(x0, y0, w, h);
    ctx.setLineDash([]);
    const hp = handlePos(sel);
    ctx.fillStyle = '#ff8a3d';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, canvas.width * 0.003);
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, HANDLE_R(), 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#20130a';
    ctx.font = `700 ${HANDLE_R() * 1.1}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('⤡', hp.x, hp.y + 1);
    ctx.restore();
  }
}

// ---------- pointer interaction ----------
const pointers = new Map();
let drag = null; // {mode:'move'|'resize'|'pinch', ...}

function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (canvas.width / r.width),
    y: (e.clientY - r.top) * (canvas.height / r.height),
  };
}

function hitLayer(p) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    const { w, h } = layerBox(l);
    const pad = l.fontSize * 0.25;
    if (p.x >= l.x - w / 2 - pad && p.x <= l.x + w / 2 + pad &&
        p.y >= l.y - h / 2 - pad && p.y <= l.y + h / 2 + pad) return l;
  }
  return null;
}

function onHandle(layer, p) {
  const hp = handlePos(layer);
  const rr = HANDLE_R() * 1.5;
  return Math.hypot(p.x - hp.x, p.y - hp.y) <= rr;
}

canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or inactive pointer */ }
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
  if (sel && onHandle(sel, p)) {
    drag = { mode: 'resize', id: sel.id, cx: sel.x, cy: sel.y, d0: Math.max(10, Math.hypot(p.x - sel.x, p.y - sel.y)), size0: sel.fontSize };
    return;
  }
  const hit = hitLayer(p);
  if (hit) {
    if (hit.id !== selectedId) { selectedId = hit.id; syncPanel(); }
    drag = { mode: 'move', id: hit.id, dx: hit.x - p.x, dy: hit.y - p.y };
  } else {
    selectedId = null;
    syncPanel();
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
    layer.x = Math.min(Math.max(p.x + drag.dx, 0), canvas.width);
    layer.y = Math.min(Math.max(p.y + drag.dy, 0), canvas.height);
  } else if (drag.mode === 'resize') {
    const d = Math.max(10, Math.hypot(p.x - drag.cx, p.y - drag.cy));
    layer.fontSize = clamp(Math.round(drag.size0 * (d / drag.d0)), 10, 600);
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

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ---------- panel ----------
function syncPanel() {
  const l = selected();
  const disabled = !l;
  for (const el of [els.text, els.font, els.size, els.fill, els.stroke, els.strokeW]) el.disabled = disabled;
  $('btnDelete').disabled = disabled;
  if (!l) { els.text.value = ''; return; }
  els.text.value = l.text;
  els.font.value = l.font;
  els.size.value = l.fontSize; els.sizeOut.textContent = l.fontSize;
  els.fill.value = l.fill;
  els.stroke.value = l.stroke;
  els.strokeW.value = l.strokeWidth; els.strokeOut.textContent = l.strokeWidth;
  els.align.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.align === l.align));
}

els.text.addEventListener('input', () => { const l = selected(); if (l) { l.text = els.text.value; render(); } });
els.font.addEventListener('change', () => { const l = selected(); if (l) { l.font = els.font.value; render(); } });
els.size.addEventListener('input', () => { const l = selected(); if (l) { l.fontSize = +els.size.value; els.sizeOut.textContent = l.fontSize; render(); } });
els.fill.addEventListener('input', () => { const l = selected(); if (l) { l.fill = els.fill.value; render(); } });
els.stroke.addEventListener('input', () => { const l = selected(); if (l) { l.stroke = els.stroke.value; render(); } });
els.strokeW.addEventListener('input', () => { const l = selected(); if (l) { l.strokeWidth = +els.strokeW.value; els.strokeOut.textContent = l.strokeWidth; render(); } });
els.align.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  const l = selected(); if (!l) return;
  l.align = b.dataset.align; syncPanel(); render();
}));
$('btnAddText').addEventListener('click', () => {
  const l = addLayer(STR.topDefault, 0.5, 0.5);
  els.text.focus(); els.text.select();
  return l;
});
$('btnDelete').addEventListener('click', () => {
  if (!selectedId) return;
  layers = layers.filter((l) => l.id !== selectedId);
  selectedId = layers.length ? layers[layers.length - 1].id : null;
  syncPanel(); render();
});

// ---------- image sources ----------
function markActiveThumb(name) {
  els.tplStrip.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.name === name));
}
for (const name of TEMPLATES) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.name = name;
  btn.setAttribute('role', 'option');
  const imgEl = document.createElement('img');
  imgEl.src = `../assets/templates/${name}`;
  imgEl.alt = name.replace(/\.[^.]+$/, '').replace(/-/g, ' ');
  imgEl.loading = 'lazy';
  btn.appendChild(imgEl);
  btn.addEventListener('click', () => { loadImageSource(`../assets/templates/${name}`); markActiveThumb(name); });
  els.tplStrip.appendChild(btn);
}

els.file.addEventListener('change', () => {
  const f = els.file.files && els.file.files[0];
  if (!f) return;
  loadImageSource(URL.createObjectURL(f));
  markActiveThumb(null);
});

$('btnBlank').addEventListener('click', () => {
  const [w, h] = $('blankSize').value.split('x').map(Number);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  setBase(c);
  markActiveThumb(null);
});

window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData || {}).items || []].find((i) => i.type.startsWith('image/'));
  if (item) loadImageSource(URL.createObjectURL(item.getAsFile()));
});
stage.addEventListener('dragover', (e) => e.preventDefault());
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) loadImageSource(URL.createObjectURL(f));
});

// ---------- export ----------
function download(type) {
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

// ---------- language switcher ----------
$('langSelect').addEventListener('change', (e) => {
  const slug = e.target.value;
  window.location.href = `../${slug}/`;
});

// ---------- boot ----------
let booted = false;
function boot() {
  if (booted || !baseImage || !layersReady) return;
  booted = true;
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
loadImageSource('../assets/templates/this-is-fine.jpg');
markActiveThumb('this-is-fine.jpg');
