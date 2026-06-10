// Capture le rendu de la fenêtre NumDeck via le protocole DevTools (CDP),
// sans interagir avec l'écran. Usage : node cdp-screenshot.js [port] [sortie.png]
'use strict';

const fs = require('fs');

const port = process.argv[2] || '9222';
const out = process.argv[3] || 'cdp-shot.png';

(async () => {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  if (!page) {
    console.error('page introuvable. cibles : ' + targets.map((t) => t.url).join(', '));
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (pending.has(m.id)) {
      const resolve = pending.get(m.id);
      pending.delete(m.id);
      resolve(m.result);
    }
  };

  const send = (method, params) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  ws.onopen = async () => {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (!shot || !shot.data) {
      console.error('capture vide');
      process.exit(1);
    }
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('OK ' + out);
    process.exit(0);
  };
  ws.onerror = () => {
    console.error('connexion websocket impossible');
    process.exit(1);
  };

  setTimeout(() => {
    console.error('timeout');
    process.exit(1);
  }, 15000);
})();
