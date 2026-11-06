// GitStar – main UI.

import {
  invoke, h, icon, toast, modal, confirmDlg, formDlg, combo, contextMenu, relTime, fmtDate, avatar,
  short, basename, dirname, splitter, markdown, shellSplit, debounce, esc,
} from './util.js';
import { DiffView, renderBlame } from './diff.js';
import { t, setLang, getLang } from './i18n.js';
import { graphSvg, graphWidth, ROW_H } from './graph.js';

// ───────────────────────── state ─────────────────────────

const S = {
  settings: null,
  repos: [],      // Repo[]
  active: -1,
  busy: 0,
  busyLabel: '',
};

class Repo {
  constructor(info) {
    this.path = info.path;
    this.name = info.name;
    this.view = 'changes';
    this.status = null;
    this.refs = null;
    this.commits = [];
    this.selCommit = null;
    this.commitDetails = null;
    this.selFile = null;          // {list: 'staged'|'unstaged'|'conflicted'|'commit'|'compare', path}
    this.multi = { staged: new Set(), unstaged: new Set() };
    this.logRev = '';             // '' = all branches
    this.logPath = '';            // file history filter
    this.matches = null;          // Set of hashes from search
    this.search = '';
    this.searchMode = 'message';
    this.commitMsg = '';
    this.amend = false;
    this.compare = { from: '', to: '', mergeBase: true, result: null };
    this.sideFilter = '';
    this.closedSecs = new Set();
    this.blame = null;
  }
}

const cur = () => S.repos[S.active] || null;
const isDeepSeek = () => S.settings?.ai_provider === 'deepseek';
const aiKey = () => (isDeepSeek() ? S.settings?.deepseek_api_key : S.settings?.anthropic_api_key) || '';
const aiModel = () => (isDeepSeek() ? S.settings?.deepseek_model : S.settings?.ai_model) || '';
const prefs = () => ({
  mode: S.settings.diff_mode, context: S.settings.diff_context, ignoreWs: S.settings.diff_ignore_ws, wrap: S.settings.diff_wrap,
});
const diffView = () => {
  if (!S._diff) {
    S._diff = new DiffView(prefs(), (p) => {
      Object.assign(S.settings, { diff_mode: p.mode, diff_context: p.context, diff_ignore_ws: p.ignoreWs, diff_wrap: p.wrap });
      saveSettings();
    });
  }
  return S._diff;
};

async function saveSettings() {
  try { await invoke('save_settings', { settings: S.settings }); } catch (e) { toast(e, 'err'); }
}

function persistRepos() {
  S.settings.open_repos = S.repos.map((r) => r.path);
  S.settings.active_repo = cur()?.path || '';
  saveSettings();
}

// ───────────────────────── theme ─────────────────────────

function applyLang() {
  setLang(S.settings.ui_language || 'auto');
  invoke('set_ui_language', { lang: getLang() }).catch(() => {});
}

function applyTheme() {
  let th = S.settings.theme;
  if (th === 'system') th = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = th;
  document.documentElement.style.setProperty('--font-size', (S.settings.font_size || 13) + 'px');
}

// The toolbar button only flips between the plain dark and light themes;
// the other themes (AI, retro, modern…) are chosen in Settings.
const THEME_UI = { dark: ['Sötét', 'moon'], light: ['Világos', 'sun'] };
const LIGHT_THEMES = ['light', 'modern'];
const nextBasicTheme = () => (LIGHT_THEMES.includes(document.documentElement.dataset.theme) ? 'dark' : 'light');

function toggleTheme() {
  S.settings.theme = nextBasicTheme();
  applyTheme();
  saveSettings();
  renderAll(true);
}

// ───────────────────────── git helpers ─────────────────────────

function setBusy(on, label = '') {
  S.busy += on ? 1 : -1;
  if (on) S.busyLabel = label;
  renderStatusbar();
}

/** Runs a git command with a busy indicator; refreshes after. */
async function op(label, args, { quiet = false, refresh = true, repo = cur() } = {}) {
  if (!repo) return null;
  setBusy(true, label);
  try {
    const out = await invoke('git_op', { repo: repo.path, args });
    if (!quiet) toast(opSummary(label, out), 'ok');
    consoleLog(repo, args, out, false);
    return out;
  } catch (e) {
    toast(t('{0} sikertelen:\n{1}', label, e), 'err');
    consoleLog(repo, args, String(e), true);
    return null;
  } finally {
    setBusy(false);
    if (refresh) await refreshAll(repo);
  }
}

/**
 * One or two lines for the success toast; the whole output is in the console.
 * Keeps the lines that say what happened (refs moved, up to date, files changed)
 * and drops progress, hints and "remote:" chatter.
 */
function opSummary(label, out) {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^(remote:|hint:|To |From |branch '.*' set up|Enumerating|Counting|Compressing|Writing|Total|Delta|Unpacking|Receiving|Resolving)/i.test(l));
  const key = lines.filter((l) => /->|up.to.date|files? changed|Fast-forward|Successfully|Merge made|Already|rejected|Created autostash|Applied autostash/i.test(l) && !/FETCH_HEAD|^Updating /.test(l));
  const src = key.length ? key : lines;
  const pick = src.slice(0, 2).map((l) => (l.length > 90 ? l.slice(0, 87) + '…' : l));
  const more = src.length > 2 ? '\n' + t('(a teljes kimenet a Konzolban: Ctrl+`)') : '';
  return pick.length ? `${t('{0}: kész', label)}\n${pick.join('\n')}${more}` : t('{0}: kész', label);
}


async function call(cmd, args, label) {
  try { return await invoke(cmd, args); } catch (e) { toast((label ? label + ':\n' : '') + e, 'err'); throw e; }
}

async function refreshStatus(repo = cur()) {
  if (!repo) return;
  try {
    repo.status = await invoke('status', { repo: repo.path });
  } catch (e) {
    repo.status = null;
    toast(e, 'err');
  }
}

async function refreshRefs(repo = cur()) {
  if (!repo) return;
  try { repo.refs = await invoke('refs', { repo: repo.path }); } catch (e) { toast(e, 'err'); }
}

async function refreshLog(repo = cur()) {
  if (!repo) return;
  try {
    repo.commits = await invoke('log', { repo: repo.path, req: { limit: S.settings.log_limit || 1500, rev: repo.logRev || null, path: repo.logPath || null } });
  } catch (e) { toast(e, 'err'); repo.commits = []; }
}

async function refreshAll(repo = cur()) {
  if (!repo) return;
  await Promise.all([refreshStatus(repo), refreshRefs(repo), refreshLog(repo)]);
  if (repo === cur()) renderAll(true);
}

// ───────────────────────── rendering root ─────────────────────────

function renderAll(keepDiff = false) {
  renderTabs();
  renderToolbar();
  renderSidebar();
  renderContent(keepDiff);
  renderStatusbar();
}

function renderTabs() {
  const el = document.getElementById('tabs');
  el.replaceChildren(
    ...S.repos.map((r, i) => h('div.tab' + (i === S.active ? '.active' : ''), {
      title: r.path,
      on: {
        mousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeRepo(i); } },
        click: () => switchRepo(i),
        contextmenu: (e) => contextMenu(e, [
          { label: t('Megnyitás Intézőben'), icon: 'folder', action: () => invoke('reveal_in_explorer', { path: r.path }) },
          { label: t('Terminál itt'), icon: 'terminal', action: () => invoke('open_terminal', { path: r.path }) },
          { label: t('Útvonal másolása'), icon: 'copy', action: () => copy(r.path) },
          '-',
          { label: t('Bezárás'), icon: 'close', action: () => closeRepo(i) },
        ]),
      },
    }, icon('folder'), h('span.name', r.name),
    h('button.x', { title: t('Bezárás'), on: { click: (e) => { e.stopPropagation(); closeRepo(i); } } }, icon('close')))),
    h('button.tab-add', { title: t('Repository megnyitása (Ctrl+O)'), on: { click: () => { S.active = -1; renderAll(); } } }, icon('plus')),
  );
}

function tb(label, ic, action, { disabled, title, badge, spin, menu, drop, dropTitle } = {}) {
  const on = { click: action };
  if (menu) on.contextmenu = (e) => { e.preventDefault(); menu(e); };
  const btn = h('button.tb', { disabled: disabled || null, title: title || label, on },
    icon(ic, spin ? 'spin' : ''), h('span', label), badge ? h('span.badge', badge) : null);
  if (!drop) return btn;
  // split button: the main part acts at once, the narrow right part opens the options
  return h('div.tb-split', btn,
    h('button.tb-drop', { disabled: disabled || null, title: dropTitle || label, on: { click: drop } },
      icon('chev')));
}

function renderToolbar() {
  const el = document.getElementById('toolbar');
  const r = cur();
  const nextTheme = nextBasicTheme();
  const st = r?.status;
  const no = !r;
  el.replaceChildren(
    r ? h('div.repo-title',
      h('span.rn', r.name),
      h('span.rb', icon('branch'), st ? (st.detached ? `HEAD (${short(st.head)})` : st.branch) : '…',
        st && st.upstream ? h('span', { title: st.upstream }, `${st.ahead ? '↑' + st.ahead : ''} ${st.behind ? '↓' + st.behind : ''}`) : null)) : h('div.repo-title', h('span.rn', 'GitStar')),
    h('div.tb-sep'),
    tb('Fetch', 'fetch', () => doFetch(), { disabled: no }),
    tb('Pull', 'pull', (e) => (e.shiftKey ? pullDlg() : doPull()), { disabled: no, badge: st?.behind || null, menu: () => pullDlg(),
      title: (st?.behind ? t('{0} új commit a remote-on', st.behind) + '\n' : '') + t('Pull ({0}) · Shift+kattintás vagy jobb klikk: beállítások', pullModeName()) }),
    tb('Push', 'push', () => quickPush(), { disabled: no, badge: st?.unpushed || st?.ahead || null, menu: () => pushDlg(),
      drop: () => pushDlg(), dropTitle: t('Push beállítások…'),
      title: (st?.unpushed ? t('{0} commit vár push-ra', st.unpushed) + '\n' : '') + (st?.upstream ? t('Push ide: {0}', st.upstream) : t('Push, upstream beállításával')) }),
    tb('PR', 'pr', () => prDlg(), { disabled: no || !r?.refs?.remotes?.length || !!st?.detached, title: t('Pull request létrehozása a böngészőben') }),
    h('div.tb-sep'),
    tb(t('Ág'), 'branch', () => newBranchDlg(), { disabled: no, title: t('Új ág') }),
    tb('Merge', 'merge', () => mergeDlg(), { disabled: no }),
    tb('Stash', 'stash', () => stashDlg(), { disabled: no }),
    tb('Pop', 'pop', () => stashPop(), { disabled: no || !r?.refs?.stashes?.length, title: t('Legutóbbi stash visszaállítása') }),
    h('div.tb-sep'),
    tb(t('Terminál'), 'terminal', () => invoke('open_terminal', { path: r.path }), { disabled: no }),
    tb(t('Mappa'), 'folder', () => invoke('reveal_in_explorer', { path: r.path }), { disabled: no }),
    tb(t('Konzol'), 'console', () => toggleConsole(), { disabled: no, title: t('Git konzol (Ctrl+`)') }),
    h('div.tb-spacer'),
    tb(t(THEME_UI[nextTheme][0]), THEME_UI[nextTheme][1], toggleTheme, { title: t('Váltás sötét és világos téma között (a többi téma a Beállításokban)') }),
    tb(t('Beállítások'), 'settings', () => settingsDlg()),
    tb(t('Névjegy'), 'info', () => aboutDlg(), { title: t('A GitStar névjegye (F1)') }),
  );
}

function renderStatusbar() {
  const el = document.getElementById('statusbar');
  const r = cur();
  const st = r?.status;
  el.replaceChildren(
    S.busy ? h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, icon('refresh', 'spin'), S.busyLabel || t('Folyamatban…')) : h('span', r ? r.path : t('Nincs megnyitott repository')),
    st?.operation ? h('span.op', t('⚠ {0} folyamatban', opName(st.operation))) : null,
    h('span.grow'),
    st ? h('span', t('{0} staged · {1} változott', st.staged.length, st.unstaged.length) + (st.conflicted.length ? t(' · {0} konfliktus', st.conflicted.length) : '')) : null,
    r ? h('span', t('{0} commit', r.commits.length)) : null,
    h('span', t('AI: {0}', aiKey() ? aiModel() : t('nincs kulcs'))),
    S.update?.updateAvailable ? h('span.update-status', { title: t('Kattints a telepítéshez'), on: { click: () => updateShowAvailable() } }, icon('fetch'), t('Frissítés elérhető: v{0}', S.update.latestVersion)) : null,
  );
}

const opName = (o) => ({ merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert', bisect: 'Bisect' }[o] || o);

// ───────────────────────── sidebar ─────────────────────────

function renderSidebar() {
  const el = document.getElementById('sidebar');
  const r = cur();
  if (!r) { el.replaceChildren(h('div.empty', icon('star'), t('Nyiss meg egy repository-t'))); return; }
  const st = r.status;
  const changes = st ? st.staged.length + st.unstaged.length + st.conflicted.length : 0;
  const nav = h('div.side-nav',
    h('div.nav-item' + (r.view === 'changes' ? '.active' : ''), { on: { click: () => setView('changes') } }, icon('changes'), t('Lokális változások'), changes ? h('span.count', changes) : null),
    h('div.nav-item' + (r.view === 'history' && !r.logRev && !r.logPath ? '.active' : ''), { on: { click: () => { r.logRev = ''; r.logPath = ''; setView('history', true); } } }, icon('history'), t('Összes commit')),
    h('div.nav-item' + (r.view === 'compare' ? '.active' : ''), { on: { click: () => setView('compare') } }, icon('compare'), t('Összehasonlítás')),
  );
  const filter = h('input.inp.side-filter', {
    placeholder: t('Szűrés…'), value: r.sideFilter,
    on: { input: debounce((e) => { r.sideFilter = e.target.value; renderSideTree(tree, r); }, 120) },
  });
  const tree = h('div.side-tree');
  el.replaceChildren(nav, filter, tree);
  renderSideTree(tree, r);
}

function section(r, id, title, count, body, actions) {
  const closed = r.closedSecs.has(id);
  return h('div.sec' + (closed ? '.closed' : ''),
    h('div.sec-h', { on: { click: (e) => { if (e.target.closest('.act')) return; closed ? r.closedSecs.delete(id) : r.closedSecs.add(id); renderSidebar(); } } },
      icon('chev', 'chev'), title, ...(actions || []), h('span.cnt', count)),
    h('div.sec-b', body));
}

/** Groups names by "/" into a folder tree. */
function treeify(items, getName) {
  const root = { dirs: new Map(), leaves: [] };
  for (const it of items) {
    const parts = getName(it).split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { dirs: new Map(), leaves: [] });
      node = node.dirs.get(parts[i]);
    }
    node.leaves.push([parts[parts.length - 1], it]);
  }
  return root;
}

