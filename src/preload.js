'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Équivalent de url.pathToFileURL, sans dépendre du module 'url'
// (non disponible dans un preload sandboxé)
function pathToFileURL(p) {
  const normalized = p.replace(/\\/g, '/');
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///';
  return prefix + encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

const EVENT_CHANNELS = new Set([
  'deck:changed',
  'preset:changed',
  'key:pressed',
  'action:fired',
  'action:error',
  'obs:status',
  'sound:play',
  'osd:show',
  'config:changed',
  'ticker:data',
  'overlay:state',
  'update:available',
  'update:none',
  'update:progress',
  'update:ready',
  'update:error',
]);

contextBridge.exposeInMainWorld('numdeck', {
  // État + configuration
  getState: () => ipcRenderer.invoke('state:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  activatePreset: (presetId) => ipcRenderer.invoke('preset:activate', presetId),
  toggleDeck: () => ipcRenderer.invoke('deck:toggle'),

  // Actions
  testAction: (action) => ipcRenderer.invoke('action:test', action),

  // OBS
  obsReconnect: () => ipcRenderer.invoke('obs:reconnect'),
  obsStatus: () => ipcRenderer.invoke('obs:status'),
  obsScenes: () => ipcRenderer.invoke('obs:scenes'),
  obsInputs: () => ipcRenderer.invoke('obs:inputs'),

  // Dialogues fichiers
  pick: (kind) => ipcRenderer.invoke('dialog:pick', kind),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  importIcon: (srcPath) => ipcRenderer.invoke('icon:import', srcPath),

  // Système
  setStartup: (enabled) => ipcRenderer.invoke('startup:set', enabled),
  windowControl: (op) => ipcRenderer.send('window:control', op),
  overlaySet: (patch) => ipcRenderer.invoke('overlay:set', patch),

  // Mises à jour
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.send('update:download'),
  updateInstall: () => ipcRenderer.send('update:install'),

  // Utilitaires
  toFileURL: (p) => (p ? pathToFileURL(p) : null),
  pathForFile: (file) => webUtils.getPathForFile(file),

  // Événements main -> renderer
  on: (channel, callback) => {
    if (!EVENT_CHANNELS.has(channel)) return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
