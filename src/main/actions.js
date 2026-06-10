'use strict';

const { shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

const obs = require('./obs');

// Caractères que SendKeys interprète : il faut les entourer de {}
const SENDKEYS_SPECIALS = new Set(['+', '^', '%', '~', '(', ')', '{', '}', '[', ']']);

const SENDKEYS_NAMED = {
  enter: '{ENTER}', return: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}',
  space: ' ', backspace: '{BS}', delete: '{DEL}', del: '{DEL}', insert: '{INS}', ins: '{INS}',
  home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}',
  up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}', printscreen: '{PRTSC}',
};

const MEDIA_VK = {
  playpause: 0xB3,
  next: 0xB0,
  prev: 0xB1,
  stop: 0xB2,
  volup: 0xAF,
  voldown: 0xAE,
  mute: 0xAD,
};

let deps = {
  playSound: () => {},
  switchPreset: () => {},
  toggleDeck: () => {},
};

function init(d) {
  deps = { ...deps, ...d };
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
      { windowsHide: true }
    );
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `PowerShell a renvoyé le code ${code}`));
    });
  });
}

function escapeForSendKeys(char) {
  return SENDKEYS_SPECIALS.has(char) ? `{${char}}` : char;
}

// "Ctrl+Shift+F5" -> "^+{F5}" (format SendKeys)
function comboToSendKeys(combo) {
  const tokens = combo.split('+').map((t) => t.trim()).filter(Boolean);
  let modifiers = '';
  let key = '';
  for (const token of tokens) {
    const low = token.toLowerCase();
    if (low === 'ctrl' || low === 'control') modifiers += '^';
    else if (low === 'alt') modifiers += '%';
    else if (low === 'shift') modifiers += '+';
    else if (low === 'win' || low === 'windows' || low === 'meta') {
      throw new Error('La touche Windows n\'est pas supportée dans les raccourcis envoyés.');
    } else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(low)) {
      key = `{${low.toUpperCase()}}`;
    } else if (SENDKEYS_NAMED[low]) {
      key = SENDKEYS_NAMED[low];
    } else if (token.length === 1) {
      key = escapeForSendKeys(low);
    } else {
      throw new Error(`Touche inconnue dans le raccourci : "${token}"`);
    }
  }
  if (!key) throw new Error('Le raccourci doit contenir une touche principale (ex : Ctrl+Shift+F5).');
  return modifiers + key;
}

function textToSendKeys(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split('')
    .map((c) => (c === '\n' ? '{ENTER}' : escapeForSendKeys(c)))
    .join('');
}

function sendKeysString(sk) {
  // Échappement pour chaîne PowerShell entre apostrophes
  const psSafe = sk.replace(/'/g, "''");
  return runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${psSafe}')`
  );
}

function sendMediaKey(control) {
  const vk = MEDIA_VK[control];
  if (!vk) throw new Error(`Commande média inconnue : ${control}`);
  const def = 'using System;using System.Runtime.InteropServices;public class NDKey{[DllImport("user32.dll")]public static extern void keybd_event(byte bVk,byte bScan,uint dwFlags,UIntPtr dwExtraInfo);}';
  return runPowerShell(
    `Add-Type -TypeDefinition '${def}'; [NDKey]::keybd_event(${vk},0,1,[UIntPtr]::Zero); [NDKey]::keybd_event(${vk},0,3,[UIntPtr]::Zero)`
  );
}

function openApp(filePath, args) {
  const ext = path.extname(filePath).toLowerCase();
  if (args && args.trim() && ext === '.exe') {
    const child = spawn(filePath, splitArgs(args), {
      detached: true,
      stdio: 'ignore',
      cwd: path.dirname(filePath),
    });
    child.unref();
    return Promise.resolve();
  }
  // .lnk, .exe sans arguments, documents… Windows sait quoi en faire
  return shell.openPath(filePath).then((err) => {
    if (err) throw new Error(err);
  });
}

function splitArgs(str) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(str))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

function runCommand(command) {
  const child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return Promise.resolve();
}

// Exécute une action de bouton. Lève une erreur avec un message lisible en cas d'échec.
async function execute(action) {
  if (!action || !action.type) return;
  const p = action.params || {};
  switch (action.type) {
    case 'app.open':
      if (!p.path) throw new Error('Aucune application sélectionnée.');
      return openApp(p.path, p.args || '');
    case 'url.open':
      if (!p.url) throw new Error('Aucune URL renseignée.');
      return shell.openExternal(/^https?:\/\//i.test(p.url) ? p.url : 'https://' + p.url);
    case 'file.open':
      if (!p.path) throw new Error('Aucun fichier ou dossier sélectionné.');
      return shell.openPath(p.path).then((err) => { if (err) throw new Error(err); });
    case 'cmd.run':
      if (!p.command) throw new Error('Aucune commande renseignée.');
      return runCommand(p.command);
    case 'keys.send':
      if (!p.combo) throw new Error('Aucun raccourci renseigné.');
      return sendKeysString(comboToSendKeys(p.combo));
    case 'text.type':
      if (!p.text) throw new Error('Aucun texte renseigné.');
      return sendKeysString(textToSendKeys(p.text));
    case 'media':
      return sendMediaKey(p.control || 'playpause');
    case 'sound.play':
      if (!p.path) throw new Error('Aucun fichier audio sélectionné.');
      return deps.playSound(p.path, typeof p.volume === 'number' ? p.volume : 1);
    case 'obs.scene':
      if (!p.sceneName) throw new Error('Aucune scène sélectionnée.');
      return obs.call('SetCurrentProgramScene', { sceneName: p.sceneName });
    case 'obs.transition':
      return obs.call('TriggerStudioModeTransition');
    case 'obs.stream.toggle':
      return obs.call('ToggleStream');
    case 'obs.record.toggle':
      return obs.call('ToggleRecord');
    case 'obs.mute':
      if (!p.inputName) throw new Error('Aucune source audio sélectionnée.');
      return obs.call('ToggleInputMute', { inputName: p.inputName });
    case 'preset.switch':
      if (!p.presetId) throw new Error('Aucun preset sélectionné.');
      return deps.switchPreset(p.presetId);
    case 'deck.toggle':
      return deps.toggleDeck();
    default:
      throw new Error(`Type d'action inconnu : ${action.type}`);
  }
}

module.exports = { init, execute };
