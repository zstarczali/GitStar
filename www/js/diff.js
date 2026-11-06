// Visual diff viewer: unified / side-by-side, word-level highlights,
// hunk + line staging, minimap, image diff, conflict view, blame.

import { h, icon, esc, toast, hashColor, fmtDate, short } from './util.js';

const IMG_EXT = /\.(png|jpe?g|gif|bmp|webp|ico|avif)$/i;
const MAX_ROWS = 60000;

// ───────────────────────── parsing ─────────────────────────

export function parseDiff(text) {
  const files = [];
  let f = null, hk = null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    if (line.startsWith('diff --git ') || (line.startsWith('diff ') && !hk && !f)) {
      f = { header: [line], hunks: [], oldPath: null, newPath: null, binary: false };
      files.push(f);
      hk = null;
      continue;
    }
    if (!f) { f = { header: [], hunks: [], binary: false }; files.push(f); }
    if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (!m) continue;
      hk = { header: line, oldStart: +m[1], oldCount: m[2] == null ? 1 : +m[2], newStart: +m[3], newCount: m[4] == null ? 1 : +m[4], section: m[5].trim(), lines: [] };
      f.hunks.push(hk);
      let o = hk.oldStart, n = hk.newStart;
      hk._o = o; hk._n = n;
      continue;
    }
    if (!hk) {
      f.header.push(line);
      if (line.startsWith('--- ')) f.oldPath = line.slice(4).replace(/^a\//, '');
      if (line.startsWith('+++ ')) f.newPath = line.slice(4).replace(/^b\//, '');
      if (line.startsWith('Binary files') || line === 'GIT binary patch') f.binary = true;
      continue;
    }
    const t = line[0] || ' ';
    const s = line.slice(1);
    if (t === '\\') { hk.lines.push({ t, s, o: null, n: null }); continue; }
    if (t === '+') hk.lines.push({ t, s, o: null, n: hk._n++ });
    else if (t === '-') hk.lines.push({ t, s, o: hk._o++, n: null });
    else { hk.lines.push({ t: ' ', s, o: hk._o++, n: hk._n++ }); }
  }
  return files;
}

/**
 * Builds a patch for `git apply` from a hunk, keeping only the selected lines.
 * reverse=true builds a patch meant for `git apply --reverse`.
 */
export function buildPatch(file, hunk, selected, reverse) {
  const out = [];
  let oldCount = 0, newCount = 0, keptPrev = false, changed = false;
  for (let i = 0; i < hunk.lines.length; i++) {
    const l = hunk.lines[i];
    const sel = !selected || selected.has(i);
    if (l.t === '\\') { if (keptPrev) out.push('\\' + l.s); continue; }
    if (l.t === ' ') { out.push(' ' + l.s); oldCount++; newCount++; keptPrev = true; continue; }
    if (sel) {
      out.push(l.t + l.s);
      if (l.t === '-') oldCount++; else newCount++;
      keptPrev = true; changed = true;
      continue;
    }
    // unselected change line
    if ((l.t === '-' && !reverse) || (l.t === '+' && reverse)) {
      out.push(' ' + l.s); oldCount++; newCount++; keptPrev = true;
    } else keptPrev = false;
  }
  if (!changed) return null;
  const hh = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;
  return file.header.join('\n') + '\n' + hh + '\n' + out.join('\n') + '\n';
}

// ───────────────────────── word diff ─────────────────────────

const TOK = /\w+|\s+|[^\w\s]/g;

function wordDiff(a, b) {
  const ta = a.match(TOK) || [], tb = b.match(TOK) || [];
  if (ta.length * tb.length > 250000) return null;
  const n = ta.length, m = tb.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ra = [], rb = [];
  let i = 0, j = 0, same = 0;
  while (i < n && j < m) {
    if (ta[i] === tb[j]) { ra.push([ta[i], 0]); rb.push([tb[j], 0]); same += ta[i].length; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ra.push([ta[i], 1]); i++; }
    else { rb.push([tb[j], 1]); j++; }
  }
  while (i < n) ra.push([ta[i++], 1]);
  while (j < m) rb.push([tb[j++], 1]);
  const total = Math.max(a.length, b.length) || 1;
  if (same / total < 0.35) return null; // too different: whole-line highlight reads better
  return [ra, rb];
}

