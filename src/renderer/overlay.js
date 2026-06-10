'use strict';

const api = window.numdeck;

const LAYOUT = [
  { id: '_lock', deco: true, text: 'NUM' },
  { id: 'numdiv', glyph: '/' },
  { id: 'nummult', glyph: '*' },
  { id: '_sub', deco: true, text: '⇆' },
  { id: 'num7', glyph: '7' },
  { id: 'num8', glyph: '8' },
  { id: 'num9', glyph: '9' },
  { id: '_add', power: true, rowspan: 2 },
  { id: 'num4', glyph: '4' },
  { id: 'num5', glyph: '5' },
  { id: 'num6', glyph: '6' },
  { id: 'num1', glyph: '1' },
  { id: 'num2', glyph: '2' },
  { id: 'num3', glyph: '3' },
  { id: '_enter', deco: true, text: '⏎', rowspan: 2 },
  { id: 'num0', glyph: '0', colspan: 2 },
  { id: 'numdec', glyph: '.' },
];

let cfg = null;
let lastTicker = null;
let locked = false;
let scale = 1;
let hoverInteractive = false;

const BASE_W = 196;

function applyLockUI() {
  document.body.classList.toggle('locked', locked);
  document.getElementById('lock-open').style.display = locked ? 'none' : '';
  document.getElementById('lock-closed').style.display = locked ? '' : 'none';
  document.getElementById('btn-lock').title = locked
    ? 'Déverrouiller l\'overlay'
    : 'Verrouiller (les clics traverseront — re-cliquez le cadenas pour déverrouiller)';
}

function applyScaleUI() {
  document.body.style.zoom = scale;
}

function activePreset() {
  return cfg.presets.find((p) => p.id === cfg.activePresetId) || cfg.presets[0];
}

function displayText(type) {
  const t = lastTicker;
  if (!t) return '…';
  switch (type) {
    case 'clock': return t.time;
    case 'date': return t.date;
    case 'cpu': return 'CPU\n' + t.cpu + '%';
    case 'ram': return 'RAM\n' + t.ram + '%';
    case 'obs': return t.obs.recording ? '● REC' : t.obs.streaming ? 'LIVE' : 'OBS —';
    default: return '';
  }
}

function render() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  const preset = activePreset();
  document.getElementById('preset-name').textContent = preset.name;

  for (const cell of LAYOUT) {
    const el = document.createElement('div');
    el.className = 'mk';
    el.dataset.key = cell.id;
    if (cell.colspan) el.style.gridColumn = `span ${cell.colspan}`;
    if (cell.rowspan) el.style.gridRow = `span ${cell.rowspan}`;

    if (cell.deco) {
      el.classList.add('deco');
      el.innerHTML = `<div class="dsp">${cell.text}</div>`;
    } else if (cell.power) {
      el.classList.add('power');
      el.innerHTML = '<div class="dsp">⏻</div>';
    } else {
      const button = preset.buttons[cell.id];
      if (button && (button.action || button.actionDouble || button.actionLong || button.icon || button.display)) {
        el.classList.add('bound');
        el.style.setProperty('--c', button.color || '#22d3ee');
      }
      if (button && button.icon) {
        const img = document.createElement('img');
        img.src = api.toFileURL(button.icon);
        img.draggable = false;
        el.appendChild(img);
      }
      const glyph = document.createElement('div');
      glyph.className = 'g';
      glyph.textContent = cell.glyph;
      el.appendChild(glyph);
      if (button && button.display && button.display.type) {
        const dsp = document.createElement('div');
        dsp.className = 'dsp';
        dsp.dataset.display = button.display.type;
        dsp.textContent = displayText(button.display.type);
        el.appendChild(dsp);
      }
    }
    grid.appendChild(el);
  }
}

function refreshDisplays() {
  for (const el of document.querySelectorAll('.dsp[data-display]')) {
    el.textContent = displayText(el.dataset.display);
  }
}

async function boot() {
  const state = await api.getState();
  cfg = state.config;
  lastTicker = state.ticker;
  locked = !!cfg.settings.overlay.locked;
  scale = typeof cfg.settings.overlay.scale === 'number' ? cfg.settings.overlay.scale : 1;
  document.body.classList.toggle('deck-on', state.deckActive);
  applyLockUI();
  applyScaleUI();
  render();

  document.getElementById('btn-lock').addEventListener('click', () => {
    api.overlaySet({ locked: !locked });
  });
  document.getElementById('btn-hide').addEventListener('click', () => api.overlaySet({ enabled: false }));

  // Verrouillé : la fenêtre laisse passer les clics, mais on détecte le survol
  // du cadenas pour le rendre cliquable le temps du survol
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    const over = !!(e.target && e.target.closest && e.target.closest('#btn-lock'));
    if (over !== hoverInteractive) {
      hoverInteractive = over;
      api.overlayInteractive(over);
    }
  });
  document.addEventListener('mouseleave', () => {
    if (locked && hoverInteractive) {
      hoverInteractive = false;
      api.overlayInteractive(false);
    }
  });

  // Poignées de redimensionnement : 4 coins, le coin opposé reste fixe.
  // Tirer vers l'extérieur agrandit, vers l'intérieur réduit.
  const DELTA_FOR_CORNER = {
    se: (dx, dy) => Math.abs(dx) > Math.abs(dy) ? dx : dy,
    sw: (dx, dy) => Math.abs(dx) > Math.abs(dy) ? -dx : dy,
    ne: (dx, dy) => Math.abs(dx) > Math.abs(dy) ? dx : -dy,
    nw: (dx, dy) => Math.abs(dx) > Math.abs(dy) ? -dx : -dy,
  };

  let resizing = null;
  let lastSent = 0;
  for (const grip of document.querySelectorAll('.grip')) {
    const corner = grip.dataset.corner;
    grip.addEventListener('pointerdown', (e) => {
      if (locked) return;
      grip.setPointerCapture(e.pointerId);
      resizing = { startX: e.screenX, startY: e.screenY, startScale: scale, corner };
      e.preventDefault();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      const dx = e.screenX - resizing.startX;
      const dy = e.screenY - resizing.startY;
      const delta = DELTA_FOR_CORNER[resizing.corner](dx, dy) / BASE_W;
      scale = Math.min(1.8, Math.max(0.7, resizing.startScale + delta));
      applyScaleUI();
      const now = Date.now();
      if (now - lastSent > 33) {
        lastSent = now;
        api.overlayScale(scale, false, resizing.corner);
      }
    });
    const endResize = () => {
      if (!resizing) return;
      const c = resizing.corner;
      resizing = null;
      api.overlayScale(scale, true, c);
    };
    grip.addEventListener('pointerup', endResize);
    grip.addEventListener('pointercancel', endResize);
  }

  api.on('deck:changed', ({ active }) => document.body.classList.toggle('deck-on', active));
  api.on('preset:changed', ({ presetId }) => {
    cfg.activePresetId = presetId;
    render();
  });
  api.on('config:changed', (next) => {
    cfg = next;
    locked = !!cfg.settings.overlay.locked;
    applyLockUI();
    render();
  });
  api.on('overlay:state', (s) => {
    locked = !!s.locked;
    if (typeof s.scale === 'number') {
      scale = s.scale;
      applyScaleUI();
    }
    if (!locked && hoverInteractive) hoverInteractive = false;
    applyLockUI();
  });
  api.on('ticker:data', (t) => {
    lastTicker = t;
    refreshDisplays();
  });
  api.on('key:pressed', ({ key }) => {
    const el = document.querySelector(`.mk[data-key="${key}"]`);
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  });
}

boot();
