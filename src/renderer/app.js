'use strict';

const api = window.numdeck;

// ---------------------------------------------------------------------------
// Disposition physique du pavé numérique (grille 4 × 5)
// ---------------------------------------------------------------------------

const LAYOUT = [
  { id: '_lock', deco: true, text: 'NUM' },
  { id: 'numdiv', glyph: '/' },
  { id: 'nummult', glyph: '*' },
  { id: '_sub', special: 'preset' },
  { id: 'num7', glyph: '7' },
  { id: 'num8', glyph: '8' },
  { id: 'num9', glyph: '9' },
  { id: '_add', special: 'power', rowspan: 2 },
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

const KEY_NAMES = {
  num0: '0', num1: '1', num2: '2', num3: '3', num4: '4',
  num5: '5', num6: '6', num7: '7', num8: '8', num9: '9',
  numdec: '.', numdiv: '/', nummult: '*',
};

const SWATCHES = ['#22d3ee', '#7c5cff', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#e8eaf2'];

const DEFAULT_COLOR = '#22d3ee';

// ---------------------------------------------------------------------------
// Catalogue des actions
// ---------------------------------------------------------------------------

const ACTION_GROUPS = [
  {
    label: 'Système',
    items: [
      { type: 'app.open', label: 'Ouvrir une application' },
      { type: 'url.open', label: 'Ouvrir un site web' },
      { type: 'file.open', label: 'Ouvrir un fichier / dossier' },
      { type: 'cmd.run', label: 'Exécuter une commande' },
      { type: 'keys.send', label: 'Envoyer un raccourci clavier' },
      { type: 'text.type', label: 'Taper un texte' },
      { type: 'media', label: 'Contrôle média (lecture, volume…)' },
      { type: 'sound.play', label: 'Jouer un son' },
    ],
  },
  {
    label: 'OBS Studio',
    items: [
      { type: 'obs.scene', label: 'OBS — Changer de scène' },
      { type: 'obs.transition', label: 'OBS — Transition studio' },
      { type: 'obs.stream.toggle', label: 'OBS — Démarrer / arrêter le stream' },
      { type: 'obs.record.toggle', label: 'OBS — Démarrer / arrêter l\'enregistrement' },
      { type: 'obs.mute', label: 'OBS — Muet sur une source audio' },
    ],
  },
  {
    label: 'NumDeck',
    items: [
      { type: 'preset.switch', label: 'Changer de preset' },
      { type: 'deck.toggle', label: 'Désactiver le mode deck' },
    ],
  },
];

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

let state = null;       // { config, deckActive, obsStatus, hookAvailable, ticker, version }
let selectedKey = null; // id de la touche en cours d'édition
let currentSlot = 'action'; // slot de geste édité : action | actionDouble | actionLong
let saveTimer = null;
let activeSounds = [];

const SLOT_NAMES = { action: 'action', actionDouble: 'actionDouble', actionLong: 'actionLong' };

function isButtonBound(button) {
  return !!(button && (button.action || button.actionDouble || button.actionLong || button.icon || button.label || (button.display && button.display.type)));
}

function displayText(type) {
  const t = state && state.ticker;
  if (!t) return '…';
  switch (type) {
    case 'clock': return t.time;
    case 'date': return t.date;
    case 'cpu': return 'CPU ' + t.cpu + '%';
    case 'ram': return 'RAM ' + t.ram + '%';
    case 'obs': return t.obs.recording ? '● REC' : t.obs.streaming ? 'LIVE' : 'OBS —';
    default: return '';
  }
}

const $ = (sel) => document.querySelector(sel);

function cfg() { return state.config; }

function activePreset() {
  return cfg().presets.find((p) => p.id === cfg().activePresetId) || cfg().presets[0];
}

function getButton(key) {
  return activePreset().buttons[key] || null;
}

function ensureButton(key) {
  const preset = activePreset();
  if (!preset.buttons[key]) {
    preset.buttons[key] = { label: '', icon: null, color: DEFAULT_COLOR, action: null };
  }
  return preset.buttons[key];
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.saveConfig(cfg()), 250);
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer = null;
function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast ' + kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

// ---------------------------------------------------------------------------
// Rendu du deck
// ---------------------------------------------------------------------------

function renderDeck() {
  const grid = $('#deck-grid');
  grid.innerHTML = '';

  for (const cell of LAYOUT) {
    const el = document.createElement('div');
    el.className = 'key';
    el.dataset.key = cell.id;
    if (cell.colspan) el.style.gridColumn = `span ${cell.colspan}`;
    if (cell.rowspan) el.style.gridRow = `span ${cell.rowspan}`;

    const face = document.createElement('div');
    face.className = 'key-face';
    el.appendChild(face);

    if (cell.deco) {
      el.classList.add('deco');
      const center = document.createElement('div');
      center.className = 'key-center';
      center.textContent = cell.text;
      el.appendChild(center);
    } else if (cell.special === 'power') {
      el.classList.add('special', 'power');
      if (state.deckActive) el.classList.add('on');
      el.title = 'Activer / désactiver le mode deck (touche +)';
      el.innerHTML += `
        <div class="key-center">
          <svg viewBox="0 0 24 24"><path d="M12 3v8" stroke-linecap="round" stroke-width="2"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0" stroke-linecap="round" stroke-width="2"/></svg>
          <span class="sp-label">${state.deckActive ? 'ON' : 'OFF'}</span>
        </div>`;
      el.addEventListener('click', () => api.toggleDeck());
    } else if (cell.special === 'preset') {
      el.classList.add('special');
      el.title = 'Preset suivant (touche −)';
      el.innerHTML += `
        <div class="key-center">
          <svg viewBox="0 0 24 24"><path d="M4 7h13M4 12h13M4 17h13" stroke-linecap="round" stroke-width="2"/><path d="M19.5 10l2.5 2-2.5 2" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
          <span class="sp-label">PRESET</span>
        </div>`;
      el.addEventListener('click', async () => {
        const presets = cfg().presets;
        const idx = presets.findIndex((p) => p.id === cfg().activePresetId);
        const next = presets[(idx + 1) % presets.length];
        await api.activatePreset(next.id);
      });
    } else {
      renderBindableKey(el, cell);
    }

    grid.appendChild(el);
  }
}

function renderBindableKey(el, cell) {
  const button = getButton(cell.id);
  const bound = isButtonBound(button);
  if (bound) {
    el.classList.add('bound');
    el.style.setProperty('--accent-key', button.color || DEFAULT_COLOR);
  }
  if (cell.id === selectedKey) el.classList.add('selected');

  if (button && button.icon) {
    const img = document.createElement('img');
    img.className = 'key-icon';
    img.src = api.toFileURL(button.icon);
    img.draggable = false;
    el.appendChild(img);
  }

  const glyph = document.createElement('div');
  glyph.className = 'key-glyph';
  glyph.textContent = cell.glyph;
  el.appendChild(glyph);

  // Badges des gestes secondaires (double / long)
  if (button && (button.actionDouble || button.actionLong)) {
    const badges = document.createElement('div');
    badges.className = 'key-badges';
    if (button.actionDouble) {
      const b = document.createElement('span');
      b.className = 'badge badge-double';
      b.title = 'Double appui configuré';
      badges.appendChild(b);
    }
    if (button.actionLong) {
      const b = document.createElement('span');
      b.className = 'badge badge-long';
      b.title = 'Appui long configuré';
      badges.appendChild(b);
    }
    el.appendChild(badges);
  }

  // Affichage en direct (horloge, CPU…)
  if (button && button.display && button.display.type) {
    const dsp = document.createElement('div');
    dsp.className = 'key-display';
    dsp.dataset.display = button.display.type;
    dsp.textContent = displayText(button.display.type);
    el.appendChild(dsp);
  }

  if (button && button.label) {
    const label = document.createElement('div');
    label.className = 'key-label';
    label.textContent = button.label;
    el.appendChild(label);
  }

  if (!bound) {
    const empty = document.createElement('div');
    empty.className = 'key-empty';
    empty.textContent = '+';
    el.appendChild(empty);
  }

  el.addEventListener('click', () => selectKey(cell.id));

  // Glisser-déposer d'une image / GIF directement sur la touche
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('drop-target');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)) {
      toast('Format non supporté — utilisez une image (PNG, JPG, GIF, WebP…)', 'error');
      return;
    }
    const srcPath = api.pathForFile(file);
    const stored = await api.importIcon(srcPath);
    if (!stored) { toast('Impossible d\'importer cette image', 'error'); return; }
    ensureButton(cell.id).icon = stored;
    scheduleSave();
    selectKey(cell.id);
    renderDeck();
  });
}

