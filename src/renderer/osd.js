'use strict';

const ICONS = {
  on: '<svg viewBox="0 0 24 24"><path d="M12 3v8"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/></svg>',
  off: '<svg viewBox="0 0 24 24"><path d="M12 3v8"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/></svg>',
  preset: '<svg viewBox="0 0 24 24"><path d="M4 7h13M4 12h13M4 17h13"/><path d="M19.5 10l2.5 2-2.5 2"/></svg>',
  key: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M8 15h8"/></svg>',
  error: '<svg viewBox="0 0 24 24"><path d="M12 8v5"/><circle cx="12" cy="16.5" r="0.5"/><circle cx="12" cy="12" r="9"/></svg>',
};

let hideTimer = null;

window.numdeck.on('osd:show', ({ kind, title, subtitle }) => {
  const pill = document.getElementById('pill');
  document.getElementById('icon').innerHTML = ICONS[kind] || ICONS.key;
  document.getElementById('title').textContent = title;
  document.getElementById('subtitle').textContent = subtitle || '';
  pill.className = 'pill kind-' + kind;

  // redéclenche la transition d'entrée
  void pill.offsetWidth;
  pill.classList.add('show');

  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => pill.classList.remove('show'), 1150);
});
