'use strict';

const { globalShortcut } = require('electron');

const config = require('./config');
const actions = require('./actions');

// Détection des gestes
const DOUBLE_WINDOW_MS = 300; // délai max entre deux appuis pour un double
const LONG_PRESS_MS = 550;    // durée de maintien pour un appui long
const TOGGLE_DEBOUNCE_MS = 350;

let deckActive = false;
let emit = () => {};
let lastToggleAt = 0;
let numLockOk = true; // mis à jour par main.js (vérification périodique)

// Touches qui dépendent de Verr Num : sans lui, Windows envoie Début/Fin/flèches
// et le blocage par raccourci global ne fonctionne plus
const NUMLOCK_DEPENDENT = new Set(['num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9', 'numdec']);

// --- Hook clavier global (uiohook) : fournit keydown/keyup pour les gestes ---

let hookRunning = false;
let hookKeyForCode = {}; // keycode uiohook -> id de touche NumDeck

function startHook() {
  let uIOhook, UiohookKey;
  try {
    ({ uIOhook, UiohookKey } = require('uiohook-napi'));
  } catch (err) {
    console.error('[gestes] uiohook-napi indisponible, appuis double/long désactivés :', err.message);
    return;
  }

  // Noms possibles selon les versions de la lib
  const WANTED = {
    Numpad0: 'num0', Numpad1: 'num1', Numpad2: 'num2', Numpad3: 'num3', Numpad4: 'num4',
    Numpad5: 'num5', Numpad6: 'num6', Numpad7: 'num7', Numpad8: 'num8', Numpad9: 'num9',
    NumpadDivide: 'numdiv', NumpadMultiply: 'nummult',
    NumpadDecimal: 'numdec', NumpadDot: 'numdec', NumpadDelete: 'numdec',
  };
  for (const [name, keyId] of Object.entries(WANTED)) {
    if (UiohookKey[name] !== undefined && !(UiohookKey[name] in hookKeyForCode)) {
      hookKeyForCode[UiohookKey[name]] = keyId;
    }
  }

  try {
    uIOhook.on('keydown', (e) => {
      if (!deckActive) return;
      const key = hookKeyForCode[e.keycode];
      if (key && (numLockOk || !NUMLOCK_DEPENDENT.has(key))) onHookDown(key);
    });
    uIOhook.on('keyup', (e) => {
      if (!deckActive) return;
      const key = hookKeyForCode[e.keycode];
      if (key && (numLockOk || !NUMLOCK_DEPENDENT.has(key))) onHookUp(key);
    });
    uIOhook.start();
    hookRunning = true;
    module.exports.disposeHook = () => { try { uIOhook.stop(); } catch (_) {} };
  } catch (err) {
    console.error('[gestes] démarrage du hook clavier impossible :', err.message);
    hookRunning = false;
  }
}

function isHookKey(key) {
  return hookRunning && Object.values(hookKeyForCode).includes(key);
}

// --- Machine à états des gestes (une par touche) ---

const keyStates = {};

function stateFor(key) {
  if (!keyStates[key]) {
    keyStates[key] = {
      down: false, longTimer: null, longFired: false,
      doubleTimer: null, awaitingSecond: false, consumed: false,
    };
  }
  return keyStates[key];
}

function bindingsFor(key) {
  const button = config.getActivePreset().buttons[key];
  if (!button) return { button: null, tap: null, double: null, long: null };
  return {
    button,
    tap: button.action || null,
    double: button.actionDouble || null,
    long: button.actionLong || null,
  };
}

function onHookDown(key) {
  const s = stateFor(key);
  const b = bindingsFor(key);

  if (s.awaitingSecond) {
    // Deuxième appui dans la fenêtre : double appui
    clearTimeout(s.doubleTimer);
    s.awaitingSecond = false;
    s.consumed = true;
    s.down = true;
    fire(key, 'double', b);
    return;
  }

  if (s.down) return; // répétition automatique de Windows : ignorer

  s.down = true;
  s.longFired = false;
  s.consumed = false;
  emit('key:pressed', { key, label: b.button ? b.button.label : null, bound: !!(b.tap || b.double || b.long) });

  if (b.long) {
    s.longTimer = setTimeout(() => {
      s.longFired = true;
      fire(key, 'long', b);
    }, LONG_PRESS_MS);
  }
  if (!b.long && !b.double) {
    // Appui simple uniquement : réaction immédiate
    if (b.tap) fire(key, 'tap', b);
  }
}

