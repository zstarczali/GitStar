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
- **AI diff elemzés és összehasonlítás**: commit magyarázat, két ág/revízió AI-összehasonlítása (mit hoz be, kockázatok, merge problémák), fájl diff elemzése, utólagos kérdések a diff-ről
- **Ágak / remote-ok / tagek / stash-ek**: checkout (stash-elési opcióval), új ág, átnevezés, törlés (remote-on is), upstream, merge (ff / no-ff / ff-only / squash), rebase, cherry-pick, revert, reset (soft/mixed/hard), fetch / pull (merge/rebase/ff-only, autostash) / push (upstream, force-with-lease, tagek), tag létrehozás/push/törlés, stash push/apply/pop/drop/branch, remote hozzáadás/URL/törlés
- **Folyamatban lévő merge/rebase/cherry-pick/revert** sáv: folytatás / kihagyás / megszakítás, konfliktus feloldás ours / theirs / kézi
- **Git konzol** (Ctrl+`): bármilyen git parancs, előzményekkel; minden művelet kimenete itt is látszik
- **Sötét / világos / rendszer téma**, állítható betűméret, átméretezhető panelek

## Futtatás

Előfeltétel: Rust (stable), Node.js, Git for Windows, WebView2 (Windows 11-en alapból megvan).

```bash
npm install
```

```bash
npm run dev
```

Telepítő készítése (NSIS + MSI a `src-tauri/target/release/bundle` alá):

```bash
npm run build
```

## AI beállítás

Beállítások → AI: add meg az Anthropic API kulcsot (console.anthropic.com). Alapértelmezett modell: `claude-opus-5-5`; gyorsabb/olcsóbb commit üzenetekhez választható a `claude-haiku-5-5`.
A kulcs a gépen, az alkalmazás konfigurációs mappájában tárolt `settings.json`-ban van (`%APPDATA%\hu.gitstar.app\settings.json`), titkosítás nélkül.
Nagyon nagy diff esetén (600 000 karakter felett) csak az eleje kerül az AI-hoz; ezt a felület jelzi.

## Billentyűk

| Billentyű | Művelet |
|---|---|
| F5 | Frissítés |
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
  js/util.js    DOM segédek, menük, modálok, markdown
```

A frontend sima ES modul (nincs bundler); a `www` mappát a Tauri build ágyazza be.