function flashKey(keyId) {
  const el = document.querySelector(`.key[data-key="${keyId}"]`);
  if (!el) return;
  el.classList.remove('pressed');
  void el.offsetWidth; // force le redémarrage de l'animation
  el.classList.add('pressed');
  setTimeout(() => el.classList.remove('pressed'), 320);
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

function renderPresets() {
  const wrap = $('#preset-tabs');
  wrap.innerHTML = '';
  for (const preset of cfg().presets) {
    const tab = document.createElement('button');
    tab.className = 'preset-tab' + (preset.id === cfg().activePresetId ? ' active' : '');
    tab.textContent = preset.name;
    tab.title = 'Clic : activer · double-clic : renommer · clic droit : options';
    tab.addEventListener('click', () => api.activatePreset(preset.id));
    tab.addEventListener('dblclick', () => renamePresetInline(tab, preset));
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Renommer', fn: () => renamePresetInline(tab, preset) },
        { label: 'Dupliquer', fn: () => duplicatePreset(preset) },
        { label: 'Supprimer', danger: true, fn: () => deletePreset(preset) },
      ]);
    });
    wrap.appendChild(tab);
  }
}

function renamePresetInline(tab, preset) {
  const input = document.createElement('input');
  input.value = preset.name;
  input.maxLength = 22;
  tab.textContent = '';
  tab.appendChild(input);
  input.focus();
  input.select();
  const commit = () => {
    preset.name = input.value.trim() || preset.name;
    scheduleSave();
    renderPresets();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = preset.name; input.blur(); }
  });
}