function renderTokens(tokens, tag) {
  let out = '', buf = '', mark = false;
  const flush = () => { if (!buf) return; out += mark ? `<${tag}>${esc(buf)}</${tag}>` : esc(buf); buf = ''; };
  for (const [s, m] of tokens) {
    if (!!m !== mark) { flush(); mark = !!m; }
    buf += s;
  }
  flush();
  return out;
}

/** Pairs '-' runs with the following '+' runs; returns map lineIdx -> html. */
function intraLine(hunk) {
  const res = new Map();
  const L = hunk.lines;
  let i = 0;
  while (i < L.length) {
    if (L[i].t !== '-') { i++; continue; }
    const ds = i; while (i < L.length && (L[i].t === '-' || L[i].t === '\\')) i++;
    const as = i; while (i < L.length && (L[i].t === '+' || L[i].t === '\\')) i++;
    const dels = []; for (let k = ds; k < as; k++) if (L[k].t === '-') dels.push(k);
    const adds = []; for (let k = as; k < i; k++) if (L[k].t === '+') adds.push(k);
    const n = Math.min(dels.length, adds.length);
    for (let k = 0; k < n; k++) {
      const wd = wordDiff(L[dels[k]].s, L[adds[k]].s);
      if (wd) { res.set(dels[k], renderTokens(wd[0], 'del')); res.set(adds[k], renderTokens(wd[1], 'ins')); }
    }
  }
  return res;
}

// ───────────────────────── viewer ─────────────────────────

export class DiffView {
  /**
   * prefs: {mode, context, ignoreWs, wrap}; onPrefs(prefs) persists them.
   */
  constructor(prefs, onPrefs) {
    this.prefs = prefs;
    this.onPrefs = onPrefs;
    this.el = h('div.diff-wrap');
    this.opts = null;
    this.sel = new Set(); // "hunk:line"
    this.lastClick = null;
    this.clear();
  }

  clear(msg = 'Válassz ki egy fájlt a diff megjelenítéséhez') {
    this.opts = null;
    this.el.replaceChildren(h('div.empty', icon('file'), msg));
  }

  /**
   * opts: {
   *   path, oldPath, status,
   *   load(context, ignoreWs) -> Promise<{text, binary}>,
   *   actions: 'stage' | 'unstage' | null,
   *   apply(patch, {cached, reverse}) -> Promise   (hunk/line staging)
   *   image: {old: () => Promise<b64|null>, new: () => Promise<b64|null>},
   *   extra: [Node] toolbar extras, onAi(text)
   *   conflict: bool
   * }
   */
  async show(opts) {
    this.opts = opts;
    this.sel.clear();
    this.token = Symbol();
    const tok = this.token;
    this.el.replaceChildren(this.toolbar(null), h('div.diff-body', h('div.diff-msg', 'Betöltés…')));
    let res;
    try {
      res = await opts.load(this.prefs.context, this.prefs.ignoreWs);
    } catch (e) {
      if (tok !== this.token) return;
      this.el.replaceChildren(this.toolbar(null), h('div.diff-body', h('div.diff-msg', String(e))));
      return;
    }
    if (tok !== this.token) return;
    this.result = res;
    this.render();
  }

  reload() { if (this.opts) this.show(this.opts); }

  setPref(k, v) {
    this.prefs[k] = v;
    this.onPrefs && this.onPrefs(this.prefs);
    if (k === 'context' || k === 'ignoreWs') this.reload();
    else this.render();
  }