function onHookUp(key) {
  const s = stateFor(key);
  if (!s.down) return;
  s.down = false;
  clearTimeout(s.longTimer);

  if (s.longFired || s.consumed) {
    s.consumed = false;
    return;
  }

  const b = bindingsFor(key);
  if (b.double) {
    // Attendre un éventuel second appui
    s.awaitingSecond = true;
    s.doubleTimer = setTimeout(() => {
      s.awaitingSecond = false;
      if (b.tap) fire(key, 'tap', b);
    }, DOUBLE_WINDOW_MS);
  } else if (b.long) {
    // Relâché avant le seuil : appui simple
    if (b.tap) fire(key, 'tap', b);
  }
  // sinon : le tap a déjà été déclenché au keydown
}

async function fire(key, gesture, b) {
  const action = gesture === 'double' ? b.double : gesture === 'long' ? b.long : b.tap;
  if (!action) return;
  const label = (b.button && b.button.label) || key;
  emit('action:fired', { key, gesture, label });
  try {
    await actions.execute(action);
  } catch (err) {
    console.error(`[actions] échec "${label}" (${gesture}) :`, err.message);
    emit('action:error', { key, label, message: err.message });
  }
}

// --- Capture des touches (blocage système via raccourcis globaux) ---

function init(opts) {
  emit = opts.emit;
  startHook();
  registerToggle();
  if (config.get().settings.deckActiveOnStart) {
    setDeckActive(true, { silent: true });
  }
}

function registerToggle() {
  const ok = globalShortcut.register(config.TOGGLE_KEY, () => {
    const now = Date.now();
    if (now - lastToggleAt < TOGGLE_DEBOUNCE_MS) return; // anti-rebond (maintien de +)
    lastToggleAt = now;
    setDeckActive(!deckActive);
  });
  if (!ok) {
    console.error('[shortcuts] impossible de capturer la touche + du pavé numérique (déjà utilisée par une autre application ?)');
  }
}

function registerDeckKeys() {
  for (const key of config.BINDABLE_KEYS) {
    const ok = globalShortcut.register(key, () => handleShortcutPress(key));
    if (!ok) console.error(`[shortcuts] capture impossible : ${key}`);
  }
  globalShortcut.register(config.PRESET_CYCLE_KEY, () => {
    const preset = config.cyclePreset();
    emit('preset:changed', { presetId: preset.id, name: preset.name });
  });
}

function unregisterDeckKeys() {
  for (const key of config.BINDABLE_KEYS) {
    globalShortcut.unregister(key);
  }
  globalShortcut.unregister(config.PRESET_CYCLE_KEY);
}

// Appelé par le raccourci global (qui bloque la touche pour les autres apps).
// Si le hook gère cette touche, il pilote les gestes : ne rien faire ici.
async function handleShortcutPress(key) {
  if (isHookKey(key)) return;
  const s = stateFor(key);
  if (s.down) return;
  const b = bindingsFor(key);
  emit('key:pressed', { key, label: b.button ? b.button.label : null, bound: !!b.tap });
  if (b.tap) fire(key, 'tap', b);
}

function setDeckActive(active, opts = {}) {
  if (deckActive === active) return;
  deckActive = active;
  if (active) registerDeckKeys();
  else unregisterDeckKeys();
  // réinitialiser les machines à états
  for (const key of Object.keys(keyStates)) {
    clearTimeout(keyStates[key].longTimer);
    clearTimeout(keyStates[key].doubleTimer);
    delete keyStates[key];
  }
  emit('deck:changed', { active, silent: !!opts.silent });
}

function isDeckActive() {
  return deckActive;
}

function setNumLockState(ok) {
  numLockOk = ok;
}

function isHookAvailable() {
  return hookRunning;
}

function refresh() {
  if (deckActive) {
    unregisterDeckKeys();
    registerDeckKeys();
  }
}

function dispose() {
  globalShortcut.unregisterAll();
  if (module.exports.disposeHook) module.exports.disposeHook();
}

module.exports = {
  init,
  setDeckActive,
  isDeckActive,
  setNumLockState,
  isHookAvailable,
  refresh,
  dispose,
  disposeHook: null,
};