function addPreset() {
  const id = 'preset-' + Date.now();
  const buttons = {};
  for (const k of Object.keys(KEY_NAMES)) buttons[k] = null;
  cfg().presets.push({ id, name: `Preset ${cfg().presets.length + 1}`, buttons });
  scheduleSave();
  api.activatePreset(id);
}

function duplicatePreset(preset) {
  const copy = JSON.parse(JSON.stringify(preset));
  copy.id = 'preset-' + Date.now();
  copy.name = preset.name + ' (copie)';
  cfg().presets.push(copy);
  scheduleSave();
  renderPresets();
}

function deletePreset(preset) {
  if (cfg().presets.length <= 1) {
    toast('Impossible de supprimer le dernier preset', 'error');
    return;
  }
  cfg().presets = cfg().presets.filter((p) => p.id !== preset.id);
  if (cfg().activePresetId === preset.id) {
    cfg().activePresetId = cfg().presets[0].id;
  }
  scheduleSave();
  renderPresets();
  renderDeck();
  renderEditor();
}

// ---------------------------------------------------------------------------
// Menu contextuel
// ---------------------------------------------------------------------------

function showContextMenu(x, y, items) {
  const menu = $('#ctx-menu');
  menu.innerHTML = '';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = 'ctx-item' + (item.danger ? ' danger' : '');
    btn.textContent = item.label;
    btn.addEventListener('click', () => { hideContextMenu(); item.fn(); });
    menu.appendChild(btn);
  }
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
}

function hideContextMenu() { $('#ctx-menu').hidden = true; }

document.addEventListener('click', (e) => {
  if (!e.target.closest('.ctx-menu')) hideContextMenu();
});

// ---------------------------------------------------------------------------
// Éditeur de touche
// ---------------------------------------------------------------------------

function selectKey(keyId) {
  if (selectedKey !== keyId) currentSlot = 'action';
  selectedKey = keyId;
  renderDeck();
  renderEditor();
}

