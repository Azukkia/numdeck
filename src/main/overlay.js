'use strict';

// Mini-deck épinglé au-dessus de toutes les fenêtres : montre l'état du deck,
// le preset actif et les touches qui s'illuminent à l'appui.
// - déplaçable (bloqué aux bords de l'écran), redimensionnable par le coin
// - verrouillé : les clics le traversent, sauf au survol du cadenas

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const config = require('./config');

const BASE_W = 196;
const BASE_H = 296;
const MARGIN = 16;
const MIN_SCALE = 0.7;
const MAX_SCALE = 1.8;

let win = null;
let saveTimer = null;
let clamping = false;

function settings() {
  return config.get().settings.overlay;
}

function getScale() {
  const s = typeof settings().scale === 'number' ? settings().scale : 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

function sizeFor(scale) {
  return { width: Math.round(BASE_W * scale), height: Math.round(BASE_H * scale) };
}

// Empêche la fenêtre de sortir de l'écran (bloquée aux bords / coins)
function clampBounds(b) {
  const area = screen.getDisplayMatching(b).workArea;
  return {
    x: Math.min(Math.max(b.x, area.x), Math.max(area.x, area.x + area.width - b.width)),
    y: Math.min(Math.max(b.y, area.y), Math.max(area.y, area.y + area.height - b.height)),
    width: b.width,
    height: b.height,
  };
}

function ensureWindow() {
  if (win && !win.isDestroyed()) return win;

  const { width, height } = sizeFor(getScale());
  win = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    focusable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));

  win.on('moved', () => {
    if (clamping || !win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    const clamped = clampBounds(bounds);
    if (clamped.x !== bounds.x || clamped.y !== bounds.y) {
      clamping = true;
      win.setBounds(clamped);
      clamping = false;
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const [x, y] = win.getPosition();
      const cfg = config.get();
      cfg.settings.overlay.x = x;
      cfg.settings.overlay.y = y;
      config.save(cfg);
    }, 400);
  });

  return win;
}

function initialPosition(width, height) {
  const s = settings();
  const area = screen.getPrimaryDisplay().workArea;
  let x = s.x;
  let y = s.y;
  if (typeof x !== 'number' || typeof y !== 'number') {
    x = area.x + area.width - width - MARGIN;
    y = area.y + area.height - height - MARGIN;
  }
  return clampBounds({ x: Math.round(x), y: Math.round(y), width, height });
}

function applyState() {
  const s = settings();
  if (!s.enabled) {
    if (win && !win.isDestroyed()) win.hide();
    return;
  }
  const w = ensureWindow();
  const apply = () => {
    const scale = getScale();
    w.setBounds(initialPosition(sizeFor(scale).width, sizeFor(scale).height));
    applyMouseMode();
    w.webContents.send('overlay:state', { locked: !!s.locked, scale });
    // resynchroniser l'état (des événements ont pu être manqués quand il était caché)
    w.webContents.send('config:changed', config.get());
    w.showInactive();
  };
  if (w.webContents.isLoading()) {
    w.webContents.once('did-finish-load', apply);
  } else {
    apply();
  }
}

function applyMouseMode() {
  if (!win || win.isDestroyed()) return;
  if (settings().locked) {
    // clics au travers, mais la souris reste détectable (survol du cadenas)
    win.setIgnoreMouseEvents(true, { forward: true });
  } else {
    win.setIgnoreMouseEvents(false);
  }
}

// Le curseur survole le cadenas : redevenir cliquable le temps du survol
function setInteractive(interactive) {
  if (!win || win.isDestroyed() || !settings().locked) return;
  if (interactive) {
    win.setIgnoreMouseEvents(false);
  } else {
    win.setIgnoreMouseEvents(true, { forward: true });
  }
}

// Redimensionnement par la poignée (échelle 0.7 → 1.8)
function setScale(scale, commit) {
  if (!win || win.isDestroyed()) return;
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
  const [x, y] = win.getPosition();
  const { width, height } = sizeFor(s);
  win.setBounds(clampBounds({ x, y, width, height }));
  if (commit) {
    const cfg = config.get();
    cfg.settings.overlay.scale = s;
    const [fx, fy] = win.getPosition();
    cfg.settings.overlay.x = fx;
    cfg.settings.overlay.y = fy;
    config.save(cfg);
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.webContents.send(channel, payload);
  }
}

function isVisible() {
  return !!(win && !win.isDestroyed() && win.isVisible() && settings().enabled);
}

function dispose() {
  if (saveTimer) clearTimeout(saveTimer);
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

module.exports = { applyState, setInteractive, setScale, send, isVisible, dispose };
