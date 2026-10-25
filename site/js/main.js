// App shell: loads the checklists, hash router, nav. No accounts and no server: every page
// runs in the browser, and the only requests are for this site's own files.
import { h, mount } from './dom.js';
import { loadCatalog, state } from './state.js';
import { renderHome } from './views/home.js';
import { renderRepair } from './views/repair.js';
import { renderViewer } from './views/viewer.js';

const app = document.getElementById('app');

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  return raw.split('?')[0].split('/').filter(Boolean);
}

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function setNav(active) {
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

let routeToken = 0;
async function route() {
  const token = ++routeToken;
  state.cleanup?.();
  state.cleanup = null;
  const parts = parseHash();
  const name = parts[0] || 'repairs';
  const ctx = { navigate, isCurrent: () => token === routeToken };
  try {
    switch (name) {
      case 'repairs':
        setNav('repairs');
        return parts[1] ? renderRepair(app, parts[1], ctx) : await renderHome(app, ctx);
      case 'view':
        setNav('view');
        return renderViewer(app, ctx);
      default:
        setNav(null);
        mount(app, h('div', { class: 'empty' }, 'Page not found. ', h('a', { href: '#/' }, 'Go to repairs')));
    }
  } catch (err) {
    if (token !== routeToken) return;
    console.error(err);
    mount(app, h('div', { class: 'card stack' }, h('h2', { text: 'Something went wrong' }), h('p', { class: 'error-text', text: err.message }), h('a', { class: 'btn', href: '#/' }, 'Back to repairs')));
  }
}

window.addEventListener('hashchange', route);

(async function start() {
  try {
    await loadCatalog();
  } catch (err) {
    mount(app, h('div', { class: 'card stack' }, h('h2', { text: 'Couldn’t load the checklists' }), h('p', { class: 'error-text', text: err.message }), h('p', { class: 'muted', text: 'Check your connection and reload the page.' })));
    return;
  }
  route();
})();
