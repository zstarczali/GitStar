// Splash window: version and texts in the UI language. The main window closes
// this window (splash_done) once its UI is ready.
const invoke = window.__TAURI__?.core?.invoke;

const TEXT = {
  hu: { tag: 'Git kliens AI commit üzenetekkel és vizuális diff-fel', status: 'Betöltés…', repos: 'Repók megnyitása…' },
  en: { tag: 'Git client with AI commit messages and visual diff', status: 'Loading…', repos: 'Opening repositories…' },
};

async function init() {
  if (!invoke) return;
  let lang = 'hu';
  try {
    const s = await invoke('get_settings');
    const want = s.ui_language || 'auto';
    lang = want === 'auto' ? (navigator.language.toLowerCase().startsWith('hu') ? 'hu' : 'en') : want === 'en' ? 'en' : 'hu';
    document.documentElement.lang = lang;
    document.getElementById('tag').textContent = TEXT[lang].tag;
    document.getElementById('status').textContent = (s.open_repos || []).length ? TEXT[lang].repos : TEXT[lang].status;
  } catch { /* keep the Hungarian defaults */ }
  try {
    const info = await invoke('app_info');
    document.getElementById('ver').textContent = 'v' + info.version;
  } catch { /* no version */ }
}

init();
