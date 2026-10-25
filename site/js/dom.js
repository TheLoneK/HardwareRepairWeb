// DOM helpers. All user data goes in as text nodes or properties, never innerHTML
// (the page's Content-Security-Policy enforces Trusted Types, so innerHTML would throw anyway).
import { STATUS_LABELS, maskTail } from './model.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'on') for (const [ev, fn] of Object.entries(value)) el.addEventListener(ev, fn);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (['value', 'checked', 'disabled', 'selected', 'open', 'hidden', 'required', 'maxLength', 'readOnly', 'type'].includes(key)) el[key] = value;
    else if (/^on/i.test(key)) throw new Error('Use the "on" option for event handlers.');
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function mount(root, ...children) {
  root.replaceChildren();
  append(root, children);
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return wrapped;
}

// ---- formatting ----

export function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const hr = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${hr}h`;
  if (hr) return `${hr}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

export function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hr = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${hr}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// "Computer" -> "computer" for mid-sentence use; leaves "3D printer" alone.
export const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// <input type="datetime-local"> works in local time without a zone.
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function statusPill(status) {
  return h('span', { class: `pill s-${status}`, text: STATUS_LABELS[status] ?? status });
}

// ---- toast ----

let toastTimer;
export function toast(message, { error = false } = {}) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = error ? 'toast err' : 'toast';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), error ? 6000 : 3000);
}

// Two-step confirm without a blocking dialog: first click arms, second click acts.
export function confirmButton(label, armedLabel, onConfirm, cls = 'btn btn-danger btn-sm') {
  let armed = false;
  let timer;
  const btn = h('button', {
    type: 'button',
    class: cls,
    text: label,
    on: {
      click: () => {
        if (!armed) {
          armed = true;
          btn.textContent = armedLabel;
          btn.classList.add('armed');
          timer = setTimeout(() => {
            armed = false;
            btn.textContent = label;
            btn.classList.remove('armed');
          }, 4000);
          return;
        }
        clearTimeout(timer);
        onConfirm();
      },
    },
  });
  return btn;
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', {}, label, hint ? h('span', { class: 'field-hint' }, ` ${hint}`) : null), input);
}

export function charCounter(input, max) {
  const el = h('div', { class: 'counter' });
  const update = () => {
    const n = input.value.length;
    el.textContent = `${n} / ${max}`;
    el.className = 'counter' + (n >= max ? ' full' : n >= max * 0.9 ? ' near' : '');
  };
  input.addEventListener('input', update);
  update();
  return el;
}

// ---- private fields (serial number, ticket ref) ----

const SVG_NS = 'http://www.w3.org/2000/svg';
function eyeIcon(open) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const paths = open
    ? ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z']
    : ['M3 3l18 18', 'M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1', 'M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'];
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

// Browsers that support -webkit-text-security (Chrome, Edge, Safari, recent Firefox) hide the
// characters of a normal text box, which keeps password managers from offering to save it.
// Anywhere else the box falls back to type="password".
const cssMask = typeof CSS !== 'undefined' && CSS.supports?.('-webkit-text-security', 'disc');

function setInputHidden(input, hidden) {
  if (cssMask) input.classList.toggle('masked', hidden);
  else input.type = hidden ? 'password' : 'text';
}

function toggleButton(label, onToggle) {
  let shown = false;
  const btn = h('button', { type: 'button', class: 'reveal-btn', 'aria-pressed': 'false', 'aria-label': `Show ${label}`, title: `Show ${label}` }, eyeIcon(true));
  btn.addEventListener('click', () => {
    shown = !shown;
    btn.setAttribute('aria-pressed', String(shown));
    btn.setAttribute('aria-label', `${shown ? 'Hide' : 'Show'} ${label}`);
    btn.title = `${shown ? 'Hide' : 'Show'} ${label}`;
    btn.replaceChildren(eyeIcon(!shown));
    onToggle(shown);
  });
  return btn;
}

// An editable private field, hidden by default, with an eye button to show it.
// Returns { wrap, input }; read and write input.value as usual.
export function secretInput(label, attrs = {}) {
  const input = h('input', {
    ...attrs,
    type: cssMask ? 'text' : 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    'data-1p-ignore': 'true',
    'data-lpignore': 'true',
    'data-form-type': 'other',
  });
  setInputHidden(input, true);
  const wrap = h('div', { class: 'secret-input' }, input, toggleButton(label, (shown) => setInputHidden(input, !shown)));
  return { wrap, input };
}

// A read-only private value: "••••0123" until the eye button is pressed.
export function secretText(label, value) {
  if (!value) return h('span', { class: 'muted', text: '—' });
  const span = h('span', { class: 'mono', text: maskTail(value) });
  return h('span', { class: 'secret-text' }, span, toggleButton(label, (shown) => (span.textContent = shown ? value : maskTail(value))));
}