function renderTree(node, lvl, leafFn, out, keyPrefix, r) {
  for (const [name, sub] of node.dirs) {
    const key = keyPrefix + '/' + name;
    const closed = r.closedSecs.has(key);
    out.push(h('div.ref.folder', { style: { '--lvl': lvl }, on: { click: () => { closed ? r.closedSecs.delete(key) : r.closedSecs.add(key); renderSidebar(); } } },
      icon('chev', closed ? 'rot' : ''), icon('folder'), h('span.nm', name)));
    if (!closed) renderTree(sub, lvl + 1, leafFn, out, key, r);
  }
  for (const [name, it] of node.leaves) out.push(leafFn(name, it, lvl));
}

function renderSideTree(tree, r) {
  const refs = r.refs;
  if (!refs) { tree.replaceChildren(); return; }
  const q = r.sideFilter.toLowerCase();
  const f = (n) => !q || n.toLowerCase().includes(q);

  // local branches
  const locals = refs.local.filter((b) => f(b.name));
  const lout = [];
  renderTree(treeify(locals, (b) => b.name), 0, (name, b, lvl) => h('div.ref' + (b.current ? '.current' : '') + (r.view === 'history' && r.selCommit === b.hash ? '.sel' : ''), {
    style: { '--lvl': lvl }, title: b.upstream ? `${b.name} → ${b.upstream}` : b.name,
    on: {
      click: () => showRefInHistory(b.hash, b.name),
      dblclick: () => checkout(b.name),
      contextmenu: (e) => localBranchMenu(e, b),
    },
  }, b.current ? h('span.cur-dot') : icon('branch'), h('span.nm', name),
  b.gone ? h('span.gone', 'gone') : (b.ahead || b.behind) ? h('span.ab', b.ahead ? `↑${b.ahead}` : null, b.behind ? `↓${b.behind}` : null) : null), lout, 'L', r);

  // remotes
  const rout = [];
  for (const rm of refs.remotes) {
    const brs = refs.remote.filter((b) => b.name.startsWith(rm.name + '/') && f(b.name));
    const key = 'R/' + rm.name;
    const closed = r.closedSecs.has(key);
    rout.push(h('div.ref', { title: rm.url, on: {
      click: () => { closed ? r.closedSecs.delete(key) : r.closedSecs.add(key); renderSidebar(); },
      contextmenu: (e) => contextMenu(e, [
        { label: `Fetch: ${rm.name}`, icon: 'fetch', action: () => op(`Fetch ${rm.name}`, ['fetch', '--prune', rm.name]) },
        { label: t('URL másolása'), icon: 'copy', action: () => copy(rm.url) },
        { label: t('URL módosítása…'), icon: 'changes', action: async () => {
          const v = await formDlg('Remote URL', [{ name: 'url', label: rm.name, value: rm.url }], t('Mentés'));
          if (v) op('Remote URL', ['remote', 'set-url', rm.name, v.url]);
        } },
        '-',
        { label: t('Remote törlése'), icon: 'trash', danger: true, action: async () => {
          if (await confirmDlg(t('Remote törlése'), t('Törlöd a(z) "{0}" remote-ot?', rm.name), t('Törlés'), true)) op(t('Remote törlése'), ['remote', 'remove', rm.name]);
        } },
      ]),
    } }, icon('cloud'), h('span.nm', rm.name)));
    if (!closed) {
      renderTree(treeify(brs, (b) => b.name.slice(rm.name.length + 1)), 1, (name, b, lvl) => h('div.ref' + (r.view === 'history' && r.selCommit === b.hash ? '.sel' : ''), {
        style: { '--lvl': lvl }, title: b.name,
        on: { click: () => showRefInHistory(b.hash, b.name), dblclick: () => checkoutRemote(b.name), contextmenu: (e) => remoteBranchMenu(e, b, rm.name) },
      }, icon('branch'), h('span.nm', name)), rout, key, r);
    }
  }

  const tout = refs.tags.filter((tg) => f(tg.name)).map((tg) => h('div.ref', {
    title: tg.name, on: { click: () => showRefInHistory(tg.hash, tg.name), contextmenu: (e) => tagMenu(e, tg) },
  }, icon('tag'), h('span.nm', tg.name)));

  const sout = refs.stashes.filter((s) => f(s.message)).map((s) => h('div.ref', {
    title: `${s.name}: ${s.message}`, on: { click: () => showStash(s), contextmenu: (e) => stashMenu(e, s) },
  }, icon('stash'), h('span.nm', s.message.replace(/^(WIP )?[Oo]n [^:]+: /, '')), h('span.ab', relTime(s.time))));

  const addBtn = (title, fn) => h('button.act', { title, on: { click: (e) => { e.stopPropagation(); fn(); } } }, icon('plus'));
  tree.replaceChildren(
    section(r, 'branches', t('Ágak'), locals.length, lout, [addBtn(t('Új ág'), () => newBranchDlg())]),
    section(r, 'remotes', t('Remote-ok'), refs.remote.length, rout, [addBtn(t('Remote hozzáadása'), () => addRemoteDlg())]),
    section(r, 'tags', t('Tagek'), tout.length, tout, [addBtn(t('Új tag'), () => tagDlg('HEAD'))]),
    section(r, 'stashes', t('Stash-ek'), sout.length, sout, [addBtn(t('Új stash'), () => stashDlg())]),
  );
}

function setView(v, reload) {
  const r = cur();
  if (!r) return;
  r.view = v;
  r.blame = null;
  if (reload) refreshLog(r).then(() => renderAll());
  else renderAll();
}

// ───────────────────────── content ─────────────────────────

function renderContent(keep) {
  const el = document.getElementById('content');
  const r = cur();
  if (!r) return renderWelcome(el);
  if (r.view === 'history') return renderHistory(el, r, keep);
  if (r.view === 'compare') return renderCompare(el, r, keep);
  return renderChanges(el, r, keep);
}

// ── welcome ──
function renderWelcome(el) {
  const recent = (S.settings.recent_repos || []).filter((p) => !S.repos.some((r) => r.path === p));
  el.replaceChildren(h('div.welcome', h('div.welcome-box',
    h('h1', h('img', { src: 'img/icon.svg', alt: '', title: t('Névjegy'), style: { cursor: 'pointer' }, on: { click: () => aboutDlg() } }), 'GitStar'),
    h('div.lead', t('Git kliens AI commit üzenetekkel és vizuális diff-fel.')),
    h('div.actions',
      h('button.btn.primary', { on: { click: () => openRepoDlg() } }, icon('folder'), t('Megnyitás…')),
      h('button.btn', { on: { click: () => cloneDlg() } }, icon('globe'), t('Klónozás…')),
      h('button.btn', { on: { click: () => initDlg() } }, icon('plus'), t('Új repository…'))),
    recent.length ? h('div', h('div.sec-h', t('Legutóbbi')), h('div.recent', recent.map((p) => h('div.recent-item', { on: { click: () => openRepo(p) } },
      icon('folder'), h('div', h('div', basename(p)), h('div.p', p)),
      h('button.icon-btn.x', { title: t('Eltávolítás a listából'), on: { click: (e) => { e.stopPropagation(); S.settings.recent_repos = S.settings.recent_repos.filter((x) => x !== p); saveSettings(); renderContent(); } } }, icon('close')))))) : null,
  )));
}

// ── changes ──
function opBanner(r) {
  const st = r.status;
  if (!st?.operation) return null;
  const o = st.operation;
  const cont = { merge: ['merge', '--continue'], rebase: ['rebase', '--continue'], 'cherry-pick': ['cherry-pick', '--continue'], revert: ['revert', '--continue'] }[o];
  const abort = { merge: ['merge', '--abort'], rebase: ['rebase', '--abort'], 'cherry-pick': ['cherry-pick', '--abort'], revert: ['revert', '--abort'], bisect: ['bisect', 'reset'] }[o];
  return h('div.op-banner', h('b', t('{0} folyamatban.', opName(o))),
    st.conflicted.length ? t('{0} konfliktusos fájl vár feloldásra.', st.conflicted.length) : t('Nincs konfliktus – folytatható.'),
    h('span', { style: { flex: 1 } }),
    cont && o !== 'merge' ? h('button.btn.sm.primary', { disabled: st.conflicted.length > 0 || null, on: { click: () => op(t('{0} folytatása', opName(o)), ['-c', 'core.editor=true', ...cont]) } }, t('Folytatás')) : null,
    o === 'rebase' ? h('button.btn.sm', { on: { click: () => op('Rebase skip', ['rebase', '--skip']) } }, t('Kihagyás')) : null,
    abort ? h('button.btn.sm', { on: { click: async () => { if (await confirmDlg(t('Megszakítás'), t('Megszakítod: {0}?', opName(o)), t('Megszakítás'), true)) op(t('{0} megszakítása', opName(o)), abort); } } }, t('Megszakítás')) : null);
}

function fileRow(r, list, f, onSelect) {
  const sel = r.selFile && r.selFile.list === list && r.selFile.path === f.path;
  const multi = r.multi[list]?.has(f.path);
  const dir = dirname(f.path);
  const stLetter = f.status === '?' ? 'A' : f.status;
  const actions = [];
  if (list === 'unstaged') {
    actions.push(h('button.icon-btn', { title: 'Stage', on: { click: (e) => { e.stopPropagation(); stagePaths([f.path]); } } }, icon('plus')));
    actions.push(h('button.icon-btn', { title: t('Elvetés'), on: { click: (e) => { e.stopPropagation(); discardFiles([f]); } } }, icon('undo')));
  } else if (list === 'staged') {
    actions.push(h('button.icon-btn', { title: 'Unstage', on: { click: (e) => { e.stopPropagation(); unstagePaths([f.path]); } } }, icon('minus')));
  }
  return h('div.file' + (sel || multi ? '.sel' : ''), {
    title: f.old_path && f.status !== 'U' ? `${f.old_path} → ${f.path}` : f.path,
    on: {
      click: (e) => {
        if (r.multi[list] && (e.ctrlKey || e.metaKey)) {
          const m = r.multi[list];
          if (m.size === 0 && r.selFile?.list === list) m.add(r.selFile.path);
          m.has(f.path) ? m.delete(f.path) : m.add(f.path);
          renderContent(true);
          return;
        }
        if (r.multi[list]) { r.multi.staged.clear(); r.multi.unstaged.clear(); }
        onSelect(f);
      },
      dblclick: () => { if (list === 'unstaged') stagePaths([f.path]); else if (list === 'staged') unstagePaths([f.path]); },
      contextmenu: (e) => fileMenu(e, r, list, f),
    },
  }, h('span.st.st-' + stLetter, { title: statusName(f.status) }, stLetter === '?' ? 'A' : stLetter),
  h('span.fn', basename(f.path)), dir ? h('span.dir', dir) : h('span', { style: { flex: 1 } }),
  f.added != null || f.deleted != null ? h('span.stats', f.added != null ? h('span.a', `+${f.added}`) : null, f.deleted != null ? h('span.d', `−${f.deleted}`) : null) : null,
  actions.length ? h('span.fa', actions) : null);
}

const statusName = (s) => ({ M: t('Módosítva'), A: t('Új'), D: t('Törölve'), R: t('Átnevezve'), C: t('Másolva'), T: t('Típus változott'), U: t('Konfliktus'), '?': t('Nem követett (új)') }[s] || s);

function renderChanges(el, r, keep) {
  const st = r.status;
  if (!st) { el.replaceChildren(h('div.empty', t('Állapot betöltése…'))); return; }
  const dv = diffView();
  const selected = (list) => (r.multi[list].size ? [...r.multi[list]] : r.selFile?.list === list ? [r.selFile.path] : []);

  const unstagedList = h('div.file-list', st.unstaged.map((f) => fileRow(r, 'unstaged', f, (x) => selectChange(r, 'unstaged', x))));
  const stagedList = h('div.file-list', st.staged.map((f) => fileRow(r, 'staged', f, (x) => selectChange(r, 'staged', x))));
  const conflictList = st.conflicted.length ? h('div.file-list-wrap', { style: { flex: 'none', maxHeight: '30%' } },
    h('div.pane-h', icon('info'), t('Konfliktusok'), h('span.sub', st.conflicted.length)),
    h('div.file-list', st.conflicted.map((f) => fileRow(r, 'conflicted', f, (x) => selectChange(r, 'conflicted', x))))) : null;

  const unstagedWrap = h('div.file-list-wrap', { style: { flex: '1' } },
    h('div.pane-h', t('Unstaged'), h('span.sub', st.unstaged.length), h('span.grow'),
      h('button.btn.sm', { disabled: !st.unstaged.length || null, title: t('Kijelöltek stage-elése'), on: { click: () => stagePaths(selected('unstaged')) } }, 'Stage'),
      h('button.btn.sm', { disabled: !st.unstaged.length || null, on: { click: () => stageAll() } }, t('Összes stage'))),
    unstagedList);
  const stagedWrap = h('div.file-list-wrap', { style: { flex: '1' } },
    h('div.pane-h', t('Staged'), h('span.sub', st.staged.length), h('span.grow'),
      h('button.btn.sm', { disabled: !st.staged.length || null, on: { click: () => unstagePaths(selected('staged')) } }, 'Unstage'),
      h('button.btn.sm', { disabled: !st.staged.length || null, on: { click: () => unstagePaths([]) } }, t('Összes unstage'))),
    stagedList);
  const split = h('div.splitter-h');
  // Handle on top of the commit box: drag up to make the message field taller.
  const cbox = commitBox(r);
  const commitSplit = h('div.splitter-h.commit-split', { title: t('Húzd felfelé a commit üzenet mező nagyításához') });
  splitter(commitSplit, cbox.querySelector('textarea'), { vertical: false, invert: true, min: 90, max: Math.round(innerHeight * 0.65), key: 'gs.commitH' });
  const left = h('div.changes-left', conflictList, unstagedWrap, split, stagedWrap, commitSplit, cbox);
  splitter(split, unstagedWrap, { vertical: false, min: 60, max: 1200, key: 'gs.unstagedH' });
  const vs = h('div.splitter-v');
  const right = h('div.changes-right', dv.el);
  splitter(vs, left, { min: 240, max: 900, key: 'gs.changesW' });
  el.replaceChildren(...[opBanner(r), h('div.changes', left, vs, right)].filter(Boolean));

  // keep / restore the diff
  const all = [...st.unstaged.map((f) => ['unstaged', f]), ...st.staged.map((f) => ['staged', f]), ...st.conflicted.map((f) => ['conflicted', f])];
  const still = r.selFile && all.find(([l, f]) => l === r.selFile.list && f.path === r.selFile.path);
  if (still) { if (!keep || !dv.opts || dv._key !== keyOf(r, still[0], still[1])) selectChange(r, still[0], still[1], true); else dv.reload(); }
  else {
    const first = all[0];
    if (first) selectChange(r, first[0], first[1], true);
    else dv.clear(t('Nincs lokális változás – a working tree tiszta.'));
  }
}

const keyOf = (r, list, f) => `${r.path}|${list}|${f.path}`;