  toolbar(file) {
    const o = this.opts || {};
    const p = this.prefs;
    let adds = 0, dels = 0;
    if (file) for (const hk of file.hunks) for (const l of hk.lines) { if (l.t === '+') adds++; else if (l.t === '-') dels++; }
    const ctxSel = h('select.inp', { style: { width: 'auto', padding: '1px 4px', fontSize: '12px' }, title: 'Kontextus sorok',
      on: { change: (e) => this.setPref('context', +e.target.value) } },
      [[3, '3 sor'], [10, '10 sor'], [25, '25 sor'], [100000, 'Teljes fájl']].map(([v, l]) => h('option', { value: v }, l)));
    ctxSel.value = String(p.context);
    return h('div.diff-toolbar',
      h('span.path', o.oldPath && o.oldPath !== o.path ? [h('span.old', o.oldPath + ' → ')] : null, o.path || ''),
      file ? h('span', h('span.stat-a', `+${adds}`), ' ', h('span.stat-d', `−${dels}`)) : null,
      h('span.grow'),
      ...(o.extra || []),
      o.onAi && this.result && !this.result.binary ? h('button.btn.sm.ai', { title: 'A diff elemzése AI-jal', on: { click: () => o.onAi(this.result.text) } }, icon('sparkle'), 'AI') : null,
      file && !o.conflict ? [
        h('button.icon-btn', { title: 'Előző változás (Alt+↑)', on: { click: () => this.jump(-1) } }, icon('up')),
        h('button.icon-btn', { title: 'Következő változás (Alt+↓)', on: { click: () => this.jump(1) } }, icon('down')),
      ] : null,
      !o.conflict ? ctxSel : null,
      !o.conflict ? h('label.chk', { title: 'Whitespace változások figyelmen kívül hagyása' },
        h('input', { type: 'checkbox', checked: p.ignoreWs, on: { change: (e) => this.setPref('ignoreWs', e.target.checked) } }), 'WS') : null,
      h('button.icon-btn' + (p.wrap ? '.on' : ''), { title: 'Sortörés', on: { click: () => this.setPref('wrap', !p.wrap) } }, icon('wrap')),
      !o.conflict ? h('span.seg',
        h('button' + (p.mode === 'unified' ? '.on' : ''), { title: 'Egyesített nézet', on: { click: () => this.setPref('mode', 'unified') } }, 'Egyesített'),
        h('button' + (p.mode === 'split' ? '.on' : ''), { title: 'Egymás melletti nézet', on: { click: () => this.setPref('mode', 'split') } }, 'Osztott')) : null,
    );
  }

  render() {
    const o = this.opts;
    const res = this.result;
    if (!o || !res) return;
    if (o.conflict) return this.renderConflict(res.text);
    const files = parseDiff(res.text);
    const file = files[0];
    if (res.binary || (file && file.binary)) {
      if (IMG_EXT.test(o.path) && o.image) return this.renderImage();
      this.el.replaceChildren(this.toolbar(null), h('div.diff-body', h('div.diff-msg', 'Bináris fájl – nincs szöveges diff.')));
      return;
    }
    if (!file || !file.hunks.length) {
      const meta = file ? file.header.filter((l) => /^(old|new|deleted|similarity|rename|copy) /.test(l)).join('\n') : '';
      this.el.replaceChildren(this.toolbar(file), h('div.diff-body', h('div.diff-msg', meta || (this.prefs.ignoreWs ? 'Csak whitespace változás.' : 'Nincs tartalmi változás.'))));
      return;
    }
    this.file = file;
    const scroll = h('div.diff-scroll');
    const mini = h('div.minimap');
    const body = h('div.diff-body', scroll, mini);
    this.el.replaceChildren(this.toolbar(file), body);
    const { html, marks, rowCount } = this.prefs.mode === 'split' ? this.htmlSplit(file) : this.htmlUnified(file);
    scroll.innerHTML = `<div class="diff ${this.prefs.wrap ? 'wrap' : ''}">${html}</div>`;
    this.scrollEl = scroll;
    this.bindRows(scroll);
    this.renderMinimap(mini, scroll, marks, rowCount);
    this.updateSelBar();
  }

  hunkButtons(hi) {
    const a = this.opts.actions;
    if (!a || !this.opts.apply) return '';
    if (a === 'stage')
      return `<button class="btn sm" data-act="stage" data-h="${hi}">Stage hunk</button><button class="btn sm" data-act="discard" data-h="${hi}">Elvetés</button>`;
    if (a === 'unstage') return `<button class="btn sm" data-act="unstage" data-h="${hi}">Unstage hunk</button>`;
    return '';
  }

