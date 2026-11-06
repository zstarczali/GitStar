// Small DOM / UI helpers shared by the views.

export const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);

// replaceChildren that skips null / false (conditional children)
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...kids) {
  return nativeReplace.apply(this, kids.flat().filter((k) => k != null && k !== false));
};

/** h('div.cls#id', {attrs, on:{click}}, ...children) */
export function h(tag, attrs, ...children) {
  const m = tag.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const p of m[2].match(/[.#][\w-]+/g)) {
      if (p[0] === '.') el.classList.add(p.slice(1)); else el.id = p.slice(1);
    }
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f);
      else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── icons (stroke icons, 24x24 grid) ──
const P = {
  fetch: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  pull: '<path d="M12 3v13"/><path d="m6 10 6 6 6-6"/><circle cx="12" cy="20" r="1.5"/>',
  push: '<path d="M12 21V8"/><path d="m6 14 6-6 6 6"/><path d="M5 4h14"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10"/><path d="M18 9c0 5-12 3-12 8"/>',
  merge: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10"/><path d="M6 7c0 4 6 5 10 5"/>',
  stash: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9"/><path d="M10 13h4"/>',
  pop: '<path d="M12 15V4"/><path d="m8 8 4-4 4 4"/><path d="M4 14v6h16v-6"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  changes: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  compare: '<path d="M8 3v18"/><path d="M16 3v18"/><path d="m4 8 4-4 4 4"/><path d="m12 16 4 4 4-4"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
  cloud: '<path d="M7 18a5 5 0 0 1-.6-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  commit: '<circle cx="12" cy="12" r="4"/><path d="M3 12h5M16 12h5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  unified: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/>',
  wrap: '<path d="M4 6h16"/><path d="M4 12h13a3 3 0 0 1 0 6h-4"/><path d="m14 16-2 2 2 2"/><path d="M4 18h5"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  blame: '<path d="M4 6h16M4 12h10M4 18h13"/><circle cx="19" cy="15" r="2"/>',
  console: '<path d="m4 17 6-5-6-5"/><path d="M12 19h8"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="i ${cls}" viewBox="0 0 24 24">${P[name] || ''}</svg>`;
  return span.firstChild;
}

// ── toast ──
export function toast(msg, kind = 'info', ms) {
  const box = document.getElementById('toasts');
  const t = h('div.toast' + (kind === 'err' ? '.err' : kind === 'ok' ? '.ok' : ''), String(msg));
  box.append(t);
  const life = ms ?? (kind === 'err' ? 9000 : 3500);
  const kill = () => t.remove();
  let timer = setTimeout(kill, life);
  t.addEventListener('mouseenter', () => clearTimeout(timer));
  t.addEventListener('mouseleave', () => (timer = setTimeout(kill, 2000)));
  t.addEventListener('click', kill);
}

// ── modal ──
export function modal({ title, body, buttons, wide, onOpen }) {
  return new Promise((resolve) => {
    const ov = h('div.overlay');
    const close = (v) => { ov.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const foot = h('div.modal-f');
    for (const b of buttons || [{ label: 'OK', value: true, primary: true }]) {
      foot.append(h('button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''), {
        on: { click: () => close(typeof b.value === 'function' ? b.value() : b.value) },
      }, b.label));
    }
    const m = h('div.modal' + (wide ? '.wide' : ''), h('div.modal-h', title), h('div.modal-b', body), foot);
    ov.append(m);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(null); });
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        const prim = (buttons || []).find((b) => b.primary);
        if (prim) { e.preventDefault(); e.stopPropagation(); close(typeof prim.value === 'function' ? prim.value() : prim.value); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    document.body.append(ov);
    const first = m.querySelector('input:not([type=checkbox]),textarea,select');
    if (first) { first.focus(); if (first.select) first.select(); }
    if (onOpen) onOpen(m);
  });
}

export async function confirmDlg(title, text, okLabel = 'OK', danger = false) {
  return !!(await modal({
    title,
    body: h('div.desc', text),
    buttons: [{ label: 'Mégse', value: false }, { label: okLabel, value: true, primary: !danger, danger }],
  }));
}

/**
 * Form dialog. fields: [{name, label, type: text|textarea|checkbox|select|password, value, options, note, placeholder}]
 * Resolves to an object of values or null.
 */
export async function formDlg(title, fields, okLabel = 'OK', desc) {
  const els = {};
  const body = [];
  if (desc) body.push(h('div.desc', desc));
  for (const f of fields) {
    let el;
    if (f.type === 'checkbox') {
      el = h('input', { type: 'checkbox', checked: f.value });
      body.push(h('label.chk', el, f.label));
    } else {
      if (f.type === 'textarea') el = h('textarea.inp', { rows: f.rows || 4, placeholder: f.placeholder || '' });
      else if (f.type === 'select') {
        el = h('select.inp', f.options.map((o) => h('option', { value: o.value ?? o }, o.label ?? o)));
      } else el = h('input.inp', { type: f.type || 'text', placeholder: f.placeholder || '', spellcheck: 'false' });
      el.value = f.value ?? '';
      body.push(h('label.field', h('span', f.label), el, f.note ? h('span.note', f.note) : null));
    }
    els[f.name] = el;
  }
  const collect = () => {
    const o = {};
    for (const f of fields) o[f.name] = f.type === 'checkbox' ? els[f.name].checked : els[f.name].value;
    return o;
  };
  return modal({ title, body, buttons: [{ label: 'Mégse', value: null }, { label: okLabel, value: collect, primary: true }] });
}