function selectChange(r, list, f, silent) {
  r.selFile = { list, path: f.path };
  const dv = diffView();
  dv._key = keyOf(r, list, f);
  if (!silent) document.querySelectorAll('.changes-left .file').forEach((x) => x.classList.remove('sel'));
  if (!silent) renderContentListsOnly(r);
  const untracked = f.status === '?';
  const mode = list === 'conflicted' ? 'conflict' : list === 'staged' ? 'staged' : untracked ? 'untracked' : 'unstaged';
  const extra = [];
  if (list === 'conflicted') {
    extra.push(h('button.btn.sm', { on: { click: () => resolve(f.path, 'ours') } }, t('Saját (ours)')));
    extra.push(h('button.btn.sm', { on: { click: () => resolve(f.path, 'theirs') } }, t('Másik (theirs)')));
    extra.push(h('button.btn.sm.primary', { on: { click: () => resolve(f.path, 'mark') } }, t('Feloldva')));
  }
  dv.show({
    path: f.path,
    oldPath: list === 'staged' ? f.old_path : null,
    conflict: list === 'conflicted',
    actions: list === 'unstaged' && !untracked ? 'stage' : list === 'staged' ? 'unstage' : null,
    load: (context, ignoreWs) => invoke('diff', { repo: r.path, req: { mode, path: f.path, old_path: list === 'staged' ? f.old_path : null, context, ignore_ws: ignoreWs } }),
    apply: async (patch, { act, cached, reverse }) => {
      if (act === 'discard' && !(await confirmDlg(t('Elvetés'), t('A kijelölt változások véglegesen elvesznek. Folytatod?'), t('Elvetés'), true))) return;
      await invoke('apply_patch', { repo: r.path, patch, cached, reverse });
      await refreshStatus(r);
      renderAll(true);
    },
    image: {
      old: () => invoke('file_content', { repo: r.path, rev: list === 'staged' ? 'HEAD' : ':', path: f.old_path && list === 'staged' ? f.old_path : f.path }),
      new: () => invoke('file_content', { repo: r.path, rev: list === 'staged' ? ':' : '', path: f.path }),
    },
    extra,
    onAi: (text) => aiPanel(t('AI elemzés – {0}', basename(f.path)), (q) => invoke('ai_analyze', { repo: r.path, req: { kind: 'file', path: f.path, diff_text: text, question: q } })),
  });
}

function renderContentListsOnly(r) {
  document.querySelectorAll('.changes-left .file').forEach((el) => {
    // cheap re-highlight; full re-render keeps scroll otherwise
    el.classList.toggle('sel', false);
  });
  const lists = document.querySelectorAll('.changes-left .file-list');
  lists.forEach((l) => l.querySelectorAll('.file').forEach((f) => {
    if (f.title === r.selFile.path || f.title.endsWith('→ ' + r.selFile.path)) f.classList.add('sel');
  }));
}

function commitBox(r) {
  const st = r.status;
  const ta = h('textarea.inp', {
    placeholder: t('Commit üzenet (első sor: összefoglaló)\n\nCtrl+Enter = commit'), spellcheck: 'true', value: r.commitMsg,
    on: {
      input: (e) => { r.commitMsg = e.target.value; updHint(); },
      keydown: (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); doCommit(r); } },
    },
  });
  const hint = h('span.hint');
  const updHint = () => {
    const first = (r.commitMsg.split('\n')[0] || '').length;
    hint.textContent = first ? `${first}/72` : '';
    hint.className = 'hint' + (first > 72 ? ' warn' : '');
  };
  updHint();
  const n = st.staged.length;
  const commitBtn = h('button.btn.primary', { on: { click: () => doCommit(r) } });
  const resetAuthor = h('input', { type: 'checkbox', checked: !!r.resetAuthor, on: { change: (e) => { r.resetAuthor = e.target.checked; } } });
  const authorTxt = h('span');
  const resetLbl = h('label.chk.amend-author', { title: t('A módosított commit szerzője a beállított git név és email lesz (--reset-author)') }, resetAuthor, authorTxt);
  const loadIdent = async () => {
    try {
      const id = await invoke('git_identity', { repo: r.path });
      authorTxt.textContent = id.name || id.email ? t('Szerző: {0}', `${id.name} <${id.email}>`) : t('Szerző: nincs beállítva (Beállítások → Git)');
    } catch { authorTxt.textContent = t('Szerző frissítése'); }
  };
  const updBtn = () => {
    commitBtn.disabled = !n && !r.amend && st.operation !== 'merge';
    commitBtn.replaceChildren(icon('check'), (r.amend ? 'Amend' : 'Commit') + (n ? ` (${n})` : ''));
    commitBtn.title = r.amend ? t('Az utolsó commit módosítása (üzenet és a staged változások)') : '';
    resetLbl.style.display = r.amend ? '' : 'none';
  };
  const amend = h('input', { type: 'checkbox', checked: r.amend, on: { change: async (e) => {
    r.amend = e.target.checked;
    updBtn();
    if (r.amend) {
      loadIdent();
      if (!r.commitMsg.trim()) {
        try { r.commitMsg = r.amendMsg = await invoke('head_message', { repo: r.path }); ta.value = r.commitMsg; updHint(); } catch {}
      }
    } else {
      r.resetAuthor = false;
      resetAuthor.checked = false;
      // Drop the message we loaded for amending if it was not edited.
      if (r.amendMsg && r.commitMsg === r.amendMsg) { r.commitMsg = ''; ta.value = ''; updHint(); }
      r.amendMsg = null;
    }
  } } });
  updBtn();
  if (r.amend) loadIdent();
  const aiBtn = h('button.btn.ai', { title: t('Commit üzenet generálása a staged diff alapján'), disabled: !st.staged.length || null, on: { click: async () => {
    aiBtn.disabled = true;
    const old = aiBtn.innerHTML;
    aiBtn.replaceChildren(icon('refresh', 'spin'), t('Generálás…'));
    try {
      const res = await invoke('ai_commit_message', { repo: r.path });
      r.commitMsg = res.text;
      ta.value = res.text;
      updHint();
      if (res.truncated) toast(t('A diff nagyon nagy volt, csak az eleje került az AI-hoz.'), 'info', 6000);
    } catch (e) { toast(e, 'err'); }
    aiBtn.innerHTML = old;
    aiBtn.disabled = false;
  } } }, icon('sparkle'), t('AI üzenet'));
  return h('div.commit-box',
    ta,
    h('div.row', h('label.chk', { title: t('Az utolsó commit módosítása') }, amend, 'Amend'), hint, h('span.grow'), aiBtn, commitBtn),
    resetLbl,
    !n && st.unstaged.length ? h('div.hint', t('Nincs staged fájl. Dupla kattintás vagy a + gomb egy fájlon stage-eli.')) : null);
}

async function doCommit(r) {
  const msg = r.commitMsg.trim();
  if (!msg) { toast(t('Írj commit üzenetet (vagy kérj egyet az AI-tól).'), 'err'); return; }
  if (!r.status.staged.length && !r.amend && r.status.operation !== 'merge') { toast(t('Nincs staged változás.'), 'err'); return; }
  setBusy(true, 'Commit…');
  try {
    const out = await invoke('commit', { repo: r.path, message: msg, amend: r.amend, resetAuthor: r.amend && !!r.resetAuthor, signoff: false, noVerify: false });
    toast(out.trim().split('\n')[0] || t('Commit kész'), 'ok');
    r.commitMsg = '';
    r.amend = false;
    r.resetAuthor = false;
    r.amendMsg = null;
  } catch (e) {
    if (/tell me who you are|identity unknown|empty ident/i.test(String(e))) {
      toast(t('Nincs beállítva git név és email. Add meg a Beállítások → Git részben.'), 'err', 8000);
      settingsDlg();
    } else toast(t('Commit sikertelen:\n') + e, 'err');
  } finally {
    setBusy(false);
    await refreshAll(r);
  }
}

async function stagePaths(paths) {
  const r = cur();
  if (!paths.length) return;
  try { await invoke('stage', { repo: r.path, paths }); } catch (e) { toast(e, 'err'); }
  r.multi.unstaged.clear();
  await refreshStatus(r); renderAll(true);
}
async function stageAll() {
  const r = cur();
  try { await invoke('stage_all', { repo: r.path }); } catch (e) { toast(e, 'err'); }
  await refreshStatus(r); renderAll(true);
}
async function unstagePaths(paths) {
  const r = cur();
  try { await invoke('unstage', { repo: r.path, paths }); } catch (e) { toast(e, 'err'); }
  r.multi.staged.clear();
  await refreshStatus(r); renderAll(true);
}
async function discardFiles(files) {
  const r = cur();
  if (!files.length) return;
  const names = files.map((f) => f.path).slice(0, 12).join('\n') + (files.length > 12 ? t('\n… és még {0}', files.length - 12) : '');
  if (!(await confirmDlg(t('Változások elvetése'), t('Ezek a változások véglegesen elvesznek:\n\n{0}', names), t('Elvetés'), true))) return;
  const tracked = files.filter((f) => f.status !== '?').map((f) => f.path);
  const untracked = files.filter((f) => f.status === '?').map((f) => f.path);
  try { await invoke('discard', { repo: r.path, paths: tracked, untracked }); } catch (e) { toast(e, 'err'); }
  r.multi.unstaged.clear();
  await refreshStatus(r); renderAll(true);
}
async function resolve(path, side) {
  const r = cur();
  try { await invoke('resolve_conflict', { repo: r.path, path, side }); toast(t('Feloldva: {0}', path), 'ok'); } catch (e) { toast(e, 'err'); }
  await refreshStatus(r);
  if (!r.status.conflicted.length && r.status.operation === 'merge' && !r.commitMsg) {
    try { r.commitMsg = await invoke('prepared_message', { repo: r.path }); } catch {}
  }
  renderAll(true);
}

function fileMenu(e, r, list, f) {
  const multi = r.multi[list]?.size ? [...r.multi[list]] : [f.path];
  const files = list === 'unstaged' ? r.status.unstaged.filter((x) => multi.includes(x.path)) : [f];
  const abs = r.path + '\\' + f.path.replace(/\//g, '\\');
  contextMenu(e, [
    list === 'unstaged' ? { label: multi.length > 1 ? `Stage (${multi.length})` : 'Stage', icon: 'plus', action: () => stagePaths(multi) } : null,
    list === 'staged' ? { label: multi.length > 1 ? `Unstage (${multi.length})` : 'Unstage', icon: 'minus', action: () => unstagePaths(multi) } : null,
    list === 'unstaged' ? { label: t('Változások elvetése…'), icon: 'undo', danger: true, action: () => discardFiles(files) } : null,
    list === 'conflicted' ? { label: t('Saját verzió (ours)'), icon: 'check', action: () => resolve(f.path, 'ours') } : null,
    list === 'conflicted' ? { label: t('Másik verzió (theirs)'), icon: 'check', action: () => resolve(f.path, 'theirs') } : null,
    list === 'conflicted' ? { label: t('Megjelölés feloldottként'), icon: 'check', action: () => resolve(f.path, 'mark') } : null,
    '-',
    { label: t('Megnyitás'), icon: 'file', action: () => invoke('open_file', { path: abs }) },
    { label: t('Megjelenítés Intézőben'), icon: 'folder', action: () => invoke('reveal_in_explorer', { path: abs }) },
    { label: t('Útvonal másolása'), icon: 'copy', action: () => copy(f.path) },
    '-',
    f.status !== '?' ? { label: t('Fájl előzmények'), icon: 'history', action: () => fileHistory(f.path) } : null,
    f.status !== '?' && f.status !== 'A' ? { label: 'Blame', icon: 'blame', action: () => showBlame(f.path, '') } : null,
    { label: t('AI elemzés (a teljes változás)'), icon: 'sparkle', action: () => aiPanel(t('AI elemzés – lokális változások'), (q) => invoke('ai_analyze', { repo: r.path, req: { kind: list === 'staged' ? 'staged' : 'working', question: q } })) },
    f.status === '?' ? '-' : null,
    f.status === '?' ? { label: t('.gitignore-ba: {0}', f.path), icon: 'eye', action: () => ignore(f.path) } : null,
    f.status === '?' && f.path.includes('.') ? { label: t('.gitignore-ba: {0}', '*' + f.path.slice(f.path.lastIndexOf('.'))), icon: 'eye', action: () => ignore('*' + f.path.slice(f.path.lastIndexOf('.'))) } : null,
  ]);
}

async function ignore(pattern) {
  const r = cur();
  try { await invoke('add_to_gitignore', { repo: r.path, pattern }); toast(`.gitignore: ${pattern}`, 'ok'); } catch (e) { toast(e, 'err'); }
  await refreshStatus(r); renderAll(true);
}

// ── history ──
let logScrollTop = 0;

function renderHistory(el, r, keep) {
  const dv = diffView();
  const searchInp = h('input.inp', {
    placeholder: t('Keresés (Enter)…'), value: r.search,
    on: { keydown: (e) => { if (e.key === 'Enter') runSearch(r, e.target.value); if (e.key === 'Escape') { e.target.value = ''; runSearch(r, ''); } } },
  });
  const modeSel = h('select.inp', { style: { width: 'auto' }, on: { change: (e) => { r.searchMode = e.target.value; if (r.search) runSearch(r, r.search); } } },
    [['message', t('Üzenet / hash')], ['author', t('Szerző')], ['content', t('Tartalom (-S)')], ['path', t('Fájl útvonal')]].map(([v, l]) => h('option', { value: v }, l)));
  modeSel.value = r.searchMode;
  const title = r.logPath ? t('Fájl előzmények: {0}', r.logPath) : r.logRev ? t('Ág: {0}', r.logRev) : t('Összes ág');
  const head = h('div.log-head',
    h('b', title),
    r.logPath || r.logRev ? h('button.btn.sm', { on: { click: () => { r.logPath = ''; r.logRev = ''; setView('history', true); } } }, t('Összes ág')) : null,
    !r.logPath ? h('button.btn.sm', { title: t('Csak az aktuális ág'), on: { click: () => { r.logRev = r.logRev ? '' : 'HEAD'; setView('history', true); } } }, r.logRev ? t('Minden ág') : t('Csak HEAD')) : null,
    h('span', { style: { flex: 1 } }),
    r.matches ? h('span.sub', { style: { color: 'var(--text-dim)', fontSize: '12px' } }, t('{0} találat', r.matches.size)) : null,
    r.matches ? h('button.icon-btn', { title: t('Előző találat'), on: { click: () => jumpMatch(r, -1) } }, icon('up')) : null,
    r.matches ? h('button.icon-btn', { title: t('Következő találat'), on: { click: () => jumpMatch(r, 1) } }, icon('down')) : null,
    modeSel, searchInp,
    h('button.icon-btn', { title: t('Frissítés (F5)'), on: { click: () => refreshAll(r) } }, icon('refresh')));
  const gw = graphWidth(r.commits);
  const cols = h('div.log-cols', h('span', { style: { width: gw + 'px', paddingLeft: '6px' } }, t('Gráf')), h('span', { style: { flex: 1 } }, t('Leírás')),
    h('span', { style: { width: '150px' } }, t('Szerző')), h('span', { style: { width: '74px' } }, 'Hash'), h('span', { style: { width: '130px', textAlign: 'right', paddingRight: '10px' } }, t('Dátum')));
  const scroll = h('div.log-scroll', { tabindex: 0 });
  const inner = h('div.log-inner');
  scroll.append(inner);
  const top = h('div.history-top', head, cols, scroll);
  const detailsEl = h('div.details');
  const bottom = h('div.history-bottom', detailsEl, h('div.splitter-v', { id: 'det-split' }), h('div.changes-right', dv.el));
  const hs = h('div.splitter-h');
  el.replaceChildren(...[opBanner(r), h('div.history', top, hs, bottom)].filter(Boolean));
  splitter(hs, bottom, { vertical: false, min: 120, max: 1400, invert: true, key: 'gs.histBottomH' });
  splitter(bottom.querySelector('#det-split'), detailsEl, { min: 220, max: 1200, key: 'gs.detailsW' });

  // virtual list
  const wip = r.status && (r.status.staged.length + r.status.unstaged.length + r.status.conflicted.length) > 0 && !r.logPath && !r.logRev;
  const rows = wip ? [{ wip: true }, ...r.commits] : r.commits;
  r._rows = rows;
  inner.style.height = rows.length * ROW_H + 'px';
  const headHash = r.status?.head;
  const draw = () => {
    const st = scroll.scrollTop, vh = scroll.clientHeight || 600;
    const a = Math.max(0, Math.floor(st / ROW_H) - 8), b = Math.min(rows.length, Math.ceil((st + vh) / ROW_H) + 8);
    let html = '';
    for (let i = a; i < b; i++) html += rowHtml(rows[i], i, gw, headHash, r);
    inner.innerHTML = html;
  };
  scroll.addEventListener('scroll', () => { logScrollTop = scroll.scrollTop; draw(); }, { passive: true });
  new ResizeObserver(draw).observe(scroll);
  scroll.addEventListener('click', (e) => {
    const row = e.target.closest('.crow');
    if (!row) return;
    const it = rows[+row.dataset.i];
    if (it.wip) { setView('changes'); return; }
    selectCommit(r, it.hash);
    draw();
  });
  scroll.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.crow');
    if (!row) return;
    const it = rows[+row.dataset.i];
    if (it.wip) return;
    commitMenu(e, r, it);
  });
  scroll.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const idx = rows.findIndex((x) => x.hash === r.selCommit);
    const n = Math.max(0, Math.min(rows.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
    if (rows[n] && !rows[n].wip) { selectCommit(r, rows[n].hash); ensureVisible(scroll, n); draw(); }
  });
  r._draw = draw;
  r._scroll = scroll;
  if (keep) scroll.scrollTop = logScrollTop;
  draw();

  // details
  if (r.selCommit && (r.commits.some((c) => c.hash === r.selCommit) || r._stashSel === r.selCommit)) {
    if (keep && r.commitDetails?.hash === r.selCommit) renderDetails(detailsEl, r, true);
    else selectCommit(r, r.selCommit, true);
  } else if (r.commits.length) {
    selectCommit(r, r.commits[0].hash, true);
  } else {
    detailsEl.replaceChildren(h('div.empty', icon('history'), t('Még nincs commit ebben a repository-ban.')));
    dv.clear('');
  }
}