function renderEditor() {
  const empty = $('#editor-empty');
  const body = $('#editor-body');
  if (!selectedKey) {
    empty.hidden = false;
    body.hidden = true;
    return;
  }
  empty.hidden = true;
  body.hidden = false;

  const button = getButton(selectedKey) || { label: '', icon: null, color: DEFAULT_COLOR, action: null };
  $('#ed-keyname').textContent = KEY_NAMES[selectedKey];
  $('#ed-label').value = button.label || '';

  // Aperçu de l'image
  const preview = $('#ed-img-preview');
  preview.innerHTML = '';
  if (button.icon) {
    const img = document.createElement('img');
    img.src = api.toFileURL(button.icon);
    preview.appendChild(img);
  } else {
    preview.innerHTML = '<span>—</span>';
  }

  // Nuancier
  const swatches = $('#ed-swatches');
  swatches.innerHTML = '';
  for (const color of SWATCHES) {
    const sw = document.createElement('button');
    sw.className = 'swatch' + ((button.color || DEFAULT_COLOR) === color ? ' active' : '');
    sw.style.background = color;
    sw.title = color;
    sw.addEventListener('click', () => {
      ensureButton(selectedKey).color = color;
      scheduleSave();
      renderDeck();
      renderEditor();
    });
    swatches.appendChild(sw);
  }
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'swatch-custom';
  custom.value = button.color || DEFAULT_COLOR;
  custom.title = 'Couleur personnalisée';
  custom.addEventListener('input', () => {
    ensureButton(selectedKey).color = custom.value;
    scheduleSave();
    renderDeck();
  });
  swatches.appendChild(custom);

  // Affichage en direct
  $('#ed-display').value = (button.display && button.display.type) || '';

  // Onglets de geste (appui / double / long)
  for (const tab of document.querySelectorAll('.slot-tab')) {
    const slot = tab.dataset.slot;
    tab.classList.toggle('active', slot === currentSlot);
    tab.classList.toggle('has-action', !!button[slot]);
  }
  $('#ed-hook-hint').hidden = state.hookAvailable || currentSlot === 'action';

  // Sélecteur d'action (pour le slot courant)
  const select = $('#ed-action');
  select.innerHTML = '<option value="">— Aucune action —</option>';
  for (const group of ACTION_GROUPS) {
    const og = document.createElement('optgroup');
    og.label = group.label;
    for (const item of group.items) {
      const opt = document.createElement('option');
      opt.value = item.type;
      opt.textContent = item.label;
      og.appendChild(opt);
    }
    select.appendChild(og);
  }
  const slotAction = button[currentSlot] || null;
  select.value = slotAction ? slotAction.type : '';

  renderParams(slotAction);
}

function setActionParam(name, value) {
  const button = ensureButton(selectedKey);
  if (!button[currentSlot]) return;
  button[currentSlot].params = button[currentSlot].params || {};
  button[currentSlot].params[name] = value;
  scheduleSave();
}

function makeField(labelText, inputEl, hintText) {
  const field = document.createElement('div');
  field.className = 'field';
  if (labelText) {
    const label = document.createElement('label');
    label.textContent = labelText;
    field.appendChild(label);
  }
  field.appendChild(inputEl);
  if (hintText) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = hintText;
    field.appendChild(hint);
  }
  return field;
}

function makeTextInput(name, value, placeholder) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value || '';
  input.placeholder = placeholder || '';
  input.addEventListener('input', () => setActionParam(name, input.value));
  return input;
}

function makePathRow(name, value, pickKind, browseLabel) {
  const row = document.createElement('div');
  row.className = 'row-with-btn';
  const input = makeTextInput(name, value, '');
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = browseLabel || 'Parcourir…';
  btn.addEventListener('click', async () => {
    const picked = pickKind === 'folder' ? await api.pickFolder() : await api.pick(pickKind);
    if (picked) {
      input.value = picked;
      setActionParam(name, picked);
    }
  });
  row.appendChild(input);
  row.appendChild(btn);
  return row;
}

function makeSelect(name, value, options) {
  const select = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    select.appendChild(o);
  }
  if (value && ![...select.options].some((o) => o.value === value)) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = value + ' (introuvable)';
    select.appendChild(o);
  }
  select.value = value || (options[0] ? options[0].value : '');
  select.addEventListener('change', () => setActionParam(name, select.value));
  return select;
}

