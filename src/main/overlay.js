'use strict';

// Mini-deck épinglé au-dessus de toutes les fenêtres : montre l'état du deck,
// le preset actif et les touches qui s'illuminent à l'appui. Déplaçable quand
// déverrouillé ; verrouillé, les clics le traversent (click-through).

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const config = require('./config');

const WIDTH = 196;
const HEIGHT = 296;
const MARGIN = 16;

let win = null;
let saveTimer = null;

function settings() {
  return config.get().settings.overlay;
}

function ensureWindow() {
  if (win && !win.isDestroyed()) return win;

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
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

function initialPosition() {
  const s = settings();
  const area = screen.getPrimaryDisplay().workArea;
  let x = s.x;
  let y = s.y;
  const valid =
    typeof x === 'number' && typeof y === 'number' &&
    screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return x >= a.x - WIDTH / 2 && x < a.x + a.width && y >= a.y - 20 && y < a.y + a.height;
    });
  if (!valid) {
    x = area.x + area.width - WIDTH - MARGIN;
    y = area.y + area.height - HEIGHT - MARGIN;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

function applyState() {
  const s = settings();
  if (!s.enabled) {
    if (win && !win.isDestroyed()) win.hide();
    return;
  }
  const w = ensureWindow();
  const apply = () => {
    const { x, y } = initialPosition();
    w.setPosition(x, y);
    w.setIgnoreMouseEvents(!!s.locked);
    w.webContents.send('overlay:state', { locked: !!s.locked });
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

module.exports = { applyState, send, isVisible, dispose };