function ensureVisible(scroll, i) {
  const y = i * ROW_H;
  if (y < scroll.scrollTop) scroll.scrollTop = y;
  else if (y + ROW_H > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = y + ROW_H - scroll.clientHeight;
}

function refLabels(c, r) {
  if (!c.refs?.length) return '';
  const remotes = (r.refs?.remotes || []).map((x) => x.name + '/');
  let out = '';
  for (let ref of c.refs) {
    if (ref.startsWith('HEAD -> ')) {
      out += `<span class="rl head" title="HEAD">${esc(ref.slice(8))}</span>`;
    } else if (ref === 'HEAD') {
      out += `<span class="rl head">HEAD</span>`;
    } else if (ref.startsWith('tag: ')) {
      out += `<span class="rl tag" title="tag">${esc(ref.slice(5))}</span>`;
    } else if (remotes.some((p) => ref.startsWith(p))) {
      if (ref.endsWith('/HEAD')) continue;
      out += `<span class="rl remote" title="${t('remote ág')}">${esc(ref)}</span>`;
    } else if (ref !== 'refs/stash') {
      out += `<span class="rl local" title="${t('lokális ág')}">${esc(ref)}</span>`;
    }
  }
  return out;
}

function rowHtml(c, i, gw, headHash, r) {
  const y = i * ROW_H;
  if (c.wip) {
    const st = r.status;
    const n = st.staged.length + st.unstaged.length + st.conflicted.length;
    return `<div class="crow wip" data-i="${i}" style="top:${y}px"><span class="g" style="width:${gw}px;display:flex;align-items:center;padding-left:6px;color:var(--text-dim)">◌</span><span class="subj"><span class="rl local">${esc(t('Lokális változások'))}</span><span class="t">${esc(t('{0} fájl nincs commitolva', n))}</span></span><span class="au"></span><span class="hs"></span><span class="dt"></span></div>`;
  }
  const sel = c.hash === r.selCommit ? ' sel' : '';
  const match = r.matches ? (r.matches.has(c.hash) ? ' match' : ' dim') : '';
  return `<div class="crow${sel}${match}" data-i="${i}" style="top:${y}px">${graphSvg(c, gw, c.hash === headHash)}<span class="subj">${refLabels(c, r)}<span class="t">${esc(c.subject)}</span></span><span class="au" title="${esc(c.email)}">${esc(c.author)}</span><span class="hs mono">${short(c.hash)}</span><span class="dt" title="${fmtDate(c.time, true)}">${relTime(c.time)}</span></div>`;
}

async function runSearch(r, q) {
  r.search = q;
  if (!q.trim()) { r.matches = null; renderContent(true); return; }
  setBusy(true, t('Keresés…'));
  try {
    const hashes = await invoke('search_commits', { repo: r.path, query: q, mode: r.searchMode });
    r.matches = new Set(hashes);
    renderContent(true);
    if (hashes.length) jumpMatch(r, 1, true);
    else toast(t('Nincs találat.'));
  } catch (e) { toast(e, 'err'); }
  finally { setBusy(false); }
}

function jumpMatch(r, dir, first) {
  const rows = r._rows || [];
  const cur = first ? -1 : rows.findIndex((x) => x.hash === r.selCommit);
  let i = cur;
  for (let k = 0; k < rows.length; k++) {
    i = (i + dir + rows.length) % rows.length;
    if (rows[i].hash && r.matches.has(rows[i].hash)) break;
  }
  if (rows[i]?.hash && r.matches.has(rows[i].hash)) {
    selectCommit(r, rows[i].hash);
    if (r._scroll) { r._scroll.scrollTop = Math.max(0, i * ROW_H - r._scroll.clientHeight / 2); r._draw(); }
  } else if (r.matches.size) toast(t('A találatok a betöltött commitokon kívül esnek (növeld a log limitet a beállításokban).'));
}

function showRefInHistory(hash, name) {
  const r = cur();
  if (r.view !== 'history' || r.logPath) { r.view = 'history'; r.logPath = ''; renderAll(); }
  const i = (r._rows || []).findIndex((x) => x.hash === hash);
  selectCommit(r, hash);
  if (i >= 0 && r._scroll) { r._scroll.scrollTop = Math.max(0, i * ROW_H - r._scroll.clientHeight / 3); r._draw(); }
  else if (i < 0) toast(t('{0}: a commit nincs a betöltött listában.', name));
  renderSidebar();
}

async function selectCommit(r, hash, silent) {
  r.selCommit = hash;
  r.blame = null;
  const detailsEl = document.querySelector('.details');
  if (!detailsEl) return;
  if (!silent) r._draw && r._draw();
  detailsEl.replaceChildren(h('div.empty', t('Betöltés…')));
  try {
    const d = await invoke('commit_details', { repo: r.path, hash });
    if (r.selCommit !== hash) return;
    r.commitDetails = d;
    renderDetails(detailsEl, r);
  } catch (e) {
    detailsEl.replaceChildren(h('div.empty', String(e)));
  }
}

function renderDetails(el, r, keep) {
  const d = r.commitDetails;
  const dv = diffView();
  const lines = d.message.split('\n');
  const msg = h('div.msg', h('div.s', lines[0]), lines.slice(1).join('\n').replace(/^\n+/, ''));
  const link = (hash) => h('a', { on: { click: () => showRefInHistory(hash, short(hash)) } }, short(hash));
  const meta = h('div.cmeta',
    h('div.author-line', avatar(d.author, d.author_email), h('div', h('div.who', d.author, ' ', h('span', { style: { color: 'var(--text-dim)', fontWeight: 400 } }, `<${d.author_email}>`)), h('div.when', fmtDate(d.author_time, true) + ' · ' + relTime(d.author_time)))),
    msg,
    h('table',
      h('tr', h('td', 'Commit'), h('td.mono', d.hash, ' ', h('a', { title: t('Másolás'), on: { click: () => copy(d.hash) } }, '⧉'))),
      h('tr', h('td', t('Szülők')), h('td.mono', d.parents.length ? d.parents.flatMap((p, i) => [i ? ', ' : '', link(p)]) : t('(gyökér commit)'))),
      d.committer !== d.author || d.committer_time !== d.author_time ? h('tr', h('td', 'Committer'), h('td', `${d.committer} · ${fmtDate(d.committer_time, true)}`)) : null,
      d.refs.length ? h('tr', h('td', t('Refek')), h('td', d.refs.join(', '))) : null),
    h('div', { style: { marginTop: '8px', display: 'flex', gap: '6px' } },
      h('button.btn.sm.ai', { on: { click: () => aiCommit(r, d.hash) } }, icon('sparkle'), t('AI magyarázat')),
      h('button.btn.sm', { on: { click: () => { r.compare = { from: d.parents[0] || '', to: d.hash, mergeBase: false, result: null }; setView('compare'); runCompare(r); } } }, icon('compare'), t('Összehasonlítás'))),
  );
  const files = h('div', d.files.map((f) => fileRow(r, 'commit', f, (x) => selectCommitFile(r, d, x))));
  el.replaceChildren(h('div.pane-h', t('Commit részletek'), h('span.sub', t('{0} fájl', d.files.length))), h('div.details-body', meta, files));
  const sel = (keep && r.selFile?.list === 'commit' && d.files.find((f) => f.path === r.selFile.path)) || d.files[0];
  if (sel) { if (!(keep && dv._key === `${d.hash}|${sel.path}`)) selectCommitFile(r, d, sel); }
  else dv.clear(t('A commit nem tartalmaz fájl változást.'));
}

function selectCommitFile(r, d, f) {
  r.selFile = { list: 'commit', path: f.path };
  document.querySelectorAll('.details .file').forEach((el) => el.classList.toggle('sel', el.title === f.path || el.title.endsWith('→ ' + f.path)));
  const dv = diffView();
  dv._key = `${d.hash}|${f.path}`;
  dv.show({
    path: f.path, oldPath: f.old_path,
    load: (context, ignoreWs) => invoke('diff', { repo: r.path, req: { mode: 'range', from: d.base, to: d.hash, path: f.path, old_path: f.old_path, context, ignore_ws: ignoreWs } }),
    image: {
      old: () => (f.status === 'A' ? Promise.resolve(null) : invoke('file_content', { repo: r.path, rev: d.base, path: f.old_path || f.path })),
      new: () => (f.status === 'D' ? Promise.resolve(null) : invoke('file_content', { repo: r.path, rev: d.hash, path: f.path })),
    },
    extra: [
      h('button.btn.sm', { title: t('Fájl előzmények'), on: { click: () => fileHistory(f.path) } }, icon('history')),
      f.status !== 'D' ? h('button.btn.sm', { title: t('Blame ennél a commitnál'), on: { click: () => showBlame(f.path, d.hash) } }, icon('blame')) : null,
    ],
    onAi: (text) => aiPanel(t('AI elemzés – {0} @ {1}', basename(f.path), short(d.hash)), (q) => invoke('ai_analyze', { repo: r.path, req: { kind: 'file', path: f.path, diff_text: text, question: q } })),
  });
}

async function showStash(s) {
  const r = cur();
  if (r.view !== 'history') { r.view = 'history'; renderAll(); }
  r._stashSel = s.hash;
  selectCommit(r, s.hash);
}

function fileHistory(path) {
  const r = cur();
  r.logPath = path;
  r.logRev = '';
  r.selCommit = null;
  setView('history', true);
}

async function showBlame(path, rev) {
  const r = cur();
  r.blame = { path, rev };
  const dv = diffView();
  dv.opts = null;
  dv._key = null;
  dv.el.replaceChildren(h('div.diff-toolbar', h('span.path', `Blame: ${path}`), rev ? h('span.sub', ` @ ${short(rev)}`) : null, h('span.grow'),
    h('button.btn.sm', { on: { click: () => { r.blame = null; renderContent(); } } }, t('Bezárás'))), h('div.diff-body', h('div.diff-msg', t('Betöltés…'))));
  try {
    const lines = await invoke('blame', { repo: r.path, path, rev: rev || null });
    dv.el.replaceChild(h('div.diff-body', renderBlame(lines, (hash) => showRefInHistory(hash, short(hash)))), dv.el.lastChild);
  } catch (e) {
    dv.el.replaceChild(h('div.diff-body', h('div.diff-msg', String(e))), dv.el.lastChild);
  }
}

// ── compare ──
function renderCompare(el, r, keep) {
  const dv = diffView();
  const c = r.compare;
  const opts = refOptions(r, { tags: true, head: true });
  const go = () => runCompare(r);
  const from = combo({ value: c.from, options: opts, placeholder: t('Honnan (pl. main)'), onInput: (v) => (c.from = v.trim()), onEnter: go });
  const to = combo({ value: c.to, options: opts, placeholder: t('Hová (üres = working tree)'), onInput: (v) => (c.to = v.trim()), onEnter: go });
  const mb = h('input', { type: 'checkbox', checked: c.mergeBase, on: { change: (e) => (c.mergeBase = e.target.checked) } });
  const bar = h('div.compare-bar', h('b', t('Összehasonlítás')), from,
    h('button.icon-btn', { title: t('Csere'), on: { click: () => { [c.from, c.to] = [c.to, c.from]; renderContent(); } } }, '⇄'), to,
    h('label.chk', { title: t('A "Honnan" helyett a két revízió közös ősét (merge-base) használja – azt mutatja, mit hozna be a "Hová" ág') }, mb, t('Merge-base (A...B)')),
    h('button.btn.primary', { on: { click: () => runCompare(r) } }, icon('compare'), t('Összehasonlítás')),
    h('button.btn.ai', { disabled: !c.result || null, on: { click: () => aiCompare(r) } }, icon('sparkle'), t('AI összehasonlítás')));
  const leftBody = h('div.details-body');
  const left = h('div.details', h('div.pane-h', t('Változott fájlok'), c.result ? h('span.sub', c.result.files.length) : null), leftBody);
  const vs = h('div.splitter-v');
  el.replaceChildren(h('div.history', bar, h('div.history-bottom', { style: { height: 'auto', flex: 1, borderTop: 0 } }, left, vs, h('div.changes-right', dv.el))));
  splitter(vs, left, { min: 220, max: 1200, key: 'gs.compareW' });
  if (!c.result) {
    leftBody.replaceChildren(h('div.empty', icon('compare'), t('Válassz két revíziót (ág, tag, commit hash), majd nyomd meg az Összehasonlítás gombot.')));
    dv.clear('');
    return;
  }
  const res = c.result;
  const summary = h('div.compare-summary',
    h('div', t('{0} → {1}: {2} fájl', res.from, res.to || 'working tree', res.files.length)),
    res.ahead.length ? h('details', h('summary', t('{0} commit csak itt: {1}', res.ahead.length, res.to)), h('ul', res.ahead.map((x) => h('li', x)))) : null,
    res.behind.length ? h('details', h('summary', t('{0} commit csak itt: {1}', res.behind.length, res.from)), h('ul', res.behind.map((x) => h('li', x)))) : null);
  leftBody.replaceChildren(summary, ...res.files.map((f) => fileRow(r, 'compare', f, (x) => selectCompareFile(r, x))));
  const sel = (keep && r.selFile?.list === 'compare' && res.files.find((f) => f.path === r.selFile.path)) || res.files[0];
  if (sel) selectCompareFile(r, sel);
  else dv.clear(t('Nincs különbség.'));
}

async function runCompare(r) {
  const c = r.compare;
  if (!c.from) { toast(t('Add meg a "Honnan" revíziót.'), 'err'); return; }
  setBusy(true, t('Összehasonlítás…'));
  try {
    c.result = await invoke('compare', { repo: r.path, from: c.from, to: c.to, mergeBase: c.mergeBase });
  } catch (e) { toast(e, 'err'); c.result = null; }
  finally { setBusy(false); }
  renderContent();
}

function selectCompareFile(r, f) {
  const res = r.compare.result;
  r.selFile = { list: 'compare', path: f.path };
  document.querySelectorAll('.details .file').forEach((el) => el.classList.toggle('sel', el.title === f.path || el.title.endsWith('→ ' + f.path)));
  diffView().show({
    path: f.path, oldPath: f.old_path,
    load: (context, ignoreWs) => invoke('diff', { repo: r.path, req: { mode: 'range', from: res.base, to: res.to || null, path: f.path, old_path: f.old_path, context, ignore_ws: ignoreWs } }),
    image: {
      old: () => (f.status === 'A' ? Promise.resolve(null) : invoke('file_content', { repo: r.path, rev: res.base, path: f.old_path || f.path })),
      new: () => (f.status === 'D' ? Promise.resolve(null) : invoke('file_content', { repo: r.path, rev: res.to || '', path: f.path })),
    },
    onAi: (text) => aiPanel(t('AI – {0}: {1} → {2}', basename(f.path), res.from, res.to || 'working tree'), (q) => invoke('ai_analyze', { repo: r.path, req: { kind: 'file', path: f.path, diff_text: text, question: q } })),
  });
}

function aiCompare(r) {
  const c = r.compare;
  aiPanel(t('AI összehasonlítás: {0} → {1}', c.from, c.to || 'working tree'), (q) => invoke('ai_analyze', { repo: r.path, req: { kind: 'range', from: c.from, to: c.to, merge_base: c.mergeBase, question: q } }));
}

function aiCommit(r, hash) {
  aiPanel(t('AI magyarázat – {0}', short(hash)), (q) => invoke('ai_analyze', { repo: r.path, req: { kind: 'commit', hash, question: q } }));
}

// ───────────────────────── AI panel ─────────────────────────

function aiPanel(title, run) {
  document.querySelector('.ai-panel')?.remove();
  if (!aiKey()) {
    toast(t('Az AI funkciókhoz add meg az API kulcsot a Beállításokban.'), 'err');
    settingsDlg();
    return;
  }
  // Summary only: the panel has no follow-up question box.
  const body = h('div.ai-body');
  const summarize = async () => {
    const wait = h('div.ai-thinking', icon('sparkle', 'spin'), t('Az AI elemzi a változásokat…'));
    body.append(wait);
    try {
      const res = await run(null);
      wait.remove();
      const out = h('div', { html: markdown(res.text) });
      body.append(out);
      if (res.truncated) body.append(h('div.ai-q', t('Megjegyzés: a diff túl nagy volt, csak az eleje került elemzésre.')));
      out.scrollIntoView({ block: 'start' });
    } catch (e) {
      wait.replaceWith(h('div', { style: { color: 'var(--danger)' } }, String(e)));
    }
  };
  const panel = h('div.ai-panel',
    h('div.pane-h', h('span.spark', icon('sparkle')), title, h('span.grow'),
      h('button.icon-btn', { title: t('Szöveg másolása'), on: { click: () => copy(body.innerText) } }, icon('copy')),
      h('button.icon-btn', { title: t('Bezárás'), on: { click: () => panel.remove() } }, icon('close'))),
    body);
  document.body.append(panel);
  summarize();
}

// ───────────────────────── console ─────────────────────────

function consoleLog(repo, args, out, err) {
  repo._log = repo._log || [];
  repo._log.push({ cmd: 'git ' + args.join(' '), out, err });
  if (repo._log.length > 200) repo._log.shift();
  const box = document.querySelector('.console-out');
  if (box && repo === cur()) renderConsoleOut(box, repo);
}

function renderConsoleOut(box, repo) {
  box.innerHTML = (repo._log || []).map((l) => `<div class="cmd">$ ${esc(l.cmd)}</div><div class="${l.err ? 'err' : ''}">${esc(l.out)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

function toggleConsole() {
  const ex = document.querySelector('.console');
  if (ex) { ex.remove(); return; }
  const r = cur();
  if (!r) return;
  const out = h('div.console-out');
  const hist = [];
  let hi = -1;
  const inp = h('input.inp', { placeholder: t('git parancs, pl. log --oneline -5   (a "git" előtag opcionális)'), spellcheck: 'false' });
  inp.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowUp') { if (hist.length) { hi = Math.max(0, hi < 0 ? hist.length - 1 : hi - 1); inp.value = hist[hi]; } e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { if (hi >= 0) { hi = Math.min(hist.length, hi + 1); inp.value = hist[hi] || ''; } e.preventDefault(); return; }
    if (e.key !== 'Enter' || !inp.value.trim()) return;
    const line = inp.value.trim();
    hist.push(line); hi = -1;
    inp.value = '';
    let args = shellSplit(line);
    if (args[0] === 'git') args = args.slice(1);
    await op('git ' + args.join(' '), args, { quiet: true });
    inp.focus();
  });
  const c = h('div.console', h('div.pane-h', icon('console'), t('Git konzol'), h('span.sub', r.path), h('span.grow'),
    h('button.icon-btn', { title: t('Törlés'), on: { click: () => { r._log = []; renderConsoleOut(out, r); } } }, icon('trash')),
    h('button.icon-btn', { on: { click: () => c.remove() } }, icon('close'))), out, h('div.console-in', h('span.mono', 'git'), inp));
  document.body.append(c);
  renderConsoleOut(out, r);
  inp.focus();
}

// ───────────────────────── menus ─────────────────────────

const copy = (txt) => navigator.clipboard.writeText(txt).then(() => toast(t('Vágólapra másolva'), 'ok', 1500));

function localBranchMenu(e, b) {
  const r = cur();
  const head = r.refs.head;
  contextMenu(e, [
    { header: b.name },
    { label: 'Checkout', icon: 'check', disabled: b.current, action: () => checkout(b.name) },
    '-',
    { label: t('Merge "{0}" → "{1}"', b.name, head), icon: 'merge', disabled: b.current || !head, action: () => mergeDlg(b.name) },
    { label: t('Rebase "{0}" erre: "{1}"', head, b.name), icon: 'branch', disabled: b.current || !head, action: () => rebase(b.name) },
    b.current ? { label: 'Pull', icon: 'pull', action: () => pullDlg() } : { label: t('Fast-forward az upstream-re'), icon: 'pull', disabled: !b.upstream || !b.behind, action: () => op(`Fast-forward ${b.name}`, ['fetch', '.', `${b.upstream}:${b.name}`]) },
    { label: 'Push', icon: 'push', action: () => pushDlg(b.name) },
    '-',
    { label: t('Új ág innen…'), icon: 'plus', action: () => newBranchDlg(b.name) },
    { label: t('Átnevezés…'), icon: 'changes', action: () => renameBranchDlg(b) },
    { label: t('Upstream beállítása…'), icon: 'cloud', action: () => upstreamDlg(b) },
    { label: t('Összehasonlítás az aktuális ággal'), icon: 'compare', disabled: b.current, action: () => { r.compare = { from: head, to: b.name, mergeBase: true, result: null }; setView('compare'); runCompare(r); } },
    { label: t('AI: mit hoz be ez az ág?'), icon: 'sparkle', disabled: b.current, action: () => aiPanel(t('AI: {0} ↔ {1}', head, b.name), (q) => invoke('ai_analyze', { repo: r.path, req: { kind: 'range', from: head, to: b.name, merge_base: true, question: q } })) },
    { label: t('Név másolása'), icon: 'copy', action: () => copy(b.name) },
    '-',
    { label: t('Törlés…'), icon: 'trash', danger: true, disabled: b.current, action: () => deleteBranch(b) },
  ]);
}

function remoteBranchMenu(e, b, remote) {
  const r = cur();
  const head = r.refs.head;
  const short_ = b.name.slice(remote.length + 1);
  contextMenu(e, [
    { header: b.name },
    { label: t('Checkout (lokális "{0}" ág)', short_), icon: 'check', action: () => checkoutRemote(b.name) },
    { label: t('Merge "{0}" → "{1}"', b.name, head), icon: 'merge', disabled: !head, action: () => mergeDlg(b.name) },
    { label: t('Rebase "{0}" erre: "{1}"', head, b.name), icon: 'branch', disabled: !head, action: () => rebase(b.name) },
    '-',
    { label: t('Új ág innen…'), icon: 'plus', action: () => newBranchDlg(b.name) },
    { label: t('Összehasonlítás az aktuális ággal'), icon: 'compare', action: () => { r.compare = { from: head || 'HEAD', to: b.name, mergeBase: true, result: null }; setView('compare'); runCompare(r); } },
    { label: t('AI: mit hoz be ez az ág?'), icon: 'sparkle', action: () => aiPanel(t('AI: {0} ↔ {1}', head, b.name), (q) => invoke('ai_analyze', { repo: r.path, req: { kind: 'range', from: head || 'HEAD', to: b.name, merge_base: true, question: q } })) },
    { label: t('Név másolása'), icon: 'copy', action: () => copy(b.name) },
    '-',
    { label: t('Törlés a remote-on…'), icon: 'trash', danger: true, action: async () => {
      if (await confirmDlg(t('Remote ág törlése'), t('Törlöd a(z) "{0}" ágat a(z) "{1}" remote-on?', short_, remote), t('Törlés'), true)) op(t('Remote ág törlése: {0}', b.name), ['push', remote, '--delete', short_]);
    } },
  ]);
}

function tagMenu(e, tag) {
  const r = cur();
  contextMenu(e, [
    { header: tag.name },
    { label: 'Checkout (detached)', icon: 'check', action: () => checkout(tag.name) },
    { label: t('Új ág innen…'), icon: 'plus', action: () => newBranchDlg(tag.name) },
    { label: 'Push tag…', icon: 'push', action: async () => { const rm = await pickRemote(); if (rm) op(`Push tag ${tag.name}`, ['push', rm, `refs/tags/${tag.name}`]); } },
    { label: t('Összehasonlítás HEAD-del'), icon: 'compare', action: () => { r.compare = { from: tag.name, to: 'HEAD', mergeBase: false, result: null }; setView('compare'); runCompare(r); } },
    { label: t('Név másolása'), icon: 'copy', action: () => copy(tag.name) },
    '-',
    { label: t('Törlés (lokális)…'), icon: 'trash', danger: true, action: async () => { if (await confirmDlg(t('Tag törlése'), t('Törlöd a(z) "{0}" taget?', tag.name), t('Törlés'), true)) op(t('Tag törlése {0}', tag.name), ['tag', '-d', tag.name]); } },
    { label: t('Törlés a remote-on…'), icon: 'trash', danger: true, action: async () => { const rm = await pickRemote(); if (rm && await confirmDlg(t('Remote tag törlése'), t('Törlöd a(z) "{0}" taget a(z) "{1}" remote-on?', tag.name, rm), t('Törlés'), true)) op(t('Remote tag törlése {0}', tag.name), ['push', rm, '--delete', `refs/tags/${tag.name}`]); } },
  ]);
}

function stashMenu(e, s) {
  contextMenu(e, [
    { header: s.name },
    { label: 'Apply', icon: 'check', action: () => op(`Stash apply ${s.name}`, ['stash', 'apply', s.name]) },
    { label: 'Pop', icon: 'pop', action: () => op(`Stash pop ${s.name}`, ['stash', 'pop', s.name]) },
    { label: t('Ág létrehozása a stash-ből…'), icon: 'branch', action: async () => {
      const v = await formDlg(t('Ág stash-ből'), [{ name: 'name', label: t('Ág neve') }], t('Létrehozás'));
      if (v?.name) op('Stash branch', ['stash', 'branch', v.name.trim(), s.name]);
    } },
    '-',
    { label: 'Drop…', icon: 'trash', danger: true, action: async () => { if (await confirmDlg(t('Stash törlése'), t('Törlöd: {0} ({1})?', s.name, s.message), t('Törlés'), true)) op(`Stash drop ${s.name}`, ['stash', 'drop', s.name]); } },
  ]);
}

function commitMenu(e, r, c) {
  const head = r.refs?.head;
  const branches = c.refs.map((x) => x.replace(/^HEAD -> /, '')).filter((x) => x !== 'HEAD' && !x.startsWith('tag: '));
  contextMenu(e, [
    { header: `${short(c.hash)} ${c.subject.slice(0, 50)}` },
    ...branches.slice(0, 4).map((b) => ({ label: `Checkout "${b}"`, icon: 'check', action: () => (r.refs.remote.some((x) => x.name === b) ? checkoutRemote(b) : checkout(b)) })),
    { label: 'Checkout commit (detached HEAD)', icon: 'check', action: () => checkout(c.hash) },
    '-',
    { label: t('Új ág innen…'), icon: 'branch', action: () => newBranchDlg(c.hash) },
    { label: t('Új tag innen…'), icon: 'tag', action: () => tagDlg(c.hash) },
    '-',
    { label: t('Merge → "{0}"', head), icon: 'merge', disabled: !head, action: () => mergeDlg(branches[0] || c.hash) },
    { label: t('Rebase "{0}" erre', head), icon: 'branch', disabled: !head, action: () => rebase(c.hash) },
    { label: 'Cherry-pick', icon: 'commit', action: () => op(`Cherry-pick ${short(c.hash)}`, ['cherry-pick', ...(c.parents.length > 1 ? ['-m', '1'] : []), c.hash]) },
    { label: 'Revert', icon: 'undo', action: () => op(`Revert ${short(c.hash)}`, ['revert', '--no-edit', ...(c.parents.length > 1 ? ['-m', '1'] : []), c.hash]) },
    { label: t('"{0}" reset ide…', head || 'HEAD'), icon: 'undo', danger: true, action: () => resetDlg(c) },
    '-',
    { label: t('Összehasonlítás a working tree-vel'), icon: 'compare', action: () => { r.compare = { from: c.hash, to: '', mergeBase: false, result: null }; setView('compare'); runCompare(r); } },
    { label: t('Összehasonlítás HEAD-del'), icon: 'compare', action: () => { r.compare = { from: c.hash, to: 'HEAD', mergeBase: false, result: null }; setView('compare'); runCompare(r); } },
    { label: t('AI magyarázat'), icon: 'sparkle', action: () => aiCommit(r, c.hash) },
    '-',
    { label: t('Hash másolása'), icon: 'copy', action: () => copy(c.hash) },
    { label: t('Üzenet másolása'), icon: 'copy', action: () => copy(c.subject) },
  ]);
}

// ───────────────────────── operations & dialogs ─────────────────────────

async function checkout(ref) {
  const r = cur();
  const dirty = r.status && (r.status.staged.length || r.status.unstaged.filter((f) => f.status !== '?').length);
  if (dirty) {
    const choice = await modal({
      title: `Checkout: ${ref}`,
      body: h('div.desc', t('Vannak nem commitolt változások. Mi legyen velük?')),
      buttons: [
        { label: t('Mégse'), value: null },
        { label: 'Stash → checkout → pop', value: 'stash' },
        { label: t('Megtartás (próbáld)'), value: 'keep', primary: true },
      ],
    });
    if (!choice) return;
    if (choice === 'stash') {
      if ((await op('Stash', ['stash', 'push', '-u', '-m', `GitStar auto-stash (checkout ${ref})`], { quiet: true, refresh: false })) == null) return;
      const ok = await op(`Checkout ${ref}`, ['checkout', ref], { refresh: false });
      await op('Stash pop', ['stash', 'pop'], { quiet: ok == null });
      return;
    }
  }
  await op(`Checkout ${ref}`, ['checkout', ref]);
}

async function checkoutRemote(full) {
  const r = cur();
  const name = full.slice(full.indexOf('/') + 1);
  if (r.refs.local.some((b) => b.name === name)) {
    const b = r.refs.local.find((x) => x.name === name);
    await checkout(name);
    if (b.upstream === full && b.behind) toast(t('"{0}" {1} commit-tal le van maradva – használd a Pull-t.', name, b.behind));
    return;
  }
  await op(`Checkout ${full}`, ['checkout', '-b', name, '--track', full]);
}

async function doFetch() {
  await op('Fetch', ['fetch', '--all', '--prune', '--tags']);
}

async function pickRemote() {
  const rs = cur().refs?.remotes || [];
  if (rs.length <= 1) return rs[0]?.name || null;
  const v = await formDlg('Remote', [{ name: 'remote', label: 'Remote', type: 'select', options: rs.map((x) => x.name) }], 'OK');
  return v?.remote || null;
}

const pullModeName = () => ({ merge: 'merge', rebase: 'rebase', ff: 'fast-forward', ask: t('kérdez') }[S.settings?.pull_mode || 'merge'] || 'merge');

/** Pull button: runs with the remembered mode; the dialog only when set to "ask". */
async function doPull() {
  const mode = S.settings.pull_mode || 'merge';
  if (mode === 'ask') return pullDlg();
  const r = cur();
  if (!r.status.upstream && !(r.refs?.remotes || []).length) { toast(t('Nincs beállított remote.'), 'err'); return; }
  await runPull(mode, S.settings.pull_autostash !== false);
}

async function runPull(mode, autostash) {
  const args = ['pull', '--progress'];
  if (mode === 'rebase') args.push('--rebase'); else if (mode === 'ff') args.push('--ff-only'); else args.push('--no-rebase');
  if (autostash) args.push('--autostash');
  await op('Pull', args);
}

async function pullDlg() {
  const r = cur();
  const st = r.status;
  if (!st.upstream && !(r.refs?.remotes || []).length) { toast(t('Nincs beállított remote.'), 'err'); return; }
  const saved = S.settings.pull_mode && S.settings.pull_mode !== 'ask' ? S.settings.pull_mode : 'merge';
  const v = await formDlg('Pull', [
    { name: 'mode', label: t('Mód'), type: 'select', value: saved, options: [{ value: 'merge', label: t('Merge (alapértelmezett)') }, { value: 'rebase', label: 'Rebase' }, { value: 'ff', label: t('Csak fast-forward') }] },
    { name: 'autostash', label: t('Lokális változások automatikus stash-elése (--autostash)'), type: 'checkbox', value: S.settings.pull_autostash !== false },
    { name: 'remember', label: t('Emlékezzen erre, a Pull gomb ne kérdezzen többet'), type: 'checkbox', value: true },
  ], 'Pull', st.upstream ? `${st.branch} ← ${st.upstream}` : t('A(z) "{0}" ágnak nincs upstream-je.', st.branch));
  if (!v) return;
  if (v.remember) {
    Object.assign(S.settings, { pull_mode: v.mode, pull_autostash: !!v.autostash });
    saveSettings();
  }
  await runPull(v.mode, v.autostash);
}

/** Push button: push the current branch straight to its upstream (or set one up on the first push). */
async function quickPush() {
  const r = cur();
  const remotes = r.refs?.remotes || [];
  if (!remotes.length) { toast(t('Nincs remote. Adj hozzá egyet a Remote-ok szekcióban.'), 'err'); return; }
  const b = r.refs.local.find((x) => x.name === r.refs.head);
  if (!b) { toast(t('Detached HEAD-ből nem lehet push-olni ágat. Hozz létre ágat.'), 'err'); return; }
  const rem = b.upstream && remotes.find((x) => b.upstream.startsWith(x.name + '/'));
  if (rem && !b.gone) {
    await op('Push', ['push', '--progress', rem.name, `${b.name}:${b.upstream.slice(rem.name.length + 1)}`]);
  } else {
    // first push of this branch: same name on origin (or the only remote), with -u
    const target = (remotes.find((x) => x.name === 'origin') || remotes[0]).name;
    await op('Push', ['push', '--progress', '-u', target, `${b.name}:${b.name}`]);
  }
}

async function pushDlg(branch) {
  const r = cur();
  const remotes = r.refs?.remotes || [];
  if (!remotes.length) { toast(t('Nincs remote. Adj hozzá egyet a Remote-ok szekcióban.'), 'err'); return; }
  const b = r.refs.local.find((x) => x.name === (branch || r.refs.head));
  if (!b) { toast(t('Detached HEAD-ből nem lehet push-olni ágat. Hozz létre ágat.'), 'err'); return; }
  const upRemote = b.upstream ? b.upstream.split('/')[0] : remotes[0].name;
  const v = await formDlg('Push', [
    { name: 'remote', label: 'Remote', type: 'select', value: upRemote, options: remotes.map((x) => x.name) },
    { name: 'target', label: t('Cél ág'), type: 'combo', value: b.upstream ? b.upstream.slice(upRemote.length + 1) : b.name,
      options: [...new Set([...remoteBranches(r, upRemote), ...r.refs.local.map((x) => x.name)])] },
    { name: 'upstream', label: t('Upstream beállítása (-u)'), type: 'checkbox', value: !b.upstream },
    { name: 'tags', label: t('Tagek push-olása is (--follow-tags)'), type: 'checkbox', value: false },
    { name: 'force', label: 'Force push (--force-with-lease)', type: 'checkbox', value: false },
  ], 'Push', t('Ág: {0}', b.name) + (b.ahead ? t(' · {0} commit vár push-ra', b.ahead) : ''));
  if (!v) return;
  if (v.force && !(await confirmDlg('Force push', t('A force push felülírhatja a remote ág történetét. Biztos?'), 'Force push', true))) return;
  const args = ['push', '--progress'];
  if (v.upstream) args.push('-u');
  if (v.tags) args.push('--follow-tags');
  if (v.force) args.push('--force-with-lease');
  args.push(v.remote, `${b.name}:${v.target.trim() || b.name}`);
  await op('Push', args);
}

// ── branch pickers ──

/** Combo-box options for refs: local branches, remote branches, tags (each optional), grouped. */
function refOptions(r, { local = true, remote = true, tags = false, head = false, exclude = [] } = {}) {
  const x = r.refs || { local: [], remote: [], tags: [] };
  const out = [];
  const add = (names, group) => { for (const n of names) if (!exclude.includes(n)) out.push({ value: n, group }); };
  if (head) add(['HEAD'], 'HEAD');
  if (local) add(x.local.map((b) => b.name), t('Lokális ágak'));
  if (remote) add(x.remote.map((b) => b.name).filter((n) => !n.endsWith('/HEAD')), t('Remote ágak'));
  if (tags) add(x.tags.map((tg) => tg.name), 'Tags');
  return out;
}

/** Branch names on one remote (without the "origin/" prefix). */
const remoteBranches = (r, remote) => (r.refs?.remote || []).map((b) => b.name)
  .filter((n) => n.startsWith(remote + '/') && n !== remote + '/HEAD').map((n) => n.slice(remote.length + 1));

// ── pull request ──

/** Web base URL ("https://host/owner/repo") and hosting kind of a remote URL. */
function remoteWeb(url) {
  let u = String(url || '').trim().replace(/\/+$/, '').replace(/\.git$/, '');
  let m;
  if ((m = u.match(/^(?:[^@/]+@)?ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+)$/)) || (m = u.match(/^(?:ssh:\/\/)?[^@]+@ssh\.dev\.azure\.com(?::\d+)?\/v3\/([^/]+)\/([^/]+)\/(.+)$/)))
    return { base: `https://dev.azure.com/${m[1]}/${m[2]}/_git/${m[3]}`, kind: 'azure' };
  if ((m = u.match(/^(?:ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/))) u = `https://${m[1]}/${m[2]}`;
  else if ((m = u.match(/^[^@/]+@([^:/]+):(?!\d+\/)(.+)$/))) u = `https://${m[1]}/${m[2]}`;
  else if ((m = u.match(/^(https?):\/\/(?:[^@/]+@)?(.+)$/))) u = `${m[1]}://${m[2]}`;
  else return null;
  const host = new URL(u).hostname;
  const kind = /dev\.azure\.com$|visualstudio\.com$/.test(host) ? 'azure' : /gitlab/.test(host) ? 'gitlab' : /bitbucket/.test(host) ? 'bitbucket' : 'github';
  return { base: u, kind };
}

function prUrl(web, source, target) {
  const e = encodeURIComponent;
  switch (web.kind) {
    case 'gitlab': return `${web.base}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${e(source)}&merge_request%5Btarget_branch%5D=${e(target)}`;
    case 'bitbucket': return `${web.base}/pull-requests/new?source=${e(source)}&dest=${e(target)}`;
    case 'azure': return `${web.base}/pullrequestcreate?sourceRef=${e(source)}&targetRef=${e(target)}`;
    // GitHub, and Gitea / Forgejo / Codeberg which use the same compare page
    default: return `${web.base}/compare/${target.split('/').map(e).join('/')}...${source.split('/').map(e).join('/')}?expand=1`;
  }
}

async function prDlg() {
  const r = cur();
  const remotes = r.refs?.remotes || [];
  if (!remotes.length) { toast(t('Nincs remote. Adj hozzá egyet a Remote-ok szekcióban.'), 'err'); return; }
  const b = r.refs.local.find((x) => x.name === r.refs.head);
  if (!b) { toast(t('Detached HEAD-ből nem lehet pull requestet nyitni. Hozz létre ágat.'), 'err'); return; }
  const remote = b.upstream && remotes.some((x) => b.upstream.startsWith(x.name + '/')) ? b.upstream.split('/')[0] : (remotes.find((x) => x.name === 'origin') || remotes[0]).name;
  const source = b.upstream && b.upstream.startsWith(remote + '/') ? b.upstream.slice(remote.length + 1) : b.name;
  const targets = remoteBranches(r, remote).filter((n) => n !== source);
  const target = ['main', 'master', 'develop', 'development'].find((n) => targets.includes(n)) || targets[0] || 'main';
  const needPush = !b.upstream || b.gone || b.ahead > 0;
  const fields = [];
  if (remotes.length > 1) fields.push({ name: 'remote', label: 'Remote', type: 'select', value: remote, options: remotes.map((x) => x.name) });
  fields.push({ name: 'target', label: t('Cél ág (ebbe merge-öl)'), type: 'combo', value: target, options: targets });
  if (needPush) fields.push({ name: 'push', label: b.upstream && !b.gone ? t('Push előtte ({0} új commit)', b.ahead) : t('Push előtte (az ág még nincs a remote-on)'), type: 'checkbox', value: true });
  const v = await formDlg(t('Pull request létrehozása'), fields, t('Megnyitás a böngészőben'), t('Forrás ág: {0}', b.name));
  if (!v) return;
  const rem = remotes.find((x) => x.name === (v.remote || remote));
  const web = remoteWeb(rem.url);
  if (!web) { toast(t('Ennél a remote-nál ({0}) nem tudom, hol lehet pull requestet nyitni.', rem.url), 'err'); return; }
  const src = rem.name === remote ? source : b.name;
  if (v.push) {
    const args = ['push', '--progress'];
    if (!b.upstream || b.gone) args.push('-u');
    args.push(rem.name, `${b.name}:${src}`);
    if ((await op('Push', args)) == null) return;
  }
  try { await invoke('open_url', { url: prUrl(web, src, (v.target || target).trim()) }); }
  catch (e) { toast(String(e), 'err'); }
}

async function newBranchDlg(start) {
  const r = cur();
  const v = await formDlg(t('Új ág'), [
    { name: 'name', label: t('Ág neve'), placeholder: 'feature/uj-funkcio' },
    { name: 'start', label: t('Kiindulópont'), type: 'combo', value: start || r.refs?.head || 'HEAD', options: refOptions(r, { tags: true, head: true }) },
    { name: 'checkout', label: t('Checkout létrehozás után'), type: 'checkbox', value: true },
  ], t('Létrehozás'));
  if (!v || !v.name.trim()) return;
  const name = v.name.trim().replace(/\s+/g, '-');
  if (v.checkout) await op(t('Új ág: {0}', name), ['checkout', '-b', name, v.start.trim() || 'HEAD']);
  else await op(t('Új ág: {0}', name), ['branch', name, v.start.trim() || 'HEAD']);
}

async function renameBranchDlg(b) {
  const v = await formDlg(t('Ág átnevezése'), [{ name: 'name', label: t('Új név'), value: b.name }], t('Átnevezés'));
  if (v && v.name.trim() && v.name.trim() !== b.name) await op(t('Átnevezés'), ['branch', '-m', b.name, v.name.trim()]);
}

async function upstreamDlg(b) {
  const r = cur();
  const v = await formDlg(t('Upstream beállítása'), [{ name: 'up', label: t('Upstream (pl. origin/main)'), type: 'select', value: b.upstream, options: ['', ...r.refs.remote.map((x) => x.name)].map((x) => ({ value: x, label: x || t('(nincs – upstream törlése)') })) }], t('Mentés'));
  if (!v) return;
  if (v.up) await op('Upstream', ['branch', `--set-upstream-to=${v.up}`, b.name]);
  else await op(t('Upstream törlése'), ['branch', '--unset-upstream', b.name]);
}

async function deleteBranch(b) {
  const v = await formDlg(t('Ág törlése'), [
    { name: 'force', label: t('Törlés akkor is, ha nincs merge-elve (-D)'), type: 'checkbox', value: false },
    b.upstream ? { name: 'remote', label: t('Remote ág törlése is ({0})', b.upstream), type: 'checkbox', value: false } : null,
  ].filter(Boolean), t('Törlés'), t('Törlöd a(z) "{0}" ágat?', b.name));
  if (!v) return;
  const ok = await op(t('Ág törlése: {0}', b.name), ['branch', v.force ? '-D' : '-d', b.name], { refresh: !v.remote });
  if (ok != null && v.remote) {
    const [rm, ...rest] = b.upstream.split('/');
    await op(t('Remote ág törlése: {0}', b.upstream), ['push', rm, '--delete', rest.join('/')]);
  }
}

async function mergeDlg(ref) {
  const r = cur();
  const head = r.refs?.head;
  if (!head) { toast('Detached HEAD-re nem lehet merge-elni.', 'err'); return; }
  const v = await formDlg(`Merge → ${head}`, [
    { name: 'ref', label: t('Melyik ágat / commitot'), type: 'combo', value: ref || '', placeholder: t('pl. feature/x'), options: refOptions(r, { tags: true, exclude: [head] }) },
    { name: 'mode', label: t('Mód'), type: 'select', value: 'default', options: [
      { value: 'default', label: t('Alapértelmezett (fast-forward ha lehet)') },
      { value: 'noff', label: t('Mindig merge commit (--no-ff)') },
      { value: 'ff', label: t('Csak fast-forward (--ff-only)') },
      { value: 'squash', label: t('Squash (--squash, commit utána)') }] },
  ], 'Merge');
  if (!v || !v.ref.trim()) return;
  const args = ['merge'];
  if (v.mode === 'noff') args.push('--no-ff', '--no-edit');
  else if (v.mode === 'ff') args.push('--ff-only');
  else if (v.mode === 'squash') args.push('--squash');
  else args.push('--no-edit');
  args.push(v.ref.trim());
  await op(`Merge ${v.ref.trim()} → ${head}`, args);
  if (cur().status?.conflicted.length) { toast(t('Konfliktusok keletkeztek – oldd fel őket a Lokális változások nézetben.'), 'err'); setView('changes'); }
}

async function rebase(onto) {
  const r = cur();
  if (!(await confirmDlg('Rebase', t('A(z) "{0}" ág commitjai újra lesznek játszva erre: "{1}". Folytatod?', r.refs.head, onto), 'Rebase'))) return;
  await op(`Rebase → ${onto}`, ['-c', 'core.editor=true', 'rebase', '--autostash', onto]);
  if (cur().status?.operation === 'rebase') setView('changes');
}

async function resetDlg(c) {
  const v = await formDlg('Reset', [{ name: 'mode', label: t('Mód'), type: 'select', value: 'mixed', options: [
    { value: 'soft', label: t('Soft – a változások staged állapotban maradnak') },
    { value: 'mixed', label: t('Mixed – a változások a working tree-ben maradnak') },
    { value: 'hard', label: t('Hard – MINDEN lokális változás elvész!') }] }], 'Reset',
  t('A(z) "{0}" erre a commitra áll: {1} {2}', cur().refs?.head || 'HEAD', short(c.hash), c.subject));
  if (!v) return;
  if (v.mode === 'hard' && !(await confirmDlg('Hard reset', t('Minden nem commitolt változás véglegesen elvész. Biztos?'), 'Hard reset', true))) return;
  await op(`Reset --${v.mode}`, ['reset', `--${v.mode}`, c.hash]);
}

async function tagDlg(target) {
  const v = await formDlg(t('Új tag'), [
    { name: 'name', label: t('Tag neve'), placeholder: 'v1.0.0' },
    { name: 'target', label: 'Commit', type: 'combo', value: target, options: refOptions(cur(), { head: true }) },
    { name: 'message', label: t('Üzenet (annotált taghez, üres = lightweight)'), type: 'textarea', rows: 3 },
    { name: 'push', label: t('Push a remote-ra is'), type: 'checkbox', value: false },
  ], t('Létrehozás'));
  if (!v || !v.name.trim()) return;
  const args = ['tag'];
  if (v.message.trim()) args.push('-a', '-m', v.message.trim());
  args.push(v.name.trim(), v.target.trim() || 'HEAD');
  const ok = await op(`Tag: ${v.name.trim()}`, args, { refresh: !v.push });
  if (ok != null && v.push) { const rm = await pickRemote(); if (rm) await op('Push tag', ['push', rm, `refs/tags/${v.name.trim()}`]); }
}

async function stashDlg() {
  const r = cur();
  const v = await formDlg('Stash', [
    { name: 'message', label: t('Üzenet (opcionális)') },
    { name: 'untracked', label: t('Nem követett fájlok is (-u)'), type: 'checkbox', value: true },
    { name: 'keep', label: t('Staged változások megtartása (--keep-index)'), type: 'checkbox', value: false },
    { name: 'staged', label: t('Csak a staged változások (--staged)'), type: 'checkbox', value: false },
  ], 'Stash');
  if (!v) return;
  const args = ['stash', 'push'];
  if (v.untracked && !v.staged) args.push('-u');
  if (v.keep) args.push('--keep-index');
  if (v.staged) args.push('--staged');
  if (v.message.trim()) args.push('-m', v.message.trim());
  await op('Stash', args, { repo: r });
}

async function stashPop() {
  await op('Stash pop', ['stash', 'pop']);
}

async function addRemoteDlg() {
  const v = await formDlg(t('Remote hozzáadása'), [
    { name: 'name', label: t('Név'), value: (cur().refs?.remotes || []).length ? '' : 'origin' },
    { name: 'url', label: 'URL', placeholder: 'https://github.com/user/repo.git' },
    { name: 'fetch', label: t('Fetch hozzáadás után'), type: 'checkbox', value: true },
  ], t('Hozzáadás'));
  if (!v || !v.name.trim() || !v.url.trim()) return;
  const ok = await op(t('Remote hozzáadása'), ['remote', 'add', v.name.trim(), v.url.trim()], { refresh: !v.fetch });
  if (ok != null && v.fetch) await op('Fetch', ['fetch', v.name.trim()]);
}

// ── repositories ──
async function pickFolder(title) {
  try {
    const res = await invoke('plugin:dialog|open', { options: { directory: true, multiple: false, title } });
    return Array.isArray(res) ? res[0] : res;
  } catch (e) { toast(e, 'err'); return null; }
}

async function openRepoDlg() {
  const p = await pickFolder(t('Git repository megnyitása'));
  if (p) openRepo(p);
}

async function openRepo(path, { activate = true, quiet = false } = {}) {
  const existing = S.repos.findIndex((r) => r.path.toLowerCase() === path.toLowerCase());
  if (existing >= 0) { if (activate) switchRepo(existing); return; }
  let info;
  try { info = await invoke('open_repo', { path }); } catch (e) { if (!quiet) toast(e, 'err'); return; }
  const again = S.repos.findIndex((r) => r.path.toLowerCase() === info.path.toLowerCase());
  if (again >= 0) { if (activate) switchRepo(again); return; }
  const repo = new Repo(info);
  S.repos.push(repo);
  S.settings.recent_repos = [info.path, ...(S.settings.recent_repos || []).filter((x) => x.toLowerCase() !== info.path.toLowerCase())].slice(0, 20);
  if (activate) S.active = S.repos.length - 1;
  if (!S.restoring) persistRepos();
  if (activate) { renderAll(); await refreshAll(repo); }
}

async function switchRepo(i) {
  S.active = i;
  persistRepos();
  document.querySelector('.console')?.remove();
  document.querySelector('.ai-panel')?.remove();
  renderAll();
  await refreshAll(cur());
}

function closeRepo(i) {
  S.repos.splice(i, 1);
  if (S.active >= S.repos.length) S.active = S.repos.length - 1;
  persistRepos();
  renderAll();
  if (cur()) refreshAll(cur());
}

async function cloneDlg() {
  const v = await formDlg(t('Repository klónozása'), [
    { name: 'url', label: 'URL', placeholder: 'https://github.com/user/repo.git' },
    { name: 'parent', label: t('Szülő mappa'), value: localStorage.getItem('gs.cloneParent') || '', note: t('Ide kerül a repository mappája.') },
    { name: 'name', label: t('Mappa neve (üres = a repository neve)') },
  ], t('Klónozás'));
  if (!v || !v.url.trim()) return;
  let parent = v.parent.trim();
  if (!parent) { parent = await pickFolder(t('Hova klónozzam?')); if (!parent) return; }
  localStorage.setItem('gs.cloneParent', parent);
  const name = v.name.trim() || basename(v.url.trim().replace(/\/+$/, '')).replace(/\.git$/, '');
  const dest = parent.replace(/[\\/]+$/, '') + '\\' + name;
  setBusy(true, t('Klónozás: {0}…', v.url));
  try {
    const info = await invoke('clone_repo', { url: v.url.trim(), dest });
    toast(t('Klónozva: {0}', info.path), 'ok');
    await openRepo(info.path);
  } catch (e) { toast(t('Klónozás sikertelen:\n') + e, 'err'); }
  finally { setBusy(false); }
}

async function initDlg() {
  const p = await pickFolder(t('Mappa az új repository-nak'));
  if (!p) return;
  try { const info = await invoke('init_repo', { path: p }); toast(t('Új repository: {0}', info.path), 'ok'); await openRepo(info.path); }
  catch (e) { toast(e, 'err'); }
}

// ── about ──
async function aboutDlg() {
  let info = {};
  try { info = await invoke('app_info'); } catch (e) { info = { git: String(e) }; }
  const ds = isDeepSeek();
  const ai = aiKey() ? `${ds ? 'DeepSeek' : 'Anthropic Claude'} · ${aiModel()}` : t('nincs beállítva');
  const rows = [
    [t('Verzió'), info.version || '?'],
    ['Git', info.git || '?'],
    ['Tauri', info.tauri || '?'],
    [t('Rendszer'), info.os || '?'],
    ['AI', ai],
    [t('Beállítások fájl'), info.settings_path || '?'],
  ];
  const text = 'GitStar ' + rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  const features = [
    ['sparkle', t('AI commit üzenetek')], ['split', t('Vizuális diff')], ['compare', t('AI diff összehasonlítás')],
    ['history', t('Commit gráf')], ['branch', t('Ágak, merge, rebase')], ['globe', t('Magyar / English')],
  ];
  const body = h('div.about',
    h('div.about-hero',
      h('div.about-logo', h('img', { src: 'img/icon.svg', alt: 'GitStar' })),
      h('div.about-name', 'GitStar'),
      h('div.about-ver', `v${info.version || '?'}`),
      h('div.about-tag', t('Git kliens AI commit üzenetekkel és vizuális diff-fel.'))),
    h('div.about-feats', features.map(([ic, l]) => h('span.about-feat', icon(ic), l))),
    h('div.about-info', rows.map(([k, v]) => [h('span.k', k), h('span.v', { title: v }, v)])),
    h('div.about-foot', t('Rust + Tauri 2, a git műveleteket a git.exe végzi. AI: Anthropic Claude vagy DeepSeek.')),
    h('div.about-copy', '© 2026 Zsolt Tarczali'));
  const res = await modal({ title: t('Névjegy'), body, buttons: [
    { label: t('Frissítések keresése'), value: 'update' },
    { label: t('Beállítások mappa'), value: 'folder' },
    { label: t('Másolás'), value: 'copy' },
    { label: t('Bezárás'), value: false, primary: true },
  ] });
  if (res === 'update') checkForAppUpdate();
  if (res === 'copy') { await navigator.clipboard.writeText(text).catch(() => {}); toast(t('Vágólapra másolva')); }
  if (res === 'folder' && info.settings_path) invoke('reveal_in_explorer', { path: info.settings_path }).catch((e) => toast(e, 'err'));
}

// ── settings ──
async function settingsDlg() {
  const s = S.settings;
  let ident = { global_name: '', global_email: '' };
  try { ident = await invoke('git_identity', { repo: null }); } catch {}
  const gitName = h('input.inp', { value: ident.global_name, placeholder: t('Teljes név'), spellcheck: 'false' });
  const gitEmail = h('input.inp', { type: 'email', value: ident.global_email, placeholder: 'nev@example.com', spellcheck: 'false' });
  const models = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
  const els = {};
  const fld = (name, label, el, note, full) => { els[name] = el; return h('label.field' + (full ? '.full' : ''), h('span', label), el, note ? h('span.note', note) : null); };
  const sel = (opts, val) => { const e = h('select.inp', opts.map(([v, l]) => h('option', { value: v }, l))); e.value = val; return e; };
  const gitVer = h('span.note', '');
  const gitInp = h('input.inp', { value: s.git_path, placeholder: t('git (a PATH-ból) vagy C:\\Program Files\\Git\\cmd\\git.exe'), spellcheck: 'false' });
  const testGit = async () => { try { gitVer.textContent = '✓ ' + (await invoke('git_version', { path: gitInp.value || 'git' })); } catch (e) { gitVer.textContent = '✗ ' + e; } };
  testGit();
  const modelSel = sel([...models.map((m) => [m, m]), ['custom', t('Egyéb…')]], models.includes(s.ai_model) ? s.ai_model : 'custom');
  const customModel = h('input.inp', { value: models.includes(s.ai_model) ? '' : s.ai_model, placeholder: 'model id', style: { display: models.includes(s.ai_model) ? 'none' : '' } });
  modelSel.addEventListener('change', () => (customModel.style.display = modelSel.value === 'custom' ? '' : 'none'));
  const key = h('input.inp', { type: 'password', value: s.anthropic_api_key, placeholder: 'sk-ant-…', spellcheck: 'false' });
  const dsModels = ['deepseek-flash', 'deepseek-v4-pro'];
  const dsModel = s.deepseek_model || 'deepseek-flash';
  const dsKey = h('input.inp', { type: 'password', value: s.deepseek_api_key || '', placeholder: 'sk-…', spellcheck: 'false' });
  const dsModelSel = sel([...dsModels.map((m) => [m, m]), ['custom', t('Egyéb…')]], dsModels.includes(dsModel) ? dsModel : 'custom');
  const dsCustom = h('input.inp', { value: dsModels.includes(dsModel) ? '' : dsModel, placeholder: 'model id', style: { display: dsModels.includes(dsModel) ? 'none' : '' } });
  dsModelSel.addEventListener('change', () => (dsCustom.style.display = dsModelSel.value === 'custom' ? '' : 'none'));
  const providerSel = sel([['anthropic', 'Anthropic Claude'], ['deepseek', 'DeepSeek']], s.ai_provider || 'anthropic');
  const claudeBox = h('div.settings-sub.full',
    h('label.field.full', h('span', t('Anthropic API kulcs')), key, h('span.note', t('A kulcs a GitStar beállításfájljában tárolódik ezen a gépen (settings.json az alkalmazás konfigurációs mappájában). Kulcs: console.anthropic.com'))),
    h('label.field', h('span', t('Modell')), modelSel, customModel, h('span.note', t('Alapértelmezés: claude-opus-5-5. Gyorsabb/olcsóbb: claude-haiku-5-5.'))));
  const dsBox = h('div.settings-sub.full',
    h('label.field.full', h('span', t('DeepSeek API kulcs')), dsKey, h('span.note', t('A kulcs a GitStar beállításfájljában tárolódik ezen a gépen. Kulcs: platform.deepseek.com'))),
    h('label.field', h('span', t('Modell')), dsModelSel, dsCustom, h('span.note', t('Alapértelmezés: deepseek-flash. Erősebb: deepseek-v4-pro.'))));
  const syncProvider = () => { const ds = providerSel.value === 'deepseek'; claudeBox.style.display = ds ? 'none' : ''; dsBox.style.display = ds ? '' : 'none'; };
  providerSel.addEventListener('change', syncProvider);
  syncProvider();
  // Test with the values typed in the dialog (they need not be saved yet).
  const aiTestOut = h('span.note', '');
  const aiTestBtn = h('button.btn', { on: { click: async () => {
    const ds = providerSel.value === 'deepseek';
    const apiKey = (ds ? dsKey.value : key.value).trim();
    const model = ds
      ? (dsModelSel.value === 'custom' ? dsCustom.value.trim() || 'deepseek-flash' : dsModelSel.value)
      : (modelSel.value === 'custom' ? customModel.value.trim() || 'claude-opus-5-5' : modelSel.value);
    if (!apiKey) { aiTestOut.className = 'note err'; aiTestOut.textContent = '✗ ' + t('Nincs megadva API kulcs.'); return; }
    aiTestBtn.disabled = true;
    aiTestOut.className = 'note';
    aiTestOut.textContent = t('Tesztelés…');
    try {
      aiTestOut.textContent = '✓ ' + (await invoke('ai_test', { provider: providerSel.value, apiKey, model }));
      aiTestOut.className = 'note ok';
    } catch (e) {
      aiTestOut.textContent = '✗ ' + e;
      aiTestOut.className = 'note err';
    } finally { aiTestBtn.disabled = false; }
  } } }, t('Teszt'));
  providerSel.addEventListener('change', () => { aiTestOut.textContent = ''; });
  const updCheck = h('input', { type: 'checkbox', checked: s.update_check !== false });
  const updServer = h('input.inp', { value: s.update_server || '', placeholder: 'https://www.c64va.pro/downloads/GitStar/', spellcheck: 'false' });
  // checks the address, saves it, then looks for a new version there
  const saveUpdServer = async () => {
    try { await invoke('update_server_check', { url: updServer.value }); }
    catch (e) { toast(String(e), 'err'); return; }
    S.settings.update_server = updServer.value.trim();
    await saveSettings();
    checkForAppUpdate();
  };
  const body = h('div.settings-grid',
    h('div.settings-sec', 'Git'),
    h('label.field.full', h('span', t('git.exe útvonala')), h('div', { style: { display: 'flex', gap: '6px' } }, gitInp,
      h('button.btn', { on: { click: async () => {
        try { const p = await invoke('plugin:dialog|open', { options: { multiple: false, title: t('git.exe kiválasztása'), ...(/Windows/i.test(navigator.userAgent) ? { filters: [{ name: 'git', extensions: ['exe'] }] } : {}) } }); if (p) { gitInp.value = p; testGit(); } } catch (e) { toast(e, 'err'); }
      } } }, t('Tallózás…')), h('button.btn', { on: { click: testGit } }, t('Teszt'))), gitVer),
    h('label.field', h('span', t('Név (user.name)')), gitName),
    h('label.field', h('span', t('Email (user.email)')), gitEmail),
    h('div.note.full', t('A név és az email a globális git beállításba kerül (git config --global), minden repóra érvényes, ahol nincs saját beállítás.')),
    fld('pull_mode', t('Pull gomb módja'), sel([['merge', 'Merge'], ['rebase', 'Rebase'], ['ff', t('Csak fast-forward')], ['ask', t('Mindig kérdezzen')]], s.pull_mode || 'merge'),
      t('Shift+kattintás vagy jobb klikk a Pull gombon mindig megnyitja a párbeszédablakot.')),
    fld('log_limit', t('Betöltött commitok száma'), h('input.inp', { type: 'number', min: 100, max: 50000, value: s.log_limit })),
    h('div'),
    h('div.settings-sec', t('Megjelenés')),
    fld('ui_language', t('Felület nyelve'), sel([['auto', t('Automatikus (rendszer)')], ['hu', 'Magyar'], ['en', 'English']], s.ui_language || 'auto')),
    h('div'),
    fld('theme', t('Téma'), sel([['dark', t('Sötét')], ['light', t('Világos')], ['ai', 'AI (neon)'], ['retro', t('Retró (8 bites)')], ['modern', t('Modern (üveg)')], ['modern-dark', t('Modern sötét (üveg)')], ['system', t('Rendszer szerint')]], s.theme)),
    fld('font_size', t('Betűméret'), h('input.inp', { type: 'number', min: 10, max: 20, value: s.font_size })),
    h('div.settings-sec', 'AI'),
    h('label.field.full', h('span', t('AI szolgáltató')), h('div', { style: { display: 'flex', gap: '6px' } }, providerSel, aiTestBtn), aiTestOut),
    claudeBox,
    dsBox,
    fld('ai_language', t('AI szövegek nyelve'), sel([['hu', t('Magyar')], ['en', 'English']], s.ai_language)),
    h('div.settings-sec', t('Frissítés')),
    h('label.chk.full', updCheck, t('Új verzió keresése induláskor')),
    h('label.field.full', h('span', t('Letöltési mappa címe')), h('div', { style: { display: 'flex', gap: '6px' } }, updServer,
      h('button.btn', { on: { click: () => saveUpdServer() } }, t('Keresés most'))),
      h('span.note', t('Itt keresi a GitStar a telepítőket (pl. GitStar_0.3.0_x64-setup.exe). Üres = alapértelmezett.'))),
    fld('commit_style', t('Commit üzenet stílus'), sel([['conventional', 'Conventional Commits (feat: …)'], ['simple', t('Egyszerű, egy sor')], ['detailed', t('Részletes, felsorolással')]], s.commit_style), null, true),
  );
  const ok = await modal({ title: t('Beállítások'), body, wide: true, buttons: [{ label: t('Mégse'), value: false }, { label: t('Mentés'), value: true, primary: true }] });
  if (!ok) return;
  Object.assign(S.settings, {
    git_path: gitInp.value.trim(),
    log_limit: Math.max(100, +els.log_limit.value || 1500),
    theme: els.theme.value,
    ui_language: els.ui_language.value,
    font_size: Math.max(10, Math.min(20, +els.font_size.value || 13)),
    ai_provider: providerSel.value,
    anthropic_api_key: key.value.trim(),
    deepseek_api_key: dsKey.value.trim(),
    deepseek_model: dsModelSel.value === 'custom' ? dsCustom.value.trim() || 'deepseek-flash' : dsModelSel.value,
    ai_model: modelSel.value === 'custom' ? customModel.value.trim() || 'claude-opus-5-5' : modelSel.value,
    ai_language: els.ai_language.value,
    commit_style: els.commit_style.value,
    pull_mode: els.pull_mode.value,
    update_check: updCheck.checked,
  });
  try { await invoke('update_server_check', { url: updServer.value }); S.settings.update_server = updServer.value.trim(); }
  catch (e) { toast(String(e), 'err'); }
  await saveSettings();
  if (gitName.value.trim() !== ident.global_name || gitEmail.value.trim() !== ident.global_email) {
    try { await invoke('set_git_identity', { name: gitName.value, email: gitEmail.value }); toast(t('Git név és email mentve.'), 'ok'); }
    catch (e) { toast(t('A git név/email mentése nem sikerült: {0}', String(e)), 'err'); }
  }
  applyLang();
  applyTheme();
  renderAll(true);
  if (cur()) refreshAll(cur());
}

// ── self-update (same flow as the Visual Assembler) ──
// The newest installer is looked up in the download folder (Settings → Update);
// "Install now" downloads it with a progress bar, starts it and GitStar restarts.

let updBusy = false;

function updateDlgEls() {
  let ov = document.getElementById('update-ov');
  if (ov) return ov.els;
  const els = {
    title: h('div.modal-h'), msg: h('div.desc.update-msg'),
    bar: h('div.update-bar-fill'), text: h('div.update-progress-text'),
    skip: h('button.btn', t('Kihagyom ezt a verziót')),
    close: h('button.btn', t('Bezárás')),
    install: h('button.btn.primary', icon('fetch'), t('Telepítés most')),
  };
  els.prog = h('div.update-progress', h('div.update-bar', els.bar), els.text);
  ov = h('div.overlay#update-ov',
    h('div.modal.update-dlg', els.title, h('div.modal-b', els.msg, els.prog), h('div.modal-f', els.skip, els.close, els.install)));
  ov.els = els;
  const shut = () => { if (!updBusy) { ov.remove(); document.removeEventListener('keydown', onKey, true); } };
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); shut(); } }
  els.close.addEventListener('click', shut);
  els.skip.addEventListener('click', () => {
    S.settings.update_skip = S.update?.latestVersion || '';
    saveSettings();
    shut();
  });
  els.install.addEventListener('click', () => installUpdate());
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) shut(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(ov);
  return els;
}