// Liste OBS (scènes / sources) avec bouton de rafraîchissement
function makeObsSelect(name, value, fetcher, emptyHint) {
  const row = document.createElement('div');
  row.className = 'row-with-btn';
  const select = document.createElement('select');
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn';
  refreshBtn.textContent = '⟳';
  refreshBtn.title = 'Rafraîchir depuis OBS';

  const fill = (items, message) => {
    select.innerHTML = '';
    if (items.length === 0) {
      const o = document.createElement('option');
      o.value = value || '';
      o.textContent = value || (message || emptyHint);
      select.appendChild(o);
    } else {
      for (const item of items) {
        const o = document.createElement('option');
        o.value = item;
        o.textContent = item;
        select.appendChild(o);
      }
      if (value && !items.includes(value)) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = value + ' (absente)';
        select.appendChild(o);
      }
      select.value = value || items[0];
      // si aucune valeur n'était choisie, mémoriser la première
      if (!value && items[0]) setActionParam(name, items[0]);
    }
  };

  const refresh = async () => {
    const res = await fetcher();
    fill(res.items, res.ok ? null : 'OBS non connecté');
    if (!res.ok && res.message) toast(res.message, 'error');
  };

  fill([], null);
  fetcher().then((res) => fill(res.items, res.ok ? null : 'OBS non connecté'));

  select.addEventListener('change', () => setActionParam(name, select.value));
  refreshBtn.addEventListener('click', refresh);
  row.appendChild(select);
  row.appendChild(refreshBtn);
  return row;
}