// ── context menu ──
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('blur', closeMenu);

/** items: [{label, icon, action, disabled, danger, key} | '-' | {header}] */
export function contextMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  closeMenu();
  const m = h('div.menu');
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(h('div.ms')); continue; }
    if (it.header) { m.append(h('div.mh', it.header)); continue; }
    m.append(h('div.mi' + (it.disabled ? '.dis' : '') + (it.danger ? '.danger' : ''), {
      on: { click: () => { if (it.disabled) return; closeMenu(); it.action(); } },
    }, it.icon ? icon(it.icon) : h('span', { style: { width: '16px' } }), it.label, it.key ? h('span.k', it.key) : null));
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  let x = e.clientX, y = e.clientY;
  if (x + r.width > innerWidth - 4) x = innerWidth - r.width - 4;
  if (y + r.height > innerHeight - 4) y = Math.max(4, innerHeight - r.height - 4);
  m.style.left = x + 'px';
  m.style.top = y + 'px';
  openMenu = m;
}

// ── time / people ──
export function relTime(ts) {
  const d = Date.now() / 1000 - ts;
  if (d < 60) return 'épp most';
  if (d < 3600) return `${Math.floor(d / 60)} perce`;
  if (d < 86400) return `${Math.floor(d / 3600)} órája`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} napja`;
  return fmtDate(ts);
}
export function fmtDate(ts, withTime = false) {
  const dt = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const s = `${dt.getFullYear()}.${p(dt.getMonth() + 1)}.${p(dt.getDate())}.`;
  return withTime ? `${s} ${p(dt.getHours())}:${p(dt.getMinutes())}` : s;
}
export function hashColor(str) {
  let x = 0;
  for (const c of str) x = (x * 31 + c.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(x) % 360} 55% 48%)`;
}
export function avatar(name, email) {
  const ini = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return h('span.avatar', { style: { background: hashColor(email || name) } }, ini);
}

export const short = (hash) => (hash || '').slice(0, 8);
export const basename = (p) => p.replace(/\\/g, '/').split('/').pop();
export const dirname = (p) => { const s = p.replace(/\\/g, '/'); const i = s.lastIndexOf('/'); return i < 0 ? '' : s.slice(0, i + 1); };

// ── splitters ──
export function splitter(el, target, { vertical = true, min = 100, max = 2000, invert = false, key } = {}) {
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const start = vertical ? e.clientX : e.clientY;
    const startSize = vertical ? target.offsetWidth : target.offsetHeight;
    el.classList.add('drag');
    const move = (ev) => {
      const d = (vertical ? ev.clientX : ev.clientY) - start;
      const size = Math.max(min, Math.min(max, startSize + (invert ? -d : d)));
      target.style[vertical ? 'width' : 'height'] = size + 'px';
      target.style.flex = 'none';
    };
    const up = () => {
      el.classList.remove('drag');
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      if (key) localStorage.setItem(key, vertical ? target.style.width : target.style.height);
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  });
  if (key && localStorage.getItem(key)) { target.style[vertical ? 'width' : 'height'] = localStorage.getItem(key); target.style.flex = 'none'; }
}

// ── markdown (small, safe subset) ──
export function markdown(src) {
  const lines = String(src).replace(/\r/g, '').split('\n');
  let out = '';
  let inCode = false, code = '';
  let list = null;
  const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,;:])/g, '$1<i>$2</i>');
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) { out += `<pre><code>${esc(code)}</code></pre>`; code = ''; inCode = false; }
      else { closeList(); inCode = true; }
      continue;
    }
    if (inCode) { code += line + '\n'; continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { closeList(); const n = Math.min(3, m[1].length); out += `<h${n}>${inline(m[2])}</h${n}>`; }
    else if ((m = line.match(/^\s*[-*+]\s+(.*)/))) { if (list !== 'ul') { closeList(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { closeList(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; }
    else if (!line.trim()) { closeList(); }
    else { closeList(); out += `<p>${inline(line)}</p>`; }
  }
  if (inCode) out += `<pre><code>${esc(code)}</code></pre>`;
  closeList();
  return out;
}

/** Splits a command line into arguments (supports "quotes" and 'quotes'). */
export function shellSplit(s) {
  const out = [];
  let cur = '', q = null, has = false;
  for (const ch of s) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") { q = ch; has = true; }
    else if (/\s/.test(ch)) { if (cur || has) { out.push(cur); cur = ''; has = false; } }
    else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