/** state: null = hidden, -1 = indeterminate (animated), 0..100 = percent */
function updateProgress(state, label = '') {
  const els = updateDlgEls();
  els.prog.style.display = state === null ? 'none' : '';
  els.bar.classList.toggle('indet', state === -1);
  els.bar.style.width = state >= 0 ? state + '%' : '';
  els.text.textContent = label;
}

function updateShow({ title, msg, install = false, skip = false, closeLabel = t('Bezárás') }) {
  const els = updateDlgEls();
  els.title.textContent = title;
  els.msg.textContent = msg;
  els.install.style.display = install ? '' : 'none';
  els.skip.style.display = skip ? '' : 'none';
  els.close.textContent = closeLabel;
  els.close.disabled = false;
  if (!install) updateProgress(null);
}

function updateShowAvailable() {
  const u = S.update;
  if (!u?.updateAvailable) return;
  updateShow({ title: t('Új verzió érhető el'),
    msg: t('Elérhető a GitStar {0} (most: {1}). Letöltöm és telepítem? A GitStar a telepítés után újraindul.', u.latestVersion, u.currentVersion),
    install: true, skip: true, closeLabel: t('Később') });
  updateProgress(null);
}

async function checkForAppUpdate({ silent = false } = {}) {
  if (updBusy) return;
  if (!silent) { updateShow({ title: t('Frissítések keresése'), msg: t('Új verzió keresése…') }); updateProgress(-1); }
  updBusy = true;
  let info;
  try { info = await invoke('check_for_update'); }
  catch (e) {
    updBusy = false;
    if (!silent) updateShow({ title: t('Frissítések keresése'), msg: t('A frissítés ellenőrzése nem sikerült: {0}', String(e)) });
    return;
  }
  updBusy = false;
  S.update = info;
  renderStatusbar();
  if (!info?.supported) { if (!silent) updateShow({ title: t('Frissítések keresése'), msg: t('Ezen a platformon nincs automatikus frissítés.') }); return; }
  if (!info.updateAvailable) { if (!silent) updateShow({ title: t('Frissítések keresése'), msg: t('A GitStar naprakész (v{0}).', info.currentVersion) }); return; }
  if (silent && (S.settings.update_skip === info.latestVersion || document.querySelector('.overlay'))) return;
  updateShowAvailable();
}

