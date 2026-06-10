'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const config = require('./config');
const shortcuts = require('./shortcuts');
const actions = require('./actions');
const obs = require('./obs');
const osd = require('./osd');
const overlay = require('./overlay');
const updater = require('./updater');

const SMOKE_MODE = process.argv.includes('--smoke');
const ASSETS = path.join(__dirname, '..', '..', 'assets');

// Sur certains profils Windows aux permissions modifiées, le processus GPU
// sandboxé de Chromium se voit refuser la lecture des fichiers de l'app
// (erreur 0xC0000022 en boucle puis « GPU process isn't usable ») et l'app
// se ferme quelques secondes après le lancement. On désactive uniquement le
// sandbox GPU ; celui des renderers reste actif.
app.commandLine.appendSwitch('disable-gpu-sandbox');

// --- Résilience aux crashs de processus enfants -----------------------------
// Certains logiciels (anticheats de jeux comme Riot Vanguard, antivirus…)
// tuent les processus de rendu des applications à hooks clavier globaux.
// On journalise la cause et on recharge la fenêtre au lieu de rester noir.

function logCrash(line) {
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'crash.log'),
      `[${new Date().toISOString()}] ${line}\n`
    );
  } catch (_) { /* le journal ne doit jamais faire planter l'app */ }
}

let reloadBudget = 6; // recharges max par fenêtre de 5 minutes
setInterval(() => { reloadBudget = 6; }, 5 * 60 * 1000).unref();

// Codes de l'éditeur de liens Windows : le processus n'a même pas pu démarrer
// (0xC0000135 DLL introuvable, 0xC0000022 accès refusé). Sur les profils aux
// ACL modifiées, le sandbox des renderers est inutilisable : on relance
// automatiquement l'app sans sandbox (contextIsolation reste actif, et l'app
// ne charge que du contenu local).
const LOADER_FAILURE_CODES = new Set([-1073741515, -1073741790]);
const sandboxDisabled = process.argv.includes('--no-sandbox');
let loaderFailures = 0;

app.on('render-process-gone', (_e, contents, details) => {
  logCrash(`renderer mort : raison=${details.reason} code=${details.exitCode} url=${contents.getURL()}`);
  if (details.reason === 'clean-exit' || details.reason === 'killed') return;

  if (!sandboxDisabled && LOADER_FAILURE_CODES.has(details.exitCode) && !contents.getURL()) {
    loaderFailures++;
    if (loaderFailures >= 2) {
      logCrash('renderers incapables de démarrer (sandbox bloqué sur ce profil) → relance en mode --no-sandbox');
      app.relaunch({ args: process.argv.slice(1).concat(['--no-sandbox']) });
      app.exit(0);
      return;
    }
  }

  if (reloadBudget <= 0) return;
  reloadBudget--;
  setTimeout(() => {
    if (!contents.isDestroyed()) contents.reload();
  }, 1200);
});

app.on('child-process-gone', (_e, details) => {
  logCrash(`processus ${details.type} mort : raison=${details.reason} code=${details.exitCode}`);
});

let mainWindow = null;
let tray = null;
let isQuitting = false;

// --- Instance unique -------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

// --- Fenêtre principale ----------------------------------------------------

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: '#0b0d13',
    icon: path.join(ASSETS, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    const { startMinimized } = config.get().settings;
    if (!startMinimized || SMOKE_MODE) mainWindow.show();
  });

  // Fermer = réduire dans la zone de notification (l'app doit continuer
  // à écouter le pavé numérique en arrière-plan)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  if (SMOKE_MODE) {
    mainWindow.webContents.on('console-message', (_e, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
  }
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// Diffuse aux deux interfaces (fenêtre principale + overlay)
function broadcast(channel, payload) {
  sendToWindow(channel, payload);
  overlay.send(channel, payload);
}

// --- Zone de notification (tray) -------------------------------------------

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('NumDeck — votre pavé numérique en Stream Deck');
  updateTrayMenu();
  tray.on('double-click', showMainWindow);
}

