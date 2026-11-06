# GitStar

Git kliens Windowsra, **Tauri 2 + Rust** backenddel és Fork-szerű felülettel.
Minden git műveletet a `git.exe` hajt végre (hookok, credential helper, LFS, config ugyanúgy működik, mint parancssorból).

## Funkciók

- **Repository-k**: megnyitás, klónozás, init, több repo fülön, legutóbbiak listája
- **Lokális változások**: unstaged / staged / konfliktus listák, stage / unstage / elvetés fájlonként, **hunkonként és soronként** (kattintás a sorszámra, Shift+kattintás tartomány), `.gitignore`-ba vétel
- **Commit**: amend, Ctrl+Enter, 72 karakteres összefoglaló-figyelés, merge üzenet előtöltés
- **AI commit üzenet** (Anthropic API kulccsal): a staged diff + a legutóbbi commitok stílusa alapján, Conventional / egyszerű / részletes stílusban, magyarul vagy angolul
- **Történet**: commit gráf (sávok, merge-ek, színek), virtualizált lista, ref címkék, keresés üzenet / hash / szerző / tartalom (`-S`) / útvonal szerint, fájl előzmények, blame
- **Fejlett vizuális diff**: egymás melletti és egyesített nézet, **szó szintű kiemelés**, minimap a változásokkal, ugrás változásról változásra (Alt+↑/↓), kontextus 3/10/25 sor vagy teljes fájl, whitespace ignorálás, sortörés, **kép diff** (egymás mellett / átúsztatás), konfliktus nézet jelölőkkel
- **Összehasonlítás**: bármely két ág / tag / commit vagy a working tree, merge-base (A...B) mód, csak az egyik oldalon lévő commitok listája
- **AI diff elemzés és összehasonlítás**: commit magyarázat, két ág/revízió AI-összehasonlítása (mit hoz be, kockázatok, merge problémák), fájl diff elemzése (összefoglaló, kérdezés nélkül)
- **Ágak / remote-ok / tagek / stash-ek**: checkout (stash-elési opcióval), új ág, átnevezés, törlés (remote-on is), upstream, merge (ff / no-ff / ff-only / squash), rebase, cherry-pick, revert, reset (soft/mixed/hard), fetch / pull (merge/rebase/ff-only, autostash) / push (upstream, force-with-lease, tagek), tag létrehozás/push/törlés, stash push/apply/pop/drop/branch, remote hozzáadás/URL/törlés
- **Folyamatban lévő merge/rebase/cherry-pick/revert** sáv: folytatás / kihagyás / megszakítás, konfliktus feloldás ours / theirs / kézi
- **Git konzol** (Ctrl+`): bármilyen git parancs, előzményekkel; minden művelet kimenete itt is látszik
- **Sötét / világos / AI (neon) / rendszer téma**: az AI téma színátmenetes neon felületet, animált vonalakat és saját, „AI-os” ikonkészletet használ; állítható betűméret, átméretezhető panelek
- **Magyar és angol felület** (Beállítások → Felület nyelve: automatikus / Magyar / English), a háttér hibaüzenetei is a választott nyelven jönnek

## Futtatás

Előfeltétel: Rust (stable), Node.js, git, Windows-on WebView2 (Windows 11-en alapból megvan); Linuxon a Tauri függőségei (webkit2gtk 4.1 stb.).

```bash
npm install
```

```bash
npm run dev
```

Telepítő készítése helyben (Windows-on NSIS + MSI a `src-tauri/target/release/bundle` alá):

```bash
npm run build
```

### Telepítők GitHub Actions-szel

A `.github/workflows/build.yml` workflow **csak kézzel indul** (nincs push / PR trigger):
GitHub → *Actions* → *Build installers* → *Run workflow*, vagy parancssorból:

```bash
gh workflow run build.yml --ref main
```

| Platform | Telepítő |
|---|---|
| Windows x64 | NSIS `.exe`, `.msi` |
| Windows ARM64 | NSIS `.exe` (x64 gépen keresztfordítva; MSI ARM64-re nem készül) |
| macOS Apple Silicon (ARM64) | `.dmg` |
| macOS Intel (x64) | `.dmg` |
| Linux x64 | `.deb`, `.rpm`, `.AppImage` |

A telepítők a futás *Artifacts* részéből tölthetők le. Ha indításkor bepipálod a *release* opciót,
egy `v<verzió>` draft GitHub release is készül (vagy frissül) a telepítőkkel.
A telepítők nincsenek aláírva: Windows-on SmartScreen, macOS-en Gatekeeper figyelmeztet
(macOS-en: jobb klikk → Megnyitás). A git-et a gépre külön kell telepíteni.

## AI beállítás

Beállítások → AI → *AI szolgáltató*: **Anthropic Claude** vagy **DeepSeek**.

- **Claude**: Anthropic API kulcs (console.anthropic.com). Alapértelmezett modell: `claude-opus-5-5`; gyorsabb/olcsóbb commit üzenetekhez választható a `claude-haiku-5-5`.
- **DeepSeek**: DeepSeek API kulcs (platform.deepseek.com). Alapértelmezett modell: `deepseek-flash`, erősebb: `deepseek-v4-pro`, vagy bármilyen más modell id (Egyéb…).

A kulcs a gépen, az alkalmazás konfigurációs mappájában tárolt `settings.json`-ban van (`%APPDATA%\hu.gitstar.app\settings.json`), titkosítás nélkül.
Nagyon nagy diff esetén (Claude-nál 600 000, DeepSeek-nél 300 000 karakter felett) csak az eleje kerül az AI-hoz; ezt a felület jelzi.

## Billentyűk

| Billentyű | Művelet |
|---|---|
| F5 | Frissítés |
| F1 | Névjegy (verzió, git, AI szolgáltató, beállításfájl helye) |
| Ctrl+O | Repository megnyitása |
| Ctrl+1 / 2 / 3 | Változások / Történet / Összehasonlítás |
| Ctrl+Tab | Következő repo fül |
| Ctrl+Enter | Commit |
| Ctrl+` | Git konzol |
| Alt+↑ / Alt+↓ | Előző / következő változás a diff-ben |
| ↑ / ↓ | Commit lista navigáció |

## Felépítés

```
src-tauri/src/
  git.rs        git.exe futtatása (rejtett ablak, stabil kimenet, stdin)
  commands.rs   Tauri parancsok: status, refs, log, diff, stage/apply, commit, műveletek, AI
  graph.rs      commit gráf sáv-kiosztás (unit tesztekkel)
  ai.rs         Claude Messages API hívás, promptok
  settings.rs   beállítások mentése
www/
  index.html, css/app.css   felület, témák (CSS változók)
  js/app.js     nézetek, oldalsáv, eszköztár, dialógusok, AI panel, konzol
  js/diff.js    diff parser + megjelenítő, hunk/sor patch készítés, kép diff, blame
  js/graph.js   gráf sor SVG
  js/util.js    DOM segédek, menük, modálok, markdown, ikonkészletek
  js/i18n.js    fordítás: t('magyar szöveg') → angol szótár
```

A frontend sima ES modul (nincs bundler); a `www` mappát a Tauri build ágyazza be.
