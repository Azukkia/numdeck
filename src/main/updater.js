'use strict';

// Mises à jour automatiques via GitHub Releases (electron-updater).
// À chaque lancement (et toutes les 4 h), l'app compare sa version à la
// dernière release du dépôt GitHub configuré dans package.json (build.publish).
// Le téléchargement ne démarre que si l'utilisateur l'accepte.

const { app } = require('electron');

const CHECK_DELAY_MS = 5000;
const CHECK_INTERVAL_MS = 4 * 3600 * 1000;

let autoUpdater = null;
let send = () => {};
let onBeforeInstall = () => {};
let availableVersion = '';

function init(opts) {
  send = opts.send;
  onBeforeInstall = opts.onBeforeInstall || onBeforeInstall;

  // En développement (non packagé), pas de vérification
  if (!app.isPackaged) return;

  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('[updater] electron-updater indisponible :', err.message);
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    availableVersion = info.version;
    send('update:available', {
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
    });
  });
  autoUpdater.on('update-not-available', () => send('update:none', {}));
  autoUpdater.on('download-progress', (p) => {
    send('update:progress', { percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', () => {
    send('update:ready', { version: availableVersion });
  });
  autoUpdater.on('error', (err) => {
    // Dépôt pas encore configuré / hors-ligne : silencieux, juste signalé à l'UI
    send('update:error', { message: err ? (err.message || String(err)) : 'Erreur inconnue' });
  });

  setTimeout(check, CHECK_DELAY_MS);
  setInterval(check, CHECK_INTERVAL_MS);
}

async function check() {
  if (!autoUpdater) {
    send('update:none', { dev: true });
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (_) {
    /* déjà remonté par l'événement 'error' */
  }
}

function download() {
  if (autoUpdater) autoUpdater.downloadUpdate().catch(() => {});
}

function install() {
  if (!autoUpdater) return;
  onBeforeInstall();
  autoUpdater.quitAndInstall(false, true);
}

module.exports = { init, check, download, install };