function updateTrayMenu() {
  if (!tray) return;
  const ov = config.get().settings.overlay;
  const menu = Menu.buildFromTemplate([
    { label: 'Ouvrir NumDeck', click: showMainWindow },
    {
      label: 'Mode deck actif',
      type: 'checkbox',
      checked: shortcuts.isDeckActive(),
      click: (item) => shortcuts.setDeckActive(item.checked),
    },
    { type: 'separator' },
    {
      label: 'Afficher l\'overlay',
      type: 'checkbox',
      checked: !!ov.enabled,
      click: (item) => setOverlayState({ enabled: item.checked }),
    },
    {
      label: 'Verrouiller l\'overlay (clics au travers)',
      type: 'checkbox',
      checked: !!ov.locked,
      enabled: !!ov.enabled,
      click: (item) => setOverlayState({ locked: item.checked }),
    },
    { type: 'separator' },
    {
      label: 'Quitter',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function setOverlayState(patch) {
  const cfg = config.get();
  const wasLocked = !!cfg.settings.overlay.locked;
  cfg.settings.overlay = { ...cfg.settings.overlay, ...patch };
  config.save(cfg);
  overlay.applyState();
  updateTrayMenu();
  sendToWindow('overlay:state', {
    enabled: !!cfg.settings.overlay.enabled,
    locked: !!cfg.settings.overlay.locked,
  });
  if (!wasLocked && cfg.settings.overlay.locked && osdEnabled()) {
    osd.show('key', 'Overlay verrouillé', 'Déverrouillage : bouton cadenas de la fenêtre NumDeck');
  }
}

// --- Diffusion des événements (renderer + OSD) ------------------------------

function osdEnabled() {
  return config.get().settings.osdEnabled;
}

const GESTURE_LABELS = { tap: '', double: ' (double appui)', long: ' (appui long)' };

function emit(event, payload) {
  switch (event) {
    case 'deck:changed':
      broadcast('deck:changed', payload);
      updateTrayMenu();
      if (payload.active) checkNumLock(true);
      if (!payload.silent && osdEnabled()) {
        osd.show(
          payload.active ? 'on' : 'off',
          payload.active ? 'NumDeck activé' : 'NumDeck désactivé',
          payload.active ? `Preset : ${config.getActivePreset().name}` : 'Le pavé numérique redevient normal'
        );
      }
      break;
    case 'preset:changed':
      broadcast('preset:changed', payload);
      if (osdEnabled()) osd.show('preset', payload.name, 'Preset actif');
      break;
    case 'key:pressed':
      broadcast('key:pressed', payload);
      break;
    case 'action:fired':
      broadcast('action:fired', payload);
      // L'overlay fournit déjà le retour visuel : OSD seulement sans lui
      if (osdEnabled() && !overlay.isVisible()) {
        osd.show('key', payload.label + (GESTURE_LABELS[payload.gesture] || ''), '');
      }
      break;
    case 'action:error':
      broadcast('action:error', payload);
      if (osdEnabled()) osd.show('error', 'Échec de l\'action', payload.message);
      break;
  }
}

// --- Verr Num : sans lui, les touches 0-9 du pavé ne sont pas capturables ---

let numLockTimer = null;

function checkNumLock(warnIfOff) {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::NumberLock'], { windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.on('close', () => {
    const on = /true/i.test(out);
    shortcuts.setNumLockState(on);
    if (!on && warnIfOff && osdEnabled()) {
      osd.show('error', 'Verr Num désactivé', 'Activez Verr Num pour utiliser les touches 0-9');
    }
  });
  child.on('error', () => {});
}

function startNumLockWatch() {
  checkNumLock(false);
  numLockTimer = setInterval(() => {
    if (shortcuts.isDeckActive()) checkNumLock(false);
  }, 20000);
}

// --- Ticker : données en direct pour les touches "affichage" ---

let tickerTimer = null;
let lastCpus = os.cpus();

function cpuPercent() {
  const cur = os.cpus();
  let idle = 0;
  let total = 0;
  for (let i = 0; i < cur.length && i < lastCpus.length; i++) {
    const c = cur[i].times;
    const l = lastCpus[i].times;
    const dIdle = c.idle - l.idle;
    idle += dIdle;
    total += (c.user - l.user) + (c.nice - l.nice) + (c.sys - l.sys) + (c.irq - l.irq) + dIdle;
  }
  lastCpus = cur;
  return total > 0 ? Math.round(100 * (1 - idle / total)) : 0;
}

function tickerData() {
  const now = new Date();
  return {
    time: now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    date: now.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }),
    cpu: cpuPercent(),
    ram: Math.round(100 * (1 - os.freemem() / os.totalmem())),
    obs: obs.getLive(),
  };
}

function startTicker() {
  tickerTimer = setInterval(() => broadcast('ticker:data', tickerData()), 1000);
}

// --- IPC --------------------------------------------------------------------

const PICK_FILTERS = {
  image: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
  app: [{ name: 'Applications', extensions: ['exe', 'lnk', 'bat', 'cmd'] }],
  sound: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }],
  any: [{ name: 'Tous les fichiers', extensions: ['*'] }],
};

