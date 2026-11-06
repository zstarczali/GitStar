<p align="center">
  <img src="assets/icon.svg" alt="GitStar logo" width="200" height="200">
</p>

<h1 align="center">GitStar</h1>

GitStar is a Git client with a **Tauri 2 and Rust** backend and a Fork-style interface. It runs Git operations through the installed Git executable, so hooks, credential helpers, Git LFS, and Git configuration work as they do on the command line.

## Features

- **Repositories** — Open, clone, and initialize repositories, work across tabs, and reopen recent repositories.
- **Local changes** — View unstaged, staged, and conflicting files. Stage, unstage, or discard changes by file, **hunk, or line**. Click a line number to select it or Shift-click to select a range. Add files to `.gitignore`.
- **Commits** — Amend commits, use Ctrl+Enter to commit, check the summary against a 72-character limit, and start with a prefilled merge message.
- **AI commit messages** — Generate Conventional Commits, simple summaries, or detailed messages in English or Hungarian using the staged diff and recent commit style.
- **History** — Browse a color-coded commit graph with merge lanes, a virtualized list, and ref labels. Search by message, hash, author, content (`-S`), or path, and view file history and blame.
- **Visual diffs** — Switch between side-by-side and unified views with **word-level highlighting**. Navigate changes with the minimap or Alt+↑ / Alt+↓. Choose 3, 10, or 25 lines of context or show the full file. Ignore whitespace, wrap lines, compare images side by side or with a slider, and inspect conflict markers.
- **Comparisons** — Compare branches, tags, commits, or the working tree. Use merge-base mode (`A...B`) and see commits unique to each side.
- **AI diff analysis** — Explain a commit, compare branches or revisions for incoming changes, risks, and merge issues, or summarize an individual file diff.
- **Branches, remotes, tags, and stashes** — Check out branches with optional stashing, create, rename, or delete local and remote branches, and set upstreams. Merge with fast-forward, no-fast-forward, fast-forward-only, or squash. Rebase, cherry-pick, revert, or reset in soft, mixed, or hard mode. Fetch, pull with merge, rebase, or fast-forward-only and optional autostash, and push with upstream, force-with-lease, or tag options. Create, push, or delete tags, push, apply, pop, drop, or branch from stashes, and add, edit, or remove remotes.
- **In-progress operations** — Continue, skip, or abort a merge, rebase, cherry-pick, or revert where Git supports it. Resolve conflicts using ours, theirs, or manual edits.
- **Git console** — Run Git commands with command history and view output from app operations.
- **Themes and layout** — Choose dark, light, AI neon, retro, modern, modern dark, or system themes, adjust the font size, and resize panels. The neon theme includes gradients, animated lines, and custom icons; the retro theme looks like an 8-bit home computer on a CRT (monospace font, scanlines, striped toolbar, blinking cursor); the modern theme is light frosted glass on a soft pastel gradient (rounded controls, gradient buttons, pill toggles), and modern dark is the same glass look on a deep aurora gradient.
- **Self-update** — GitStar looks for a newer installer at startup (and from **About → Check for updates**). It reads the download folder set in Settings (default `https://www.c64va.pro/downloads/GitStar/`), downloads the installer for the platform with a progress bar, runs it, and restarts. Upload the installers from the GitHub Actions build there with their original names, such as `GitStar_0.3.0_x64-setup.exe`.
- **English and Hungarian** — Set the interface language to automatic, Hungarian, or English in Settings. Backend errors use the selected language.

## Running from source

Install stable Rust, Node.js, and Git. On Windows, WebView2 is required and comes with Windows 11. On Linux, install the Tauri system dependencies, including WebKitGTK 4.1.

```bash
npm install
npm run dev
```

To build an NSIS installer locally on Windows, run the following command. The installer is written to `src-tauri/target/release/bundle`.

```bash
npm run build -- --bundles nsis
```

