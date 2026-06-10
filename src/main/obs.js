'use strict';

// Client OBS WebSocket (protocole v5, OBS Studio 28+)
// Reconnexion automatique tant que l'app tourne.

const RETRY_DELAY_MS = 8000;

let OBSWebSocket = null;
let obs = null;
let status = 'disconnected'; // disconnected | connecting | connected
let retryTimer = null;
let onStatusChange = () => {};
let onLiveChange = () => {};
let getSettings = () => ({ host: '127.0.0.1', port: 4455, password: '' });

// État stream / enregistrement (pour l'affichage en direct sur les touches)
let live = { streaming: false, recording: false };

function setStatus(next, detail) {
  if (status !== next) {
    status = next;
    onStatusChange(status, detail || null);
  }
}

function setLive(patch) {
  const next = { ...live, ...patch };
  if (next.streaming !== live.streaming || next.recording !== live.recording) {
    live = next;
    onLiveChange(live);
  }
}

async function refreshLiveState() {
  try {
    const [stream, record] = await Promise.all([
      obs.call('GetStreamStatus'),
      obs.call('GetRecordStatus'),
    ]);
    setLive({ streaming: !!stream.outputActive, recording: !!record.outputActive });
  } catch (_) {
    /* non bloquant */
  }
}

function init(opts) {
  getSettings = opts.getSettings;
  onStatusChange = opts.onStatusChange || onStatusChange;
  onLiveChange = opts.onLiveChange || onLiveChange;
  OBSWebSocket = require('obs-websocket-js').default;
  obs = new OBSWebSocket();

  obs.on('ConnectionClosed', () => {
    setStatus('disconnected');
    setLive({ streaming: false, recording: false });
    scheduleRetry();
  });
  obs.on('Identified', () => refreshLiveState());
  obs.on('StreamStateChanged', (e) => setLive({ streaming: !!e.outputActive }));
  obs.on('RecordStateChanged', (e) => setLive({ recording: !!e.outputActive }));

  connect();
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (status === 'disconnected') connect();
  }, RETRY_DELAY_MS);
}

async function connect() {
  if (!obs || status === 'connecting' || status === 'connected') return getStatus();
  setStatus('connecting');
  const { host, port, password } = getSettings();
  try {
    await obs.connect(`ws://${host}:${port}`, password || undefined);
    setStatus('connected');
  } catch (err) {
    setStatus('disconnected', err.message);
    scheduleRetry();
  }
  return getStatus();
}

async function reconnect() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  try {
    await obs.disconnect();
  } catch (_) {
    /* déjà déconnecté */
  }
  setStatus('disconnected');
  return connect();
}

function getStatus() {
  return status;
}

async function call(requestType, requestData) {
  if (status !== 'connected') {
    throw new Error('OBS non connecté — vérifiez que OBS est lancé et que le WebSocket est activé (Outils → Paramètres du serveur WebSocket).');
  }
  return obs.call(requestType, requestData);
}

async function getScenes() {
  const res = await call('GetSceneList');
  return res.scenes.map((s) => s.sceneName).reverse();
}

async function getInputs() {
  const res = await call('GetInputList');
  return res.inputs.map((i) => i.inputName);
}

function getLive() {
  return live;
}

module.exports = { init, connect, reconnect, getStatus, call, getScenes, getInputs, getLive };
