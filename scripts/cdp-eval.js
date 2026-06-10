// Évalue une expression JS dans la fenêtre principale de NumDeck via CDP.
// Usage : node cdp-eval.js "<expression>"
'use strict';

const expr = process.argv[2] || 'document.title';
const port = '9222';

(async () => {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  if (!page) {
    console.error('fenetre principale introuvable');
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
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    console.log(JSON.stringify(res && res.result ? res.result.value : res, null, 2));
    process.exit(0);
  };

  setTimeout(() => {
    console.error('timeout');
    process.exit(1);
  }, 15000);
})();