  htmlUnified(file) {
    const rows = [];
    const marks = [];
    let count = 0;
    file.hunks.forEach((hk, hi) => {
      const intra = intraLine(hk);
      rows.push(`<tr class="hunk"><td colspan="4"><div class="hh"><span class="t">${esc(hk.header)}</span>${this.hunkButtons(hi)}</div></td></tr>`);
      count++;
      hk.lines.forEach((l, li) => {
        if (count > MAX_ROWS) return;
        if (l.t === '\\') { rows.push(`<tr><td class="ln"></td><td class="ln"></td><td class="mk"></td><td class="code noeol">${esc(l.s.trim())}</td></tr>`); count++; return; }
        const cls = l.t === '+' ? 'add' : l.t === '-' ? 'del' : '';
        if (cls) marks.push([count, cls === 'add' ? 'a' : 'd']);
        const code = intra.get(li) ?? esc(l.s);
        const sel = this.sel.has(`${hi}:${li}`) ? ' lsel' : '';
        rows.push(`<tr class="${cls}${sel}" data-h="${hi}" data-l="${li}"><td class="ln">${l.o ?? ''}</td><td class="ln">${l.n ?? ''}</td><td class="mk">${l.t === ' ' ? '' : l.t === '-' ? '−' : '+'}</td><td class="code">${code || ' '}</td></tr>`);
        count++;
      });
    });
    const cut = count > MAX_ROWS ? `<div class="diff-msg">A diff túl nagy, csak az első ${MAX_ROWS} sor látszik.</div>` : '';
    return { html: `<table><colgroup><col style="width:50px"><col style="width:50px"><col style="width:16px"><col></colgroup>${rows.join('')}</table>${cut}`, marks, rowCount: count };
  }

  htmlSplit(file) {
    const rows = [];
    const marks = [];
    let count = 0;
    const side = (l, hi, li, intra, kind) => {
      if (!l) return `<td class="ln emp"></td><td class="code emp"></td>`;
      const code = intra.get(li) ?? esc(l.s);
      const sel = this.sel.has(`${hi}:${li}`) ? ' lsel' : '';
      const num = kind === 'del' ? l.o : kind === 'add' ? l.n : (kind === 'L' ? l.o : l.n);
      const c = kind === 'add' || kind === 'del' ? kind : '';
      return `<td class="ln ${c}${sel}" data-h="${hi}" data-l="${li}">${num ?? ''}</td><td class="code ${c}">${code || ' '}</td>`;
    };
    file.hunks.forEach((hk, hi) => {
      const intra = intraLine(hk);
      rows.push(`<tr class="hunk"><td colspan="5"><div class="hh"><span class="t">${esc(hk.header)}</span>${this.hunkButtons(hi)}</div></td></tr>`);
      count++;
      const L = hk.lines;
      let i = 0;
      while (i < L.length && count <= MAX_ROWS) {
        const l = L[i];
        if (l.t === ' ') {
          rows.push(`<tr>${side(l, hi, i, intra, 'L')}<td class="sep"></td>${side(l, hi, i, intra, 'R')}</tr>`);
          count++; i++; continue;
        }
        if (l.t === '\\') { i++; continue; }
        const dels = [], adds = [];
        while (i < L.length && (L[i].t === '-' || (L[i].t === '\\' && !adds.length))) { if (L[i].t === '-') dels.push(i); i++; }
        while (i < L.length && (L[i].t === '+' || L[i].t === '\\')) { if (L[i].t === '+') adds.push(i); i++; }
        const n = Math.max(dels.length, adds.length);
        for (let k = 0; k < n; k++) {
          const d = dels[k], a = adds[k];
          const kind = d != null && a != null ? 'm' : d != null ? 'd' : 'a';
          marks.push([count, kind === 'a' ? 'a' : kind === 'd' ? 'd' : 'm']);
          rows.push(`<tr class="chg">${d != null ? side(L[d], hi, d, intra, 'del') : side(null)}<td class="sep"></td>${a != null ? side(L[a], hi, a, intra, 'add') : side(null)}</tr>`);
          count++;
        }
      }
    });
    const cut = count > MAX_ROWS ? `<div class="diff-msg">A diff túl nagy, csak az első ${MAX_ROWS} sor látszik.</div>` : '';
    return { html: `<table class="split"><colgroup><col style="width:50px"><col><col style="width:1px"><col style="width:50px"><col></colgroup>${rows.join('')}</table>${cut}`, marks, rowCount: count };
  }

