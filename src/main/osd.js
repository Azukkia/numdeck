'use strict';

// Petite fenêtre flottante (OSD) affichée par-dessus tout — y compris les jeux
// en mode fenêtré — pour confirmer l'activation du deck, les changements de
// preset et les appuis de touches, sans avoir à ouvrir l'application.

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const WIDTH = 360;
const HEIGHT = 96;
const DISPLAY_MS = 1400;

let win = null;
let hideTimer = null;

function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
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
  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'osd.html'));
  return win;
}

function position() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  win.setBounds({
    x: Math.round(x + (width - WIDTH) / 2),
    y: Math.round(y + height - HEIGHT - 48),
    width: WIDTH,
    height: HEIGHT,
  });
}

// kind: 'on' | 'off' | 'preset' | 'key' | 'error'
function show(kind, title, subtitle) {
  const w = ensureWindow();
  const send = () => {
    position();
    w.webContents.send('osd:show', { kind, title, subtitle: subtitle || '' });
    w.showInactive();
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) win.hide();
    }, DISPLAY_MS);
  };
  if (w.webContents.isLoading()) {
    w.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function dispose() {
  if (hideTimer) clearTimeout(hideTimer);
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

module.exports = { show, dispose };
