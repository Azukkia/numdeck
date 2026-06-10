'use strict';

// Mock de l'API preload — uniquement pour prévisualiser l'interface dans un
// navigateur classique (développement). Dans Electron, window.numdeck existe
// déjà et ce fichier ne fait rien.

if (!window.numdeck) {
  const svgIcon = (emoji, from, to) =>
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
        </linearGradient></defs>
        <rect width="96" height="96" fill="url(#g)"/>
        <text x="48" y="60" font-size="40" text-anchor="middle">${emoji}</text>
      </svg>`
    );

  const buttons = {
    num7: { label: 'Scène Jeu', icon: svgIcon('🎮', '#312e81', '#1e1b4b'), color: '#7c5cff', action: { type: 'obs.scene', params: { sceneName: 'Jeu' } } },
    num8: { label: 'Scène Cam', icon: svgIcon('📷', '#164e63', '#0c2431'), color: '#22d3ee', action: { type: 'obs.scene', params: { sceneName: 'Caméra' } } },
    num9: { label: 'BRB', icon: svgIcon('⏸', '#3f1d2b', '#27121c'), color: '#f472b6', action: { type: 'obs.scene', params: { sceneName: 'Pause' } } },
    num4: { label: 'Micro', icon: svgIcon('🎙', '#14342b', '#0c2018'), color: '#34d399', action: { type: 'obs.mute', params: { inputName: 'Micro' } } },
    num5: { label: 'REC', icon: svgIcon('⏺', '#450a0a', '#27090b'), color: '#f87171', action: { type: 'obs.record.toggle', params: {} } },
    num6: { label: 'Spotify', icon: svgIcon('🎵', '#052e16', '#03180c'), color: '#34d399', action: { type: 'media', params: { control: 'playpause' } } },
    num1: { label: 'Discord', icon: svgIcon('💬', '#1e1b4b', '#11103a'), color: '#60a5fa', action: { type: 'app.open', params: { path: 'C:/Discord.exe' } }, actionDouble: { type: 'url.open', params: { url: 'https://discord.com' } }, actionLong: { type: 'cmd.run', params: { command: 'taskkill /im discord.exe' } } },
    num2: { label: 'Twitch', icon: svgIcon('📺', '#2e1065', '#190a36'), color: '#7c5cff', action: { type: 'url.open', params: { url: 'https://twitch.tv' } } },
    num3: { label: '', icon: null, color: '#22d3ee', action: null, display: { type: 'clock' } },
    num0: { label: 'Hymne de la victoire', icon: svgIcon('🏆', '#422006', '#291504'), color: '#fbbf24', action: { type: 'sound.play', params: { path: 'C:/victory.mp3', volume: 0.8 } } },
    numdec: { label: '', icon: null, color: '#f87171', action: null, display: { type: 'obs' } },
    numdiv: null,
    nummult: { label: 'Clip ça !', icon: null, color: '#f472b6', action: { type: 'keys.send', params: { combo: 'Alt+F10' } } },
  };

  const config = {
    activePresetId: 'preset-1',
    presets: [
      { id: 'preset-1', name: 'Stream', buttons },
      { id: 'preset-2', name: 'Musique', buttons: Object.fromEntries(Object.keys(buttons).map((k) => [k, null])) },
      { id: 'preset-3', name: 'Travail', buttons: Object.fromEntries(Object.keys(buttons).map((k) => [k, null])) },
    ],
    settings: {
      obs: { host: '127.0.0.1', port: 4455, password: '' },
      launchAtStartup: false,
      startMinimized: false,
      osdEnabled: true,
      deckActiveOnStart: false,
      overlay: { enabled: true, locked: false, x: null, y: null },
    },
  };

  const mockTicker = () => ({
    time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    date: new Date().toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }),
    cpu: 12 + Math.floor(Math.random() * 30),
    ram: 47,
    obs: { streaming: false, recording: true },
  });

  let deckActive = true;
  const listeners = {};
  const fire = (channel, payload) => (listeners[channel] || []).forEach((cb) => cb(payload));

  window.numdeck = {
    getState: async () => ({ config, deckActive, obsStatus: 'connected', hookAvailable: true, ticker: mockTicker(), version: '1.1.0 (aperçu)' }),
    overlaySet: async (patch) => {
      config.settings.overlay = { ...config.settings.overlay, ...patch };
      fire('overlay:state', { enabled: !!config.settings.overlay.enabled, locked: !!config.settings.overlay.locked });
      return config.settings.overlay;
    },
    saveConfig: async (c) => c,
    activatePreset: async (id) => {
      config.activePresetId = id;
      const preset = config.presets.find((p) => p.id === id);
      fire('preset:changed', { presetId: id, name: preset.name });
      return id;
    },
    toggleDeck: async () => {
      deckActive = !deckActive;
      fire('deck:changed', { active: deckActive });
      return deckActive;
    },
    testAction: async () => ({ ok: true }),
    obsReconnect: async () => 'connected',
    obsStatus: async () => 'connected',
    obsScenes: async () => ({ ok: true, items: ['Jeu', 'Caméra', 'Pause', 'Fin de stream'] }),
    obsInputs: async () => ({ ok: true, items: ['Micro', 'Audio du bureau'] }),
    pick: async () => null,
    pickFolder: async () => null,
    importIcon: async (p) => p,
    setStartup: async (v) => v,
    windowControl: () => {},
    updateCheck: async () => {
      // démo : simule une mise à jour disponible
      setTimeout(() => fire('update:available', { version: '9.9.9', notes: '' }), 600);
    },
    updateDownload: () => {
      let pct = 0;
      const t = setInterval(() => {
        pct += 18;
        if (pct >= 100) {
          clearInterval(t);
          fire('update:ready', { version: '9.9.9' });
        } else {
          fire('update:progress', { percent: pct });
        }
      }, 400);
    },
    updateInstall: () => {},
    toFileURL: (p) => p,
    pathForFile: () => null,
    on: (channel, cb) => {
      (listeners[channel] = listeners[channel] || []).push(cb);
      return () => {};
    },
  };

  // petite démo : appui aléatoire toutes les 3 s + ticker chaque seconde
  setInterval(() => {
    const keys = ['num7', 'num8', 'num5', 'num2'];
    fire('key:pressed', { key: keys[Math.floor(Math.random() * keys.length)], bound: true });
  }, 3000);
  setInterval(() => fire('ticker:data', mockTicker()), 1000);
}