### Building installers with GitHub Actions

The `.github/workflows/build.yml` workflow runs **only when manually triggered**. On GitHub, go to **Actions → Build installers → Run workflow**. You can also use the GitHub CLI.

```bash
gh workflow run build.yml --ref main
```

| Platform | Installer |
|---|---|
| Windows x64 | NSIS `.exe` |
| Windows ARM64 | NSIS `.exe` (cross-compiled on x64) |
| macOS Apple Silicon (ARM64) | `.dmg` |
| macOS Intel (x64) | `.dmg` |
| Linux x64 | `.deb`, `.rpm`, `.AppImage` |

Download the installers from the workflow run's **Artifacts** section, then upload them with their original names to the update folder (see **Self-update**).

The [installation guide](readme.txt) covers every target. It is uploaded as the `GitStar-installation-guide` artifact.

## AI setup

In **Settings → AI → AI provider**, choose **Anthropic Claude (API key)**, **Claude Code CLI (your own login)** or **DeepSeek**.

- **Claude** — Enter an Anthropic API key from console.anthropic.com. The default model is `claude-opus-5-5`. Choose `claude-haiku-5-5` for faster, lower-cost commit messages.
- **Claude Code CLI** — No API key in GitStar: it runs the installed `claude` command with your own Claude login (Pro/Max subscription or the key set up in the CLI). Install Claude Code and run `claude` once in a terminal to sign in. GitStar finds the CLI in PATH, `~/.local/bin`, Homebrew or npm; you can also set its path. The model list is the same as for Anthropic Claude. Tools, MCP servers and session history are switched off for these calls.
- **DeepSeek** — Enter a DeepSeek API key from platform.deepseek.com. The default model is `deepseek-flash`. Choose `deepseek-v4-pro` or enter another model ID under **Other…**.

GitStar stores the API key unencrypted in `settings.json` in the app configuration folder. On Windows, this is `%APPDATA%\hu.gitstar.app\settings.json`.

When a diff exceeds 600,000 characters for Claude or 300,000 for DeepSeek, GitStar sends only the beginning of the diff and indicates the truncation in the interface.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| F5 | Refresh |
| F1 | About (version, Git, AI provider, and settings file location) |
| Ctrl+O | Open a repository |
| Ctrl+1 / 2 / 3 | Changes / History / Compare |
| Ctrl+Tab | Switch to the next repository tab |
| Ctrl+Enter | Commit |
| Ctrl + backtick | Open the Git console |
| Alt+↑ / Alt+↓ | Jump to the previous or next change in the diff |
| ↑ / ↓ | Navigate the commit list |

## Project structure

```text
src-tauri/src/
  git.rs        Runs Git with a hidden window on Windows, stable output, and stdin
  commands.rs   Tauri commands for status, refs, log, diff, staging, commits, operations, and AI
  graph.rs      Commit graph lane allocation and unit tests
  ai.rs         AI API calls and prompts
  settings.rs   Settings persistence
www/
  index.html, css/app.css   Interface and themes using CSS variables
  js/app.js     Views, sidebar, toolbar, dialogs, AI panel, and console
  js/diff.js    Diff parsing and rendering, hunk and line patches, image diffs, and blame
  js/graph.js   SVG rendering for graph rows
  js/util.js    DOM helpers, menus, modals, Markdown, and icon sets
  js/i18n.js    Translation dictionary from Hungarian to English
```

The frontend uses native ES modules. Tauri embeds the `www` folder during the build.

## What's new

See [whatsnew.txt](whatsnew.txt) for the changes in each version.

## License

GitStar is freeware: free to download and use, including at work, but it may not be copied, redistributed, published, sold, or modified without the author's written permission. See [LICENSE](LICENSE).

If GitStar is useful to you, you can support its development with a small [donation](https://www.c64va.pro/register/donate.php) (also from the heart button in the toolbar).

© 2026 Zsolt Tarczali