function registerIpc() {
  ipcMain.handle('state:get', () => ({
    config: config.get(),
    deckActive: shortcuts.isDeckActive(),
    obsStatus: obs.getStatus(),
    hookAvailable: shortcuts.isHookAvailable(),
    ticker: tickerData(),
    version: app.getVersion(),
  }));

  ipcMain.handle('config:set', (_e, cfg) => {
    const obsBefore = JSON.stringify(config.get().settings.obs);
    // L'état de l'overlay (position, verrou, visibilité) appartient au processus
    // principal et ne passe que par le canal overlay:set — on ignore la copie
    // de la fenêtre pour ne jamais l'écraser avec des valeurs périmées.
    cfg.settings.overlay = config.get().settings.overlay;
    config.save(cfg);
    shortcuts.refresh();
    if (JSON.stringify(cfg.settings.obs) !== obsBefore) {
      obs.reconnect();
    }
    overlay.send('config:changed', config.get());
    return config.get();
  });

  ipcMain.handle('overlay:set', (_e, patch) => {
    setOverlayState(patch);
    return config.get().settings.overlay;
  });

  ipcMain.on('overlay:interactive', (_e, interactive) => {
    overlay.setInteractive(!!interactive);
  });

  ipcMain.on('overlay:scale', (_e, { scale, commit }) => {
    if (typeof scale === 'number') overlay.setScale(scale, !!commit);
  });

  ipcMain.handle('preset:activate', (_e, presetId) => {
    const preset = config.setActivePreset(presetId);
    sendToWindow('preset:changed', { presetId: preset.id, name: preset.name });
    return preset.id;
  });

  ipcMain.handle('deck:toggle', () => {
    shortcuts.setDeckActive(!shortcuts.isDeckActive());
    return shortcuts.isDeckActive();
  });

  ipcMain.handle('action:test', async (_e, action) => {
    try {
      await actions.execute(action);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  ipcMain.handle('obs:reconnect', () => obs.reconnect());
  ipcMain.handle('obs:status', () => obs.getStatus());
  ipcMain.handle('obs:scenes', async () => {
    try { return { ok: true, items: await obs.getScenes() }; }
    catch (err) { return { ok: false, message: err.message, items: [] }; }
  });
  ipcMain.handle('obs:inputs', async () => {
    try { return { ok: true, items: await obs.getInputs() }; }
    catch (err) { return { ok: false, message: err.message, items: [] }; }
  });

  ipcMain.handle('dialog:pick', async (_e, kind) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: PICK_FILTERS[kind] || PICK_FILTERS.any,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    let filePath = result.filePaths[0];
    if (kind === 'image') filePath = config.importIcon(filePath);
    return filePath;
  });

  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('icon:import', (_e, srcPath) => {
    try { return config.importIcon(srcPath); }
    catch (err) { return null; }
  });

  ipcMain.handle('startup:set', (_e, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('update:check', () => updater.check());
  ipcMain.on('update:download', () => updater.download());
  ipcMain.on('update:install', () => updater.install());

  ipcMain.on('window:control', (_e, op) => {
    if (!mainWindow) return;
    if (op === 'minimize') mainWindow.minimize();
    else if (op === 'maximize') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    } else if (op === 'close') mainWindow.close();
  });
}

// --- Cycle de vie -----------------------------------------------------------

app.whenReady().then(() => {
  config.init();

  actions.init({
    playSound: (filePath, volume) => sendToWindow('sound:play', { path: filePath, volume }),
    switchPreset: (presetId) => {
      const preset = config.setActivePreset(presetId);
      emit('preset:changed', { presetId: preset.id, name: preset.name });
    },
    toggleDeck: () => shortcuts.setDeckActive(!shortcuts.isDeckActive()),
  });

  obs.init({
    getSettings: () => config.get().settings.obs,
    onStatusChange: (status) => broadcast('obs:status', status),
    onLiveChange: () => broadcast('ticker:data', tickerData()),
  });

  createMainWindow();
  createTray();
  registerIpc();
  shortcuts.init({ emit });
  overlay.applyState();
  startTicker();
  startNumLockWatch();
  updater.init({
    send: (channel, payload) => sendToWindow(channel, payload),
    onBeforeInstall: () => { isQuitting = true; },
  });

  if (SMOKE_MODE) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        console.log('SMOKE_OK deck=' + shortcuts.isDeckActive() + ' obs=' + obs.getStatus() + ' hook=' + shortcuts.isHookAvailable());
        isQuitting = true;
        app.quit();
      }, 2500);
    });
  }
});

app.on('window-all-closed', () => {
  // Ne rien faire : l'app vit dans la zone de notification
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  if (tickerTimer) clearInterval(tickerTimer);
  if (numLockTimer) clearInterval(numLockTimer);
  shortcuts.dispose();
  osd.dispose();
  overlay.dispose();
});
