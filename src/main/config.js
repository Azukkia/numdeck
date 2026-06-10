'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Touches du pavé numérique configurables (accélérateurs Electron)
const BINDABLE_KEYS = [
  'numdiv', 'nummult',
  'num7', 'num8', 'num9',
  'num4', 'num5', 'num6',
  'num1', 'num2', 'num3',
  'num0', 'numdec',
];

const TOGGLE_KEY = 'numadd';      // active / désactive le mode deck
const PRESET_CYCLE_KEY = 'numsub'; // preset suivant (quand le deck est actif)

function defaultButtons() {
  const buttons = {};
  for (const key of BINDABLE_KEYS) {
    buttons[key] = null;
  }
  return buttons;
}

function defaultConfig() {
  return {
    version: 1,
    activePresetId: 'preset-1',
    presets: [
      {
        id: 'preset-1',
        name: 'Preset 1',
        buttons: defaultButtons(),
      },
    ],
    settings: {
      obs: { host: '127.0.0.1', port: 4455, password: '' },
      launchAtStartup: false,
      startMinimized: false,
      osdEnabled: true,
      deckActiveOnStart: false,
      overlay: { enabled: true, locked: false, x: null, y: null, scale: 1 },
    },
  };
}

let configPath = null;
let iconsDir = null;
let cached = null;

function init() {
  const userData = app.getPath('userData');
  configPath = path.join(userData, 'config.json');
  iconsDir = path.join(userData, 'icons');
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }
}

function deepMerge(base, extra) {
  if (extra === null || extra === undefined) return base;
  if (Array.isArray(base) || Array.isArray(extra)) return extra;
  if (typeof base === 'object' && typeof extra === 'object') {
    const out = { ...base };
    for (const key of Object.keys(extra)) {
      out[key] = key in base ? deepMerge(base[key], extra[key]) : extra[key];
    }
    return out;
  }
  return extra;
}

function load() {
  if (cached) return cached;
  let cfg = defaultConfig();
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      cfg = deepMerge(cfg, raw);
    }
  } catch (err) {
    console.error('[config] lecture impossible, valeurs par défaut utilisées :', err.message);
  }
  // Garanties d'intégrité minimales
  if (!Array.isArray(cfg.presets) || cfg.presets.length === 0) {
    cfg.presets = defaultConfig().presets;
  }
  for (const preset of cfg.presets) {
    if (!preset.buttons) preset.buttons = defaultButtons();
    for (const key of BINDABLE_KEYS) {
      if (!(key in preset.buttons)) preset.buttons[key] = null;
    }
  }
  if (!cfg.presets.some((p) => p.id === cfg.activePresetId)) {
    cfg.activePresetId = cfg.presets[0].id;
  }
  cached = cfg;
  return cfg;
}

function save(cfg) {
  cached = cfg;
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, configPath);
  return cfg;
}

function get() {
  return load();
}

function getActivePreset() {
  const cfg = load();
  return cfg.presets.find((p) => p.id === cfg.activePresetId) || cfg.presets[0];
}

function setActivePreset(presetId) {
  const cfg = load();
  if (cfg.presets.some((p) => p.id === presetId)) {
    cfg.activePresetId = presetId;
    save(cfg);
  }
  return getActivePreset();
}

function cyclePreset() {
  const cfg = load();
  const idx = cfg.presets.findIndex((p) => p.id === cfg.activePresetId);
  const next = cfg.presets[(idx + 1) % cfg.presets.length];
  cfg.activePresetId = next.id;
  save(cfg);
  return next;
}

// Copie une image choisie par l'utilisateur dans le dossier de l'app
// (l'icône survit si le fichier d'origine est déplacé ou supprimé)
function importIcon(srcPath) {
  const data = fs.readFileSync(srcPath);
  const hash = crypto.createHash('sha1').update(data).digest('hex').slice(0, 16);
  const ext = path.extname(srcPath).toLowerCase() || '.png';
  const dest = path.join(iconsDir, hash + ext);
  if (!fs.existsSync(dest)) {
    fs.writeFileSync(dest, data);
  }
  return dest;
}

module.exports = {
  BINDABLE_KEYS,
  TOGGLE_KEY,
  PRESET_CYCLE_KEY,
  init,
  get,
  save,
  getActivePreset,
  setActivePreset,
  cyclePreset,
  importIcon,
};