  bindRows(scroll) {
    scroll.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (btn) return this.hunkAction(btn.dataset.act, +btn.dataset.h, null);
      const ln = e.target.closest('td.ln');
      if (!ln || !this.opts.actions) return;
      const holder = ln.dataset.h != null ? ln : ln.parentElement;
      if (holder.dataset.h == null) return;
      const hi = +holder.dataset.h, li = +holder.dataset.l;
      const line = this.file.hunks[hi].lines[li];
      if (!line || line.t === ' ' || line.t === '\\') return;
      const key = `${hi}:${li}`;
      if (e.shiftKey && this.lastClick && this.lastClick[0] === hi) {
        const [a, b] = [Math.min(this.lastClick[1], li), Math.max(this.lastClick[1], li)];
        for (let k = a; k <= b; k++) { const t = this.file.hunks[hi].lines[k].t; if (t === '+' || t === '-') this.sel.add(`${hi}:${k}`); }
      } else if (this.sel.has(key)) this.sel.delete(key);
      else this.sel.add(key);
      this.lastClick = [hi, li];
      this.refreshSelection(scroll);
    });
  }

  refreshSelection(scroll) {
    scroll.querySelectorAll('[data-h][data-l]').forEach((el) => {
      el.classList.toggle('lsel', this.sel.has(`${el.dataset.h}:${el.dataset.l}`));
    });
    this.updateSelBar();
  }

  updateSelBar() {
    const body = this.el.querySelector('.diff-body');
    if (!body) return;
    body.querySelector('.sel-bar')?.remove();
    if (!this.sel.size || !this.opts.actions) return;
    const a = this.opts.actions;
    body.append(h('div.sel-bar', `${this.sel.size} sor kijelölve`,
      a === 'stage' ? h('button.btn.sm.primary', { on: { click: () => this.lineAction('stage') } }, 'Sorok stage-elése') : null,
      a === 'stage' ? h('button.btn.sm', { on: { click: () => this.lineAction('discard') } }, 'Sorok elvetése') : null,
      a === 'unstage' ? h('button.btn.sm.primary', { on: { click: () => this.lineAction('unstage') } }, 'Sorok unstage-elése') : null,
      h('button.btn.sm.ghost', { on: { click: () => { this.sel.clear(); this.refreshSelection(this.scrollEl); } } }, 'Mégse')));
  }

  async hunkAction(act, hi, selected) {
    const hk = this.file.hunks[hi];
    const reverse = act !== 'stage';
    const patch = buildPatch(this.file, hk, selected, reverse);
    if (!patch) return;
    try {
      await this.opts.apply(patch, { act, cached: act !== 'discard', reverse });
    } catch (e) {
      toast(e, 'err');
    }
  }

  async lineAction(act) {
    const byHunk = new Map();
    for (const k of this.sel) {
      const [hi, li] = k.split(':').map(Number);
      if (!byHunk.has(hi)) byHunk.set(hi, new Set());
      byHunk.get(hi).add(li);
    }
    // apply bottom-up so the earlier hunks' line numbers stay valid
    const his = [...byHunk.keys()].sort((a, b) => b - a);
    const reverse = act !== 'stage';
    const parts = his.map((hi) => buildPatch(this.file, this.file.hunks[hi], byHunk.get(hi), reverse)).filter(Boolean);
    if (!parts.length) return;
    // one patch with all hunks (header once)
    const header = this.file.header.join('\n') + '\n';
    const body = his
      .slice()
      .reverse()
      .map((hi) => buildPatch(this.file, this.file.hunks[hi], byHunk.get(hi), reverse))
      .filter(Boolean)
      .map((p) => p.slice(header.length))
      .join('');
    this.sel.clear();
    try {
      await this.opts.apply(header + body, { act, cached: act !== 'discard', reverse });
    } catch (e) {
      toast(e, 'err');
    }
  }

  renderMinimap(mini, scroll, marks, rowCount) {
    if (!rowCount) return;
    const frag = document.createDocumentFragment();
    let prev = null;
    for (const [row, k] of marks) {
      if (prev && prev.k === k && prev.end === row) { prev.end = row + 1; continue; }
      prev = { start: row, end: row + 1, k };
      frag.append(prev.el = h('i.' + k));
      prev.el._r = prev;
    }
    mini.append(frag);
    for (const i of mini.querySelectorAll('i')) {
      i.style.top = (i._r.start / rowCount) * 100 + '%';
      i.style.height = Math.max(0.3, ((i._r.end - i._r.start) / rowCount) * 100) + '%';
    }
    const vp = h('div.vp');
    mini.append(vp);
    // marks cover only the part of the bar that the content fills
    requestAnimationFrame(() => {
      const ratio = Math.min(1, (scroll.firstElementChild?.offsetHeight || 0) / Math.max(1, scroll.clientHeight));
      for (const i of mini.querySelectorAll('i')) {
        i.style.top = (i._r.start / rowCount) * ratio * 100 + '%';
        i.style.height = Math.max(0.3, ((i._r.end - i._r.start) / rowCount) * ratio * 100) + '%';
      }
    });
    const upd = () => {
      const t = scroll.scrollTop / scroll.scrollHeight, v = scroll.clientHeight / scroll.scrollHeight;
      vp.style.top = t * 100 + '%';
      vp.style.height = Math.min(100, v * 100) + '%';
    };
    scroll.addEventListener('scroll', upd, { passive: true });
    requestAnimationFrame(upd);
    const go = (e) => {
      const r = mini.getBoundingClientRect();
      scroll.scrollTop = ((e.clientY - r.top) / r.height) * scroll.scrollHeight - scroll.clientHeight / 2;
    };
    mini.addEventListener('mousedown', (e) => {
      go(e);
      const mv = (ev) => go(ev);
      const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
      addEventListener('mousemove', mv);
      addEventListener('mouseup', up);
    });
  }

  jump(dir) {
    const sc = this.scrollEl;
    if (!sc) return;
    const rows = [...sc.querySelectorAll('tr')];
    const starts = [];
    let prevChg = false;
    for (const r of rows) {
      const chg = r.classList.contains('add') || r.classList.contains('del') || r.classList.contains('chg');
      if (chg && !prevChg) starts.push(r);
      prevChg = chg;
    }
    const top = sc.scrollTop + 40;
    const target = dir > 0 ? starts.find((r) => r.offsetTop > top + 2) : [...starts].reverse().find((r) => r.offsetTop < top - 2);
    if (target) sc.scrollTop = target.offsetTop - 40;
  }

  async renderImage() {
    const o = this.opts;
    const [a, b] = await Promise.all([o.image.old().catch(() => null), o.image.new().catch(() => null)]);
    const mime = (p) => (/\.svg$/i.test(p) ? 'image/svg+xml' : /\.png$/i.test(p) ? 'image/png' : /\.gif$/i.test(p) ? 'image/gif' : /\.webp$/i.test(p) ? 'image/webp' : /\.ico$/i.test(p) ? 'image/x-icon' : /\.bmp$/i.test(p) ? 'image/bmp' : 'image/jpeg');
    const src = (d, p) => (d ? `data:${mime(p)};base64,${d}` : null);
    const sa = src(a, o.oldPath || o.path), sb = src(b, o.path);
    const box = h('div.img-diff');
    const sides = () => h('div.sides',
      h('figure.o', sa ? h('img', { src: sa, on: { load: (e) => (e.target.nextSibling.textContent = `Régi – ${e.target.naturalWidth}×${e.target.naturalHeight} · ${kb(a)}`) } }) : h('div.diff-msg', 'nincs'), h('figcaption', 'Régi')),
      h('figure.n', sb ? h('img', { src: sb, on: { load: (e) => (e.target.nextSibling.textContent = `Új – ${e.target.naturalWidth}×${e.target.naturalHeight} · ${kb(b)}`) } }) : h('div.diff-msg', 'nincs'), h('figcaption', 'Új')));
    const onion = () => {
      const top = h('img', { src: sb || '', style: { opacity: 0.5 } });
      const slider = h('input', { type: 'range', min: 0, max: 100, value: 50, on: { input: (e) => (top.style.opacity = e.target.value / 100) } });
      return [h('div.modes', 'Régi', slider, 'Új'), h('div.onion', sa ? h('img', { src: sa }) : null, top)];
    };
    const kb = (d) => (d ? `${((d.length * 3) / 4 / 1024).toFixed(1)} KB` : '');
    let mode = 'side';
    const draw = () => {
      box.replaceChildren(h('div.modes', h('span.seg',
        h('button' + (mode === 'side' ? '.on' : ''), { on: { click: () => { mode = 'side'; draw(); } } }, 'Egymás mellett'),
        h('button' + (mode === 'onion' ? '.on' : ''), { disabled: !(sa && sb), on: { click: () => { mode = 'onion'; draw(); } } }, 'Átúsztatás'))),
        ...(mode === 'side' ? [sides()] : onion()));
    };
    draw();
    this.el.replaceChildren(this.toolbar(null), h('div.diff-body', h('div.diff-scroll', box)));
  }

  renderConflict(text) {
    const rows = [];
    let zone = '';
    text.replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
      let cls = zone;
      if (line.startsWith('<<<<<<<')) { zone = 'conflict-ours'; cls = 'conflict-mark'; }
      else if (line.startsWith('|||||||')) { zone = ''; cls = 'conflict-mark'; }
      else if (line.startsWith('=======') && zone) { zone = 'conflict-theirs'; cls = 'conflict-mark'; }
      else if (line.startsWith('>>>>>>>')) { zone = ''; cls = 'conflict-mark'; }
      rows.push(`<tr class="${cls}"><td class="ln">${i + 1}</td><td class="code">${esc(line) || ' '}</td></tr>`);
    });
    const scroll = h('div.diff-scroll');
    scroll.innerHTML = `<div class="diff ${this.prefs.wrap ? 'wrap' : ''}"><table><colgroup><col style="width:50px"><col></colgroup>${rows.join('')}</table></div>`;
    this.el.replaceChildren(this.toolbar(null), h('div.diff-body', scroll));
    const first = scroll.querySelector('tr.conflict-mark');
    if (first) scroll.scrollTop = first.offsetTop - 60;
  }
}

/** Blame view: lines [{hash, author, time, summary, line, text}] */
export function renderBlame(lines, onCommit) {
  const scroll = h('div.diff-scroll');
  let prev = null;
  const rows = lines.map((l) => {
    const first = l.hash !== prev;
    prev = l.hash;
    const meta = first ? `${esc(short(l.hash))} · ${esc(l.author)} · ${fmtDate(l.time)} · ${esc(l.summary)}` : '';
    return `<tr class="${first ? 'first' : ''}"><td class="bm" style="--bc:${hashColor(l.hash)}" data-hash="${l.hash}" title="${esc(l.summary)}">${meta}</td><td class="ln">${l.line}</td><td class="code">${esc(l.text) || ' '}</td></tr>`;
  });
  scroll.innerHTML = `<div class="diff blame"><table><colgroup><col style="width:260px"><col style="width:50px"><col></colgroup>${rows.join('')}</table></div>`;
  scroll.addEventListener('click', (e) => {
    const td = e.target.closest('td.bm');
    if (td && td.dataset.hash && !/^0+$/.test(td.dataset.hash)) onCommit(td.dataset.hash);
  });
  return scroll;
}