function renderParams(action) {
  const wrap = $('#ed-params');
  wrap.innerHTML = '';
  if (!action) return;
  const p = action.params || {};

  switch (action.type) {
    case 'app.open':
      wrap.appendChild(makeField('Application', makePathRow('path', p.path, 'app')));
      wrap.appendChild(makeField('Arguments (optionnel)', makeTextInput('args', p.args, '--exemple')));
      break;

    case 'url.open':
      wrap.appendChild(makeField('URL', makeTextInput('url', p.url, 'https://twitch.tv/...')));
      break;

    case 'file.open': {
      const field = makeField('Fichier ou dossier', makePathRow('path', p.path, 'any'));
      const folderBtn = document.createElement('button');
      folderBtn.className = 'btn btn-ghost';
      folderBtn.textContent = 'Choisir un dossier…';
      folderBtn.addEventListener('click', async () => {
        const picked = await api.pickFolder();
        if (picked) {
          field.querySelector('input').value = picked;
          setActionParam('path', picked);
        }
      });
      field.appendChild(folderBtn);
      wrap.appendChild(field);
      break;
    }

    case 'cmd.run': {
      const ta = document.createElement('textarea');
      ta.value = p.command || '';
      ta.placeholder = 'shutdown /s /t 3600';
      ta.addEventListener('input', () => setActionParam('command', ta.value));
      wrap.appendChild(makeField('Commande (cmd.exe)', ta, 'Exécutée silencieusement, sans fenêtre.'));
      break;
    }

    case 'keys.send':
      wrap.appendChild(makeField(
        'Raccourci',
        makeTextInput('combo', p.combo, 'Ctrl+Shift+F5'),
        'Modificateurs : Ctrl, Alt, Shift. Touches : A–Z, 0–9, F1–F24, Enter, Tab, Esc, flèches… Envoyé à l\'application active.'
      ));
      break;

    case 'text.type': {
      const ta = document.createElement('textarea');
      ta.value = p.text || '';
      ta.placeholder = 'Le texte sera tapé dans l\'application active…';
      ta.addEventListener('input', () => setActionParam('text', ta.value));
      wrap.appendChild(makeField('Texte', ta));
      break;
    }

    case 'media':
      wrap.appendChild(makeField('Commande', makeSelect('control', p.control || 'playpause', [
        { value: 'playpause', label: 'Lecture / pause' },
        { value: 'next', label: 'Piste suivante' },
        { value: 'prev', label: 'Piste précédente' },
        { value: 'stop', label: 'Stop' },
        { value: 'volup', label: 'Volume +' },
        { value: 'voldown', label: 'Volume −' },
        { value: 'mute', label: 'Muet' },
      ])));
      if (!p.control) setActionParam('control', 'playpause');
      break;

    case 'sound.play': {
      wrap.appendChild(makeField('Fichier audio', makePathRow('path', p.path, 'sound')));
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = '1';
      range.step = '0.05';
      range.value = typeof p.volume === 'number' ? p.volume : 1;
      range.addEventListener('input', () => setActionParam('volume', parseFloat(range.value)));
      wrap.appendChild(makeField('Volume', range));
      break;
    }

    case 'obs.scene':
      wrap.appendChild(makeField('Scène', makeObsSelect('sceneName', p.sceneName, api.obsScenes, 'Connectez OBS pour lister les scènes')));
      break;

    case 'obs.mute':
      wrap.appendChild(makeField('Source audio', makeObsSelect('inputName', p.inputName, api.obsInputs, 'Connectez OBS pour lister les sources')));
      break;

    case 'obs.transition':
    case 'obs.stream.toggle':
    case 'obs.record.toggle': {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Aucun paramètre — assurez-vous simplement qu\'OBS est connecté (voir Paramètres).';
      wrap.appendChild(hint);
      break;
    }

    case 'preset.switch': {
      const options = cfg().presets.map((pr) => ({ value: pr.id, label: pr.name }));
      wrap.appendChild(makeField('Preset', makeSelect('presetId', p.presetId, options)));
      if (!p.presetId && options[0]) setActionParam('presetId', options[0].value);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Chips d'état
// ---------------------------------------------------------------------------

function renderDeckChip() {
  const chip = $('#deck-chip');
  chip.classList.toggle('on', state.deckActive);
  $('#deck-chip-label').textContent = state.deckActive ? 'DECK ON' : 'DECK OFF';
}

function renderOverlayChips() {
  const ov = cfg().settings.overlay || {};
  $('#overlay-chip').classList.toggle('on', !!ov.enabled);
  const lockBtn = $('#overlay-lock-btn');
  lockBtn.classList.toggle('locked', !!ov.locked);
  lockBtn.disabled = !ov.enabled;
  lockBtn.title = ov.locked
    ? 'Déverrouiller l\'overlay (le rendre à nouveau cliquable et déplaçable)'
    : 'Verrouiller l\'overlay (les clics passeront au travers)';
}

function renderObsChip(status) {
  const chip = $('#obs-chip');
  chip.classList.remove('connected', 'connecting');
  if (status === 'connected') chip.classList.add('connected');
  if (status === 'connecting') chip.classList.add('connecting');
  chip.title = {
    connected: 'OBS connecté',
    connecting: 'Connexion à OBS…',
    disconnected: 'OBS non connecté — vérifiez les paramètres',
  }[status] || status;
}

// ---------------------------------------------------------------------------
// Paramètres
// ---------------------------------------------------------------------------

function openSettings() {
  const s = cfg().settings;
  $('#st-obs-host').value = s.obs.host;
  $('#st-obs-port').value = s.obs.port;
  $('#st-obs-password').value = s.obs.password;
  $('#st-startup').checked = s.launchAtStartup;
  $('#st-minimized').checked = s.startMinimized;
  $('#st-osd').checked = s.osdEnabled;
  $('#st-deckstart').checked = s.deckActiveOnStart;
  $('#st-overlay').checked = !!(s.overlay && s.overlay.enabled);
  $('#st-overlay-lock').checked = !!(s.overlay && s.overlay.locked);
  updateObsStatusText(state.obsStatus);
  $('#settings-modal').hidden = false;
}

function updateObsStatusText(status) {
  const el = $('#st-obs-status');
  if (!el) return;
  el.className = 'obs-status';
  if (status === 'connected') { el.textContent = '● Connecté'; el.classList.add('ok'); }
  else if (status === 'connecting') { el.textContent = '… Connexion en cours'; }
  else { el.textContent = '● Non connecté'; el.classList.add('err'); }
}

function bindSettings() {
  $('#settings-btn').addEventListener('click', openSettings);
  $('#st-close').addEventListener('click', () => { $('#settings-modal').hidden = true; });
  $('#settings-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) $('#settings-modal').hidden = true;
  });

  const saveObs = () => {
    const s = cfg().settings;
    s.obs.host = $('#st-obs-host').value.trim() || '127.0.0.1';
    s.obs.port = parseInt($('#st-obs-port').value, 10) || 4455;
    s.obs.password = $('#st-obs-password').value;
    scheduleSave();
  };
  $('#st-obs-host').addEventListener('change', saveObs);
  $('#st-obs-port').addEventListener('change', saveObs);
  $('#st-obs-password').addEventListener('change', saveObs);

  $('#st-obs-connect').addEventListener('click', async () => {
    saveObs();
    clearTimeout(saveTimer);
    await api.saveConfig(cfg());
    updateObsStatusText('connecting');
    const status = await api.obsReconnect();
    updateObsStatusText(status);
  });

  $('#st-startup').addEventListener('change', async (e) => {
    cfg().settings.launchAtStartup = e.target.checked;
    scheduleSave();
    await api.setStartup(e.target.checked);
  });
  $('#st-minimized').addEventListener('change', (e) => {
    cfg().settings.startMinimized = e.target.checked;
    scheduleSave();
  });
  $('#st-osd').addEventListener('change', (e) => {
    cfg().settings.osdEnabled = e.target.checked;
    scheduleSave();
  });
  $('#st-deckstart').addEventListener('change', (e) => {
    cfg().settings.deckActiveOnStart = e.target.checked;
    scheduleSave();
  });

  $('#st-overlay').addEventListener('change', async (e) => {
    const ov = await api.overlaySet({ enabled: e.target.checked });
    cfg().settings.overlay = ov;
  });
  $('#st-overlay-lock').addEventListener('change', async (e) => {
    const ov = await api.overlaySet({ locked: e.target.checked });
    cfg().settings.overlay = ov;
  });
}

// ---------------------------------------------------------------------------
// Éditeur : événements statiques
// ---------------------------------------------------------------------------

function bindEditor() {
  $('#ed-close').addEventListener('click', () => { selectedKey = null; renderDeck(); renderEditor(); });

  $('#ed-label').addEventListener('input', (e) => {
    ensureButton(selectedKey).label = e.target.value;
    scheduleSave();
    renderDeck();
  });

  $('#ed-img-pick').addEventListener('click', async () => {
    const picked = await api.pick('image');
    if (!picked) return;
    ensureButton(selectedKey).icon = picked;
    scheduleSave();
    renderDeck();
    renderEditor();
  });

  $('#ed-img-clear').addEventListener('click', () => {
    const button = getButton(selectedKey);
    if (button) button.icon = null;
    scheduleSave();
    renderDeck();
    renderEditor();
  });

  // Onglets de geste
  for (const tab of document.querySelectorAll('.slot-tab')) {
    tab.addEventListener('click', () => {
      currentSlot = SLOT_NAMES[tab.dataset.slot] || 'action';
      renderEditor();
    });
  }

  $('#ed-display').addEventListener('change', (e) => {
    const button = ensureButton(selectedKey);
    button.display = e.target.value ? { type: e.target.value } : null;
    scheduleSave();
    renderDeck();
  });

  $('#ed-action').addEventListener('change', (e) => {
    const button = ensureButton(selectedKey);
    button[currentSlot] = e.target.value ? { type: e.target.value, params: {} } : null;
    scheduleSave();
    renderDeck();
    renderEditor();
  });

  $('#ed-test').addEventListener('click', async () => {
    const button = getButton(selectedKey);
    const action = button && button[currentSlot];
    if (!action) { toast('Aucune action à tester sur ce geste', 'error'); return; }
    clearTimeout(saveTimer);
    await api.saveConfig(cfg());
    const res = await api.testAction(action);
    if (res.ok) toast('Action exécutée ✓', 'ok');
    else toast(res.message, 'error');
  });

  $('#ed-reset').addEventListener('click', () => {
    activePreset().buttons[selectedKey] = null;
    scheduleSave();
    renderDeck();
    renderEditor();
  });
}

// ---------------------------------------------------------------------------
// Mises à jour
// ---------------------------------------------------------------------------

let updatePhase = 'idle'; // idle | available | downloading | ready

function setUpdateStatus(text, cls) {
  const el = $('#st-update-status');
  if (!el) return;
  el.className = 'obs-status' + (cls ? ' ' + cls : '');
  el.textContent = text;
}

function showUpdateBanner(text, actionLabel) {
  $('#update-banner').hidden = false;
  $('#update-text').textContent = text;
  const btn = $('#update-action');
  btn.textContent = actionLabel || '';
  btn.hidden = !actionLabel;
  $('#update-later').hidden = updatePhase === 'downloading';
}

function bindUpdates() {
  $('#update-action').addEventListener('click', () => {
    if (updatePhase === 'available') {
      updatePhase = 'downloading';
      showUpdateBanner('Téléchargement de la mise à jour… 0 %', null);
      api.updateDownload();
    } else if (updatePhase === 'ready') {
      api.updateInstall();
    }
  });

  $('#update-later').addEventListener('click', () => {
    $('#update-banner').hidden = true;
  });

  $('#st-update-check').addEventListener('click', () => {
    setUpdateStatus('Vérification…');
    api.updateCheck();
  });

  api.on('update:available', ({ version }) => {
    updatePhase = 'available';
    showUpdateBanner(`Mise à jour disponible : NumDeck v${version}`, 'Télécharger');
    setUpdateStatus(`v${version} disponible`, 'ok');
  });

  api.on('update:none', ({ dev }) => {
    setUpdateStatus(dev ? 'Indisponible en mode développement' : 'Vous êtes à jour ✓', dev ? '' : 'ok');
  });

  api.on('update:progress', ({ percent }) => {
    if (updatePhase !== 'downloading') return;
    showUpdateBanner(`Téléchargement de la mise à jour… ${percent} %`, null);
  });

  api.on('update:ready', ({ version }) => {
    updatePhase = 'ready';
    showUpdateBanner(`NumDeck v${version} est prêt à être installé`, 'Redémarrer et installer');
    setUpdateStatus(`v${version} prête à installer`, 'ok');
  });

  api.on('update:error', () => {
    // Dépôt non configuré ou hors-ligne : rien d'intrusif
    setUpdateStatus('Vérification impossible (hors-ligne ?)', 'err');
    if (updatePhase === 'downloading') {
      updatePhase = 'available';
      showUpdateBanner('Échec du téléchargement — réessayer ?', 'Télécharger');
    }
  });
}

// ---------------------------------------------------------------------------
// Sons (soundboard)
// ---------------------------------------------------------------------------

function playSound(filePath, volume) {
  const audio = new Audio(api.toFileURL(filePath));
  audio.volume = Math.max(0, Math.min(1, volume));
  activeSounds.push(audio);
  audio.addEventListener('ended', () => {
    activeSounds = activeSounds.filter((a) => a !== audio);
  });
  audio.play().catch((err) => toast('Lecture audio impossible : ' + err.message, 'error'));
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

async function boot() {
  state = await api.getState();

  $('#app-version').textContent = 'v' + state.version;

  renderPresets();
  renderDeck();
  renderEditor();
  renderDeckChip();
  renderObsChip(state.obsStatus);
  bindEditor();
  bindSettings();
  bindUpdates();

  $('#preset-add').addEventListener('click', addPreset);
  $('#deck-chip').addEventListener('click', () => api.toggleDeck());

  renderOverlayChips();
  $('#overlay-chip').addEventListener('click', async () => {
    const ov = await api.overlaySet({ enabled: !cfg().settings.overlay.enabled });
    cfg().settings.overlay = ov;
    renderOverlayChips();
  });
  $('#overlay-lock-btn').addEventListener('click', async () => {
    const ov = await api.overlaySet({ locked: !cfg().settings.overlay.locked });
    cfg().settings.overlay = ov;
    renderOverlayChips();
  });

  $('#win-min').addEventListener('click', () => api.windowControl('minimize'));
  $('#win-max').addEventListener('click', () => api.windowControl('maximize'));
  $('#win-close').addEventListener('click', () => api.windowControl('close'));

  // Événements du processus principal
  api.on('deck:changed', ({ active }) => {
    state.deckActive = active;
    renderDeckChip();
    renderDeck();
  });

  api.on('preset:changed', async ({ presetId }) => {
    cfg().activePresetId = presetId;
    renderPresets();
    renderDeck();
    renderEditor();
  });

  api.on('key:pressed', ({ key }) => flashKey(key));

  api.on('obs:status', (status) => {
    state.obsStatus = status;
    renderObsChip(status);
    updateObsStatusText(status);
  });

  api.on('sound:play', ({ path, volume }) => playSound(path, volume));

  api.on('action:error', ({ label, message }) => {
    toast(`${label} : ${message}`, 'error');
  });

  api.on('ticker:data', (t) => {
    state.ticker = t;
    for (const el of document.querySelectorAll('.key-display[data-display]')) {
      el.textContent = displayText(el.dataset.display);
    }
  });

  api.on('overlay:state', ({ enabled, locked }) => {
    cfg().settings.overlay.enabled = enabled;
    cfg().settings.overlay.locked = locked;
    renderOverlayChips();
    const cb1 = $('#st-overlay');
    const cb2 = $('#st-overlay-lock');
    if (cb1) cb1.checked = enabled;
    if (cb2) cb2.checked = locked;
  });
}

boot();