async function installUpdate() {
  const u = S.update;
  if (updBusy || !u?.updateAvailable) return;
  if (S.busy && !(await confirmDlg(t('Frissítés'), t('Egy git művelet még fut. Biztosan frissítesz most?'), t('Frissítés')))) return;
  const els = updateDlgEls();
  updBusy = true;
  els.install.style.display = 'none';
  els.skip.style.display = 'none';
  els.close.disabled = true;
  els.msg.textContent = t('A GitStar {0} letöltése…', u.latestVersion);
  updateProgress(-1);
  let unlisten = null;
  try {
    const mb = (n) => (n / 1048576).toFixed(1);
    unlisten = await window.__TAURI__.event.listen('update-download-progress', ({ payload: { received, total } }) => {
      if (total > 0) updateProgress(Math.min(100, Math.round((received * 100) / total)), `${mb(received)} / ${mb(total)} MB`);
      else updateProgress(-1, `${mb(received)} MB`);
    });
    const res = await invoke('download_and_install_update', { version: u.latestVersion });
    updateProgress(100);
    if (res.restarting) {
      els.msg.textContent = t('A telepítő elindult, a GitStar most bezárul és újraindul.');
    } else {
      updBusy = false;
      updateShow({ title: t('Új verzió érhető el'), msg: t('A telepítő megnyílt ({0}). Fejezd be a telepítést, majd indítsd újra a GitStart.', res.path) });
    }
  } catch (e) {
    updBusy = false;
    updateShow({ title: t('Új verzió érhető el'), msg: t('A frissítés nem sikerült: {0}', String(e)), install: true });
    updateProgress(null);
  } finally { unlisten?.(); }
}

