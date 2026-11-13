<p align="center">
  <img src="assets/icon.svg" alt="GitStar logo" width="200" height="200">
</p>

<h1 align="center">GitStar</h1>

GitStar is a Git client with a **Tauri 2 and Rust** backend and a Fork-style interface. It runs Git operations through the installed Git executable, so hooks, credential helpers, Git LFS, and Git configuration work as they do on the command line.

Current version **1.0.7**. The main-window Donate button appears after 10 minutes of foreground use. Time spent with the window unfocused or hidden pauses the timer, which resets each time GitStar starts. Donations are also available from the About dialog.

See [What's new](whatsnew.txt) for the release history.

## Features

- **Repository tab indicators** — Tabs show the number of files with uncommitted changes, including staged, unstaged, and untracked files. Conflicts highlight the badge in red. Hover over the badge for a breakdown. All open repositories are checked at startup and every five seconds while the app is in focus, including tabs that have not been selected.
- **Authentication** — Choose SSH or HTTPS per GitHub remote from Settings or the remote context menu, with separate Fetch/Push URL previews. SSH uses your selected key or agent; HTTPS uses saved Git credentials.
- **Repositories** — Open, clone, and initialize repositories, work across tabs, and reopen recent repositories.
- **Local changes** — View unstaged, staged, and conflicting files. Stage, unstage, or discard changes by file, **hunk, or line**. Click a line number to select it or Shift-click to select a range. Select files with checkboxes, Shift (range), Ctrl or the list header's select-all box, then stage, unstage or discard them together; discarding staged files returns them to HEAD. Add files to `.gitignore`.
- **Commits** — Amend commits, use Ctrl+Enter to commit, check the summary against a 72-character limit, and start with a prefilled merge message.
- **AI commit messages** — Generate Conventional Commits, simple summaries, or detailed messages in English or Hungarian using the staged diff and recent commit style.
- **History** — Browse a color-coded commit graph with merge lanes, a virtualized list, and ref labels. Search by message, hash, author, content (`-S`), or path, and view file history and blame.
- **Visual diffs** — Switch between side-by-side and unified views with **word-level highlighting**. Navigate changes with the minimap or Alt+↑ / Alt+↓. Choose 3, 10, or 25 lines of context or show the full file. Ignore whitespace, wrap lines, compare images side by side or with a slider, and inspect conflict markers. Open any change in an **external compare tool** such as DiffStar (Settings → Git; `$LOCAL` / `$REMOTE` arguments, working tree files are passed as themselves so edits are saved).
- **Comparisons** — Compare branches, tags, commits, or the working tree. Use merge-base mode (`A...B`) and see commits unique to each side.
- **AI diff analysis** — Explain a commit, compare branches or revisions for incoming changes, risks, and merge issues, or summarize an individual file diff.
- **Branches, remotes, tags, and stashes** — Check out branches with optional stashing, create, rename, or delete local and remote branches, and set upstreams. Merge with fast-forward, no-fast-forward, fast-forward-only, or squash. Rebase, cherry-pick, revert, or reset in soft, mixed, or hard mode. Fetch, pull with merge, rebase, or fast-forward-only and optional autostash, and push with upstream, force-with-lease, or tag options. Create, push, or delete tags, push, apply, pop, drop, or branch from stashes, and add, edit, or remove remotes.
- **In-progress operations** — Continue, skip, or abort a merge, rebase, cherry-pick, or revert where Git supports it. Resolve conflicts using ours, theirs, or manual edits.
- **Git console** — Run Git commands with command history and view output from app operations.
- **Themes and layout** — Choose dark, light, AI neon, retro, modern, modern dark, or system themes, adjust the font size, and resize panels. The neon theme includes gradients, animated lines, and custom icons; the retro theme looks like an 8-bit home computer on a CRT (monospace font, scanlines, striped toolbar, blinking cursor); the modern theme is light frosted glass on a soft pastel gradient (rounded controls, gradient buttons, pill toggles), and modern dark is the same glass look on a deep aurora gradient.
- **Self-update** — GitStar looks for a newer installer at startup (and from **About → Check for updates**). It reads the update server set in Settings (default `https://www.c64va.pro/`; a bare server address means its `downloads/GitStar/` folder, a longer address is used as the folder itself), downloads the installer for the platform with a progress bar, runs it, and restarts. Upload the installers from the GitHub Actions build there with their original names, such as `GitStar_0.3.0_x64-setup.exe`.
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

Download the installers from the workflow run's **Artifacts** section, or publish them with
**Actions → Publish → Run workflow**. Enter the successful **Build installers** run ID (the
number in its `/actions/runs/…` URL). The workflow extracts the `GitStar-*` artifacts and uploads
the installers with their original names, plus `readme.txt`, `whatsnew.txt`, and `LICENSE`, to
`/www/downloads/GitStar/` on `ftpx.forpsi.com`. It uses explicit FTPS with certificate validation,
checks uploaded file sizes, then removes older GitStar installers from that folder.
The newly uploaded release, newer releases, documentation and unrelated files are retained.
If any upload or size verification fails, cleanup does not run.

Set the repository Actions secret **FTP_PASSWORD** for the `www.c64va.pro` FTP account before
publishing. The workflow rejects failed or unrelated build runs and missing installation-guide
files. No password is stored in the repository. A manually dispatched workflow must exist on
the default branch to appear in the Actions UI; select `develop` in **Use workflow from** when
publishing from that branch.

**Forpsi country/IP access:** the FTP account must allow the publishing runner's origin.
The observed GitHub-hosted runners were rejected as `DENY CZ HU [US, United States]`
while Hungarian connections were allowed. In the Forpsi administration, open
**Web hosting → c64va.pro → FTP → Restrict FTP access**, inspect the FTP log, and allow
**US / United States** for these hosted runners. Save the setting before retrying Publish.
This is an account setting, shared with SID Studio, not a different username or password.
A `530 Login authentication failed` can also mean a country/IP denial; the script reports
the failing operation and server reply with secrets redacted. See
[Forpsi's FTP access settings](https://support.forpsi.hu/kb/a825/specialis-beallitasok-ftp-hozzafereshez.aspx).

Publish helper checks (no FTP connection required):

```bash
python3 -m unittest discover -s tests -p 'publish_artifacts_test.py'
```

On macOS the app is not signed by Apple, so Gatekeeper may say that GitStar "is damaged and can't be opened". After copying the app to Applications, remove the quarantine flag in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/GitStar.app
# if it still does not open:
xattr -cr /Applications/GitStar.app
```

The [installation guide](readme.txt) covers every target. It is uploaded as the `GitStar-installation-guide` artifact.

### Existing macOS packaging warning

Tauri reports that the existing bundle identifier `hu.gitstar.app` ends in
`.app`. This is a naming recommendation and does not prevent building the
application. The identifier is retained in 1.0.2 to preserve the existing
application identity and settings location.

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
  clone_plan.rs   Clone URL, folder-name validation and native destination paths
  remote_auth.rs  Per-remote SSH / HTTPS conversion and validation
  process.rs    Network process supervision and idle timeout
  ssh.rs        SSH key selection, generation and connection tests
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

## Troubleshooting a push that keeps spinning

GitStar disables interactive Git credential prompts, including inherited
`GIT_ASKPASS` / `SSH_ASKPASS` programs from editors such as VS Code. If no
saved HTTPS credential is available, the operation fails instead of waiting
for a hidden login window. Configure your Git credential helper beforehand,
or use an SSH remote with your key configured under **Settings → SSH**.
An HTTPS URL does not use an SSH key.

Push, fetch, pull, clone and ls-remote stop after 120 seconds without stdout
or stderr output; progress output resets the timer. GitStar also stops their
helper processes. This measures console inactivity, so a long silent server
operation can time out too. After a timed-out push, fetch/check the remote
before retrying: the server may already have accepted the changes. Rebuild
and restart GitStar to apply these changes to an already running app.

## Choosing SSH or HTTPS

Open **Settings → Authentication** and select a remote, or right-click a
remote in the sidebar and choose **Authentication: SSH / HTTPS…**. The dialog
shows the current Fetch/Push URLs and previews the selected protocol. **Save**
updates only that repository's remote configuration; a separate push target
is preserved. Automatic conversion supports standard github.com addresses.
Custom SSH aliases, ports, other hosts and multiple URLs should be edited
through **Change URL** instead.

**SSH** uses the private key saved under **Settings → SSH** or your SSH agent.
Use **Connection test** to check whether GitHub accepts the key. A successful
key test establishes your identity, but access to each repository also depends
on that account's permissions. **HTTPS** uses saved Git credentials; an SSH
key cannot authenticate an HTTPS remote. This selector chooses the protocol;
it does not create an HTTPS login or token.

## Cloning a GitHub repository

Set **Settings → Git → Git root folder** with **Browse** to choose the default
parent for new clones. Existing repositories stay in place. Open **Clone**,
paste a repository URL, and select the connection method:

- **SSH (GitHub)** uses the selected SSH key/agent and converts a standard
  GitHub HTTPS link to SSH. This is initially selected when an SSH key is set.
- **HTTPS (GitHub)** uses saved Git credentials.
- **Use the supplied URL** preserves custom hosts, SSH aliases and local paths.

The parent folder has a **Browse** button. The repository folder name is
inferred from the URL and can be edited. **Fill paths from repository** resets
the folder name from the URL and restores the default parent (Git root, last
clone parent, or the active repository's parent). The preview shows both the
actual clone URL and the complete destination; Clone is enabled only when the
plan is valid. Paths are joined natively on macOS, Linux and Windows.

For example, with Git root `/Users/zsolt/Dev`, the link
`https://github.com/zstarczali/SID-Studio.git` and **SSH (GitHub)** produce:

```text
Clone URL: git@github.com:zstarczali/SID-Studio.git
Destination: /Users/zsolt/Dev/SID-Studio
```

Cloning over HTTPS does not use your SSH key. A missing or invalid GitHub
credential must be configured separately; switching to SSH uses your SSH setup.