// ───────────────────────── boot ─────────────────────────

async function boot() {
  try { S.settings = await invoke('get_settings'); }
  catch (e) { S.settings = { theme: 'dark', diff_mode: 'split', diff_context: 3, log_limit: 1500, recent_repos: [], open_repos: [] }; toast(e, 'err'); }
  applyLang();
  applyTheme();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (S.settings.theme === 'system') { applyTheme(); renderAll(true); } });
  splitter(document.getElementById('side-split'), document.getElementById('sidebar'), { min: 160, max: 520, key: 'gs.sideW' });
  renderAll();
  const wanted = S.settings.active_repo;
  S.restoring = true;
  for (const p of S.settings.open_repos || []) await openRepo(p, { activate: false, quiet: true });
  S.restoring = false;
  const ai = S.repos.findIndex((r) => r.path.toLowerCase() === (wanted || '').toLowerCase());
  S.active = S.repos.length ? (ai >= 0 ? ai : 0) : -1;
  persistRepos();
  renderAll();
  if (cur()) await refreshAll(cur());

  // refresh when the window gets focus (files may have changed outside)
  let lastFocus = 0;
  window.addEventListener('focus', () => {
    if (!cur() || Date.now() - lastFocus < 1500) return;
    lastFocus = Date.now();
    refreshAll(cur());
  });
  // light polling of the working tree state
  setInterval(async () => {
    const r = cur();
    if (!r || S.busy || document.hidden || !document.hasFocus() || document.querySelector('.overlay')) return;
    const before = JSON.stringify(r.status);
    await refreshStatus(r);
    if (JSON.stringify(r.status) !== before) {
      if (r.view === 'changes') renderAll(true);
      else { renderSidebar(); renderToolbar(); renderStatusbar(); }
    }
  }, 5000);

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.overlay')) return;
    const r = cur();
    if (e.key === 'F5') { e.preventDefault(); if (r) refreshAll(r); }
    else if (e.key === 'F1') { e.preventDefault(); aboutDlg(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); openRepoDlg(); }
    else if (e.ctrlKey && e.key === '`') { e.preventDefault(); toggleConsole(); }
    else if (e.ctrlKey && e.key === '1' && r) { e.preventDefault(); setView('changes'); }
    else if (e.ctrlKey && e.key === '2' && r) { e.preventDefault(); r.logRev = ''; r.logPath = ''; setView('history', true); }
    else if (e.ctrlKey && e.key === '3' && r) { e.preventDefault(); setView('compare'); }
    else if (e.ctrlKey && e.key === 'Tab' && S.repos.length > 1) { e.preventDefault(); switchRepo((S.active + (e.shiftKey ? S.repos.length - 1 : 1)) % S.repos.length); }
    else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); diffView().jump(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Escape') { document.querySelector('.ai-panel')?.remove(); }
  });
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input,textarea,.diff-scroll,.ai-body,.cmeta,.console-out')) e.preventDefault(); });

  // quiet update check a little after startup (Settings → Update)
  if (S.settings.update_check !== false) setTimeout(() => checkForAppUpdate({ silent: true }), 4000);
}

boot();
