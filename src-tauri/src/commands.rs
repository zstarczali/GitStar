//! Tauri commands: everything the UI can ask from the backend.

use crate::ai;
use crate::git::{git_dir, Git};
use crate::graph::{self, GraphRow};
use crate::settings::{tr, Settings, SettingsStore};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

pub struct AppState {
    pub settings: SettingsStore,
}

impl AppState {
    fn git(&self) -> Git {
        let st = self.settings.get();
        Git::new(&st.git_path).with_ssh_key(&st.ssh_key_path)
    }
}

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

fn s(v: &[String]) -> Vec<&str> {
    v.iter().map(|x| x.as_str()).collect()
}

// ───────────────────────────── settings ─────────────────────────────

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.get()
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<(), String> {
    state.settings.save(settings)
}

/// The UI tells the backend which language to use for its messages.
#[tauri::command]
pub fn set_ui_language(lang: String) {
    crate::settings::set_english(lang == "en");
}

#[tauri::command]
pub async fn git_version(state: State<'_, AppState>, path: Option<String>) -> Result<String, String> {
    let git = match path {
        Some(p) => Git::new(&p),
        None => state.git(),
    };
    blocking(move || git.version()).await
}

// ───────────────────────────── repository ─────────────────────────────

#[derive(Serialize)]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
}

fn repo_info(git: &Git, path: &str) -> Result<RepoInfo, String> {
    if !Path::new(path).exists() {
        return Err(format!("{}: {path}", tr("A mappa nem létezik", "The folder does not exist")));
    }
    let top = git
        .run(path, &["rev-parse", "--show-toplevel"])
        .map_err(|_| format!("{}: {path}", tr("Ez nem git repository", "Not a git repository")))?;
    let top = top.trim().replace('/', std::path::MAIN_SEPARATOR_STR);
    let name = Path::new(&top)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| top.clone());
    Ok(RepoInfo { path: top, name })
}

#[tauri::command]
pub async fn open_repo(state: State<'_, AppState>, path: String) -> Result<RepoInfo, String> {
    let git = state.git();
    blocking(move || repo_info(&git, &path)).await
}

#[tauri::command]
pub async fn init_repo(state: State<'_, AppState>, path: String) -> Result<RepoInfo, String> {
    let git = state.git();
    blocking(move || {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        git.run(&path, &["init"])?;
        repo_info(&git, &path)
    })
    .await
}

#[tauri::command]
pub async fn clone_repo(state: State<'_, AppState>, url: String, dest: String) -> Result<RepoInfo, String> {
    let git = state.git();
    blocking(move || {
        let parent = Path::new(&dest).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        if !parent.is_empty() {
            std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
        }
        let cwd = if parent.is_empty() { ".".to_string() } else { parent };
        git.run_op(&cwd, &["clone", "--progress", &url, &dest])?;
        repo_info(&git, &dest)
    })
    .await
}

// ───────────────────────────── status ─────────────────────────────

#[derive(Serialize, Clone)]
pub struct FileChange {
    pub path: String,
    pub old_path: Option<String>,
    /// one-letter status: M A D R C T U ?
    pub status: String,
    pub added: Option<i64>,
    pub deleted: Option<i64>,
}

#[derive(Serialize, Default)]
pub struct Status {
    pub branch: String,
    pub head: String,
    pub detached: bool,
    pub upstream: String,
    pub ahead: i64,
    pub behind: i64,
    /// Commits a push would send (ahead of upstream, or not on any remote).
    pub unpushed: i64,
    pub staged: Vec<FileChange>,
    pub unstaged: Vec<FileChange>,
    pub conflicted: Vec<FileChange>,
    /// merge | rebase | cherry-pick | revert | bisect | ""
    pub operation: String,
}

fn fc(path: &str, old: Option<&str>, status: char) -> FileChange {
    FileChange {
        path: path.to_string(),
        old_path: old.map(|s| s.to_string()),
        status: status.to_string(),
        added: None,
        deleted: None,
    }
}

fn read_status(git: &Git, repo: &str) -> Result<Status, String> {
    let out = git.run(
        repo,
        &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", "--ignore-submodules=dirty"],
    )?;
    let mut st = Status::default();
    let mut parts = out.split('\0');
    while let Some(entry) = parts.next() {
        if entry.is_empty() {
            continue;
        }
        if let Some(h) = entry.strip_prefix("# ") {
            if let Some(v) = h.strip_prefix("branch.oid ") {
                st.head = if v == "(initial)" { String::new() } else { v.to_string() };
            } else if let Some(v) = h.strip_prefix("branch.head ") {
                if v == "(detached)" {
                    st.detached = true;
                    st.branch = "HEAD".into();
                } else {
                    st.branch = v.to_string();
                }
            } else if let Some(v) = h.strip_prefix("branch.upstream ") {
                st.upstream = v.to_string();
            } else if let Some(v) = h.strip_prefix("branch.ab ") {
                let mut it = v.split(' ');
                st.ahead = it.next().and_then(|a| a.trim_start_matches('+').parse().ok()).unwrap_or(0);
                st.behind = it.next().and_then(|b| b.trim_start_matches('-').parse().ok()).unwrap_or(0);
            }
            continue;
        }
        let kind = entry.as_bytes()[0];
        match kind {
            b'1' | b'2' => {
                let n = if kind == b'1' { 9 } else { 10 };
                let f: Vec<&str> = entry.splitn(n, ' ').collect();
                if f.len() < n {
                    continue;
                }
                let xy: Vec<char> = f[1].chars().collect();
                let path = f[n - 1];
                let orig = if kind == b'2' { parts.next() } else { None };
                if xy[0] != '.' {
                    st.staged.push(fc(path, orig, xy[0]));
                }
                if xy[1] != '.' {
                    st.unstaged.push(fc(path, None, xy[1]));
                }
            }
            b'u' => {
                let f: Vec<&str> = entry.splitn(11, ' ').collect();
                if f.len() == 11 {
                    let mut c = fc(f[10], None, 'U');
                    c.old_path = Some(f[1].to_string()); // conflict code (UU, AA, DU ...)
                    st.conflicted.push(c);
                }
            }
            b'?' => st.unstaged.push(fc(&entry[2..], None, '?')),
            _ => {}
        }
    }
    if let Some(gd) = git_dir(git, repo) {
        st.operation = if gd.join("rebase-merge").exists() || gd.join("rebase-apply").exists() {
            "rebase"
        } else if gd.join("MERGE_HEAD").exists() {
            "merge"
        } else if gd.join("CHERRY_PICK_HEAD").exists() {
            "cherry-pick"
        } else if gd.join("REVERT_HEAD").exists() {
            "revert"
        } else if gd.join("BISECT_LOG").exists() {
            "bisect"
        } else {
            ""
        }
        .to_string();
    }
    // Commits waiting for push: vs. the upstream, or - for a branch that was
    // never pushed - the commits not on any remote branch.
    st.unpushed = if !st.upstream.is_empty() {
        st.ahead
    } else if !st.detached && !st.head.is_empty() && st.head != "(initial)" {
        let has_remote = git.run(repo, &["remote"]).map(|s| !s.trim().is_empty()).unwrap_or(false);
        if has_remote {
            git.run(repo, &["rev-list", "--count", "HEAD", "--not", "--remotes"])
                .ok()
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0)
        } else {
            0
        }
    } else {
        0
    };
    Ok(st)
}

#[tauri::command]
pub async fn status(state: State<'_, AppState>, repo: String) -> Result<Status, String> {
    let git = state.git();
    blocking(move || read_status(&git, &repo)).await
}

// ───────────────────────────── refs ─────────────────────────────

#[derive(Serialize)]
pub struct Branch {
    pub name: String,
    pub full: String,
    pub hash: String,
    pub upstream: String,
    pub ahead: i64,
    pub behind: i64,
    pub gone: bool,
    pub current: bool,
}

#[derive(Serialize)]
pub struct Tag {
    pub name: String,
    pub hash: String,
}

#[derive(Serialize)]
pub struct Stash {
    pub name: String,
    pub hash: String,
    pub message: String,
    pub time: i64,
}

#[derive(Serialize)]
pub struct Remote {
    pub name: String,
    pub url: String,
}

#[derive(Serialize)]
pub struct Refs {
    pub local: Vec<Branch>,
    pub remote: Vec<Branch>,
    pub tags: Vec<Tag>,
    pub stashes: Vec<Stash>,
    pub remotes: Vec<Remote>,
    pub head: String,
}

fn parse_track(t: &str) -> (i64, i64, bool) {
    let mut a = 0;
    let mut b = 0;
    if t.contains("gone") {
        return (0, 0, true);
    }
    for p in t.split(',') {
        let p = p.trim();
        if let Some(v) = p.strip_prefix("ahead ") {
            a = v.parse().unwrap_or(0);
        } else if let Some(v) = p.strip_prefix("behind ") {
            b = v.parse().unwrap_or(0);
        }
    }
    (a, b, false)
}

#[tauri::command]
pub async fn refs(state: State<'_, AppState>, repo: String) -> Result<Refs, String> {
    let git = state.git();
    blocking(move || {
        let out = git.run(
            &repo,
            &[
                "for-each-ref",
                "--format=%(refname)%00%(objectname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)%00%(*objectname)",
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
        )?;
        let mut r = Refs { local: vec![], remote: vec![], tags: vec![], stashes: vec![], remotes: vec![], head: String::new() };
        for line in out.lines() {
            let f: Vec<&str> = line.split('\0').collect();
            if f.len() < 6 {
                continue;
            }
            let full = f[0];
            if let Some(n) = full.strip_prefix("refs/heads/") {
                let (ahead, behind, gone) = parse_track(f[3]);
                let current = f[4] == "*";
                if current {
                    r.head = n.to_string();
                }
                r.local.push(Branch {
                    name: n.into(),
                    full: full.into(),
                    hash: f[1].into(),
                    upstream: f[2].into(),
                    ahead,
                    behind,
                    gone,
                    current,
                });
            } else if let Some(n) = full.strip_prefix("refs/remotes/") {
                if n.ends_with("/HEAD") {
                    continue;
                }
                r.remote.push(Branch {
                    name: n.into(),
                    full: full.into(),
                    hash: f[1].into(),
                    upstream: String::new(),
                    ahead: 0,
                    behind: 0,
                    gone: false,
                    current: false,
                });
            } else if let Some(n) = full.strip_prefix("refs/tags/") {
                let hash = if f[5].is_empty() { f[1] } else { f[5] };
                r.tags.push(Tag { name: n.into(), hash: hash.into() });
            }
        }
        if let Ok(st) = git.run(&repo, &["stash", "list", "--format=%gd%x1f%H%x1f%gs%x1f%ct"]) {
            for line in st.lines() {
                let f: Vec<&str> = line.split('\x1f').collect();
                if f.len() >= 4 {
                    r.stashes.push(Stash {
                        name: f[0].into(),
                        hash: f[1].into(),
                        message: f[2].into(),
                        time: f[3].parse().unwrap_or(0),
                    });
                }
            }
        }
        if let Ok(rm) = git.run(&repo, &["remote", "-v"]) {
            for line in rm.lines() {
                if !line.ends_with("(fetch)") {
                    continue;
                }
                let mut it = line.split_whitespace();
                if let (Some(n), Some(u)) = (it.next(), it.next()) {
                    r.remotes.push(Remote { name: n.into(), url: u.into() });
                }
            }
        }
        r.tags.sort_by(|a, b| natural_cmp(&b.name, &a.name));
        Ok(r)
    })
    .await
}

/// Version-aware compare so that v1.10 sorts after v1.9.
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let split = |s: &str| -> Vec<(String, u64)> {
        let mut out = vec![];
        let mut cur = String::new();
        let mut num = String::new();
        for ch in s.chars() {
            if ch.is_ascii_digit() {
                num.push(ch);
            } else {
                if !num.is_empty() {
                    out.push((std::mem::take(&mut cur), num.parse().unwrap_or(0)));
                    num.clear();
                }
                cur.push(ch);
            }
        }
        out.push((cur, num.parse().unwrap_or(0)));
        out
    };
    split(a).cmp(&split(b))
}

// ───────────────────────────── log ─────────────────────────────

#[derive(Serialize)]
pub struct Commit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub refs: Vec<String>,
    pub subject: String,
    pub graph: GraphRow,
}

#[derive(Deserialize)]
pub struct LogReq {
    pub limit: u32,
    /// None/empty = all refs
    pub rev: Option<String>,
    pub path: Option<String>,
    pub first_parent: Option<bool>,
}

#[tauri::command]
pub async fn log(state: State<'_, AppState>, repo: String, req: LogReq) -> Result<Vec<Commit>, String> {
    let git = state.git();
    blocking(move || {
        let limit = format!("-n{}", req.limit.max(1));
        let mut args: Vec<String> = vec![
            "log".into(),
            "--date-order".into(),
            limit,
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e".into(),
        ];
        if req.first_parent.unwrap_or(false) {
            args.push("--first-parent".into());
        }
        match req.rev.as_deref() {
            Some(r) if !r.is_empty() => args.push(r.into()),
            _ => {
                args.push("--exclude=refs/stash".into());
                args.push("--all".into());
                args.push("HEAD".into());
            }
        }
        if let Some(p) = req.path.as_deref().filter(|p| !p.is_empty()) {
            args.push("--follow".into());
            args.push("--".into());
            args.push(p.into());
        }
        let out = match git.run(&repo, &s(&args)) {
            Ok(o) => o,
            // empty repository: no HEAD yet
            Err(e) if e.contains("does not have any commits") || e.contains("unknown revision") || e.contains("bad default revision") => String::new(),
            Err(e) => return Err(e),
        };
        let mut commits = vec![];
        for rec in out.split('\x1e') {
            let rec = rec.trim_start_matches('\n');
            if rec.is_empty() {
                continue;
            }
            let f: Vec<&str> = rec.splitn(7, '\x1f').collect();
            if f.len() < 7 {
                continue;
            }
            commits.push(Commit {
                hash: f[0].into(),
                parents: f[1].split_whitespace().map(|x| x.to_string()).collect(),
                author: f[2].into(),
                email: f[3].into(),
                time: f[4].parse().unwrap_or(0),
                refs: f[5].split(", ").filter(|x| !x.is_empty()).map(|x| x.to_string()).collect(),
                subject: f[6].into(),
                graph: GraphRow::default(),
            });
        }
        let input: Vec<(String, Vec<String>)> = commits.iter().map(|c| (c.hash.clone(), c.parents.clone())).collect();
        for (c, g) in commits.iter_mut().zip(graph::layout(&input)) {
            c.graph = g;
        }
        Ok(commits)
    })
    .await
}

/// Search commits; returns matching hashes (the UI highlights them in the graph).
#[tauri::command]
pub async fn search_commits(state: State<'_, AppState>, repo: String, query: String, mode: String) -> Result<Vec<String>, String> {
    let git = state.git();
    blocking(move || {
        let mut args: Vec<String> = vec!["log".into(), "--exclude=refs/stash".into(), "--all".into(), "--format=%H".into(), "-n5000".into()];
        match mode.as_str() {
            "author" => {
                args.push(format!("--author={query}"));
                args.push("-i".into());
            }
            "content" => args.push(format!("-S{query}")),
            "path" => {
                args.push("--".into());
                args.push(query.clone());
            }
            _ => {
                args.push(format!("--grep={query}"));
                args.push("-i".into());
            }
        }
        let out = git.run(&repo, &s(&args)).unwrap_or_default();
        let mut v: Vec<String> = out.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
        if mode == "message" || mode.is_empty() {
            // hash prefix match
            if query.len() >= 4 && query.chars().all(|c| c.is_ascii_hexdigit()) {
                if let Ok(h) = git.run(&repo, &["rev-parse", "--verify", "--quiet", &format!("{query}^{{commit}}")]) {
                    let h = h.trim().to_string();
                    if !h.is_empty() && !v.contains(&h) {
                        v.insert(0, h);
                    }
                }
            }
        }
        Ok(v)
    })
    .await
}

// ───────────────────────────── commit details ─────────────────────────────

#[derive(Serialize)]
pub struct CommitDetails {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub author_email: String,
    pub author_time: i64,
    pub committer: String,
    pub committer_email: String,
    pub committer_time: i64,
    pub refs: Vec<String>,
    pub message: String,
    pub files: Vec<FileChange>,
    /// revision the file diffs of this commit are made against
    pub base: String,
}

fn empty_tree(git: &Git, repo: &str) -> String {
    git.run_stdin(repo, &["hash-object", "-t", "tree", "--stdin"], b"")
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "4b825dc642cb6eb9a060e54bf8d69288fbee4904".into())
}

/// Changed files between two revisions (`to` None = working tree).
fn changed_files(git: &Git, repo: &str, from: &str, to: Option<&str>) -> Result<Vec<FileChange>, String> {
    let mut a = vec!["diff", "--no-ext-diff", "-M", "-z", "--name-status", from];
    if let Some(t) = to {
        a.push(t);
    }
    let ns = git.run(repo, &a)?;
    let mut files: Vec<FileChange> = vec![];
    let mut it = ns.split('\0').filter(|x| !x.is_empty());
    while let Some(code) = it.next() {
        let c = code.chars().next().unwrap_or('M');
        if c == 'R' || c == 'C' {
            let old = it.next().unwrap_or("");
            let new = it.next().unwrap_or("");
            files.push(fc(new, Some(old), c));
        } else {
            let p = it.next().unwrap_or("");
            files.push(fc(p, None, c));
        }
    }
    let mut b = vec!["diff", "--no-ext-diff", "-M", "-z", "--numstat", from];
    if let Some(t) = to {
        b.push(t);
    }
    if let Ok(num) = git.run(repo, &b) {
        let mut it = num.split('\0');
        while let Some(rec) = it.next() {
            if rec.is_empty() {
                continue;
            }
            let f: Vec<&str> = rec.splitn(3, '\t').collect();
            if f.len() < 3 {
                continue;
            }
            let path = if f[2].is_empty() {
                let _old = it.next();
                it.next().unwrap_or("").to_string()
            } else {
                f[2].to_string()
            };
            if let Some(file) = files.iter_mut().find(|x| x.path == path) {
                file.added = f[0].parse().ok();
                file.deleted = f[1].parse().ok();
            }
        }
    }
    Ok(files)
}

#[tauri::command]
pub async fn commit_details(state: State<'_, AppState>, repo: String, hash: String) -> Result<CommitDetails, String> {
    let git = state.git();
    blocking(move || {
        let out = git.run(
            &repo,
            &["show", "-s", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%D%x1f%B", &hash],
        )?;
        let f: Vec<&str> = out.splitn(10, '\x1f').collect();
        if f.len() < 10 {
            return Err(tr("Nem olvasható commit", "Cannot read the commit"));
        }
        let parents: Vec<String> = f[1].split_whitespace().map(|x| x.to_string()).collect();
        let base = parents.first().cloned().unwrap_or_else(|| empty_tree(&git, &repo));
        let files = changed_files(&git, &repo, &base, Some(f[0]))?;
        Ok(CommitDetails {
            hash: f[0].into(),
            parents,
            author: f[2].into(),
            author_email: f[3].into(),
            author_time: f[4].parse().unwrap_or(0),
            committer: f[5].into(),
            committer_email: f[6].into(),
            committer_time: f[7].parse().unwrap_or(0),
            refs: f[8].split(", ").filter(|x| !x.is_empty()).map(|x| x.to_string()).collect(),
            message: f[9].trim_end().into(),
            files,
            base,
        })
    })
    .await
}

#[derive(Serialize)]
pub struct Comparison {
    pub from: String,
    pub to: String,
    pub base: String,
    pub files: Vec<FileChange>,
    /// commits reachable from `to` but not from `from`
    pub ahead: Vec<String>,
    /// commits reachable from `from` but not from `to`
    pub behind: Vec<String>,
}

/// Compare two revisions; empty `to` = working tree.
#[tauri::command]
pub async fn compare(state: State<'_, AppState>, repo: String, from: String, to: String, merge_base: bool) -> Result<Comparison, String> {
    let git = state.git();
    blocking(move || {
        let from_rev = if merge_base && !to.is_empty() {
            git.run(&repo, &["merge-base", &from, &to]).map(|s| s.trim().to_string()).unwrap_or(from.clone())
        } else {
            from.clone()
        };
        let files = changed_files(&git, &repo, &from_rev, if to.is_empty() { None } else { Some(&to) })?;
        let list = |range: String| -> Vec<String> {
            git.run(&repo, &["log", "--format=%h %s", "-n300", &range])
                .map(|o| o.lines().map(|l| l.to_string()).collect())
                .unwrap_or_default()
        };
        let (ahead, behind) = if to.is_empty() {
            (vec![], vec![])
        } else {
            (list(format!("{from}..{to}")), list(format!("{to}..{from}")))
        };
        Ok(Comparison { from, to, base: from_rev, files, ahead, behind })
    })
    .await
}

// ───────────────────────────── diff ─────────────────────────────

#[derive(Deserialize, Clone)]
pub struct DiffReq {
    /// unstaged | staged | untracked | range | conflict
    pub mode: String,
    pub path: String,
    pub old_path: Option<String>,
    pub from: Option<String>,
    /// None/empty = working tree
    pub to: Option<String>,
    pub context: Option<u32>,
    pub ignore_ws: Option<bool>,
}

#[derive(Serialize)]
pub struct DiffResult {
    pub text: String,
    pub binary: bool,
}

fn build_diff(git: &Git, repo: &str, r: &DiffReq) -> Result<DiffResult, String> {
    let ctx = format!("-U{}", r.context.unwrap_or(3));
    let mut args: Vec<String> = vec!["diff".into(), "--no-ext-diff".into(), "--no-color".into(), ctx, "-M".into()];
    if r.ignore_ws.unwrap_or(false) {
        args.push("-w".into());
    }
    let mut paths: Vec<String> = vec![];
    if let Some(o) = r.old_path.as_ref().filter(|o| !o.is_empty() && **o != r.path) {
        paths.push(o.clone());
    }
    paths.push(r.path.clone());
    let text = match r.mode.as_str() {
        "untracked" => {
            args.push("--no-index".into());
            args.push("--".into());
            args.push("/dev/null".into());
            args.push(r.path.clone());
            // --no-index exits with 1 when the files differ
            let out = git.raw(Some(repo), &s(&args), None)?;
            if out.code > 1 {
                return Err(out.stderr);
            }
            out.text()
        }
        "staged" => {
            args.push("--cached".into());
            args.push("--".into());
            args.extend(paths);
            git.run(repo, &s(&args))?
        }
        "range" => {
            if let Some(f) = r.from.as_ref().filter(|x| !x.is_empty()) {
                args.push(f.clone());
            }
            if let Some(t) = r.to.as_ref().filter(|x| !x.is_empty()) {
                args.push(t.clone());
            }
            args.push("--".into());
            args.extend(paths);
            git.run(repo, &s(&args))?
        }
        "conflict" => {
            // the file with conflict markers as it is in the working tree
            let full = Path::new(repo).join(&r.path);
            let content = std::fs::read_to_string(full).map_err(|e| e.to_string())?;
            return Ok(DiffResult { text: content, binary: false });
        }
        _ => {
            args.push("--".into());
            args.extend(paths);
            git.run(repo, &s(&args))?
        }
    };
    let binary = text.lines().any(|l| l.starts_with("Binary files ") || l == "GIT binary patch");
    Ok(DiffResult { text, binary })
}

#[tauri::command]
pub async fn diff(state: State<'_, AppState>, repo: String, req: DiffReq) -> Result<DiffResult, String> {
    let git = state.git();
    blocking(move || build_diff(&git, &repo, &req)).await
}

/// File content as base64; rev: "" = working tree, ":" = index, else a revision.
#[tauri::command]
pub async fn file_content(state: State<'_, AppState>, repo: String, rev: String, path: String) -> Result<String, String> {
    let git = state.git();
    blocking(move || {
        let bytes = if rev.is_empty() {
            std::fs::read(Path::new(&repo).join(&path)).map_err(|e| e.to_string())?
        } else if rev == ":" {
            git.run_bytes(&repo, &["show", &format!(":{path}")])?
        } else {
            git.run_bytes(&repo, &["show", &format!("{rev}:{path}")])?
        };
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
}

#[derive(Serialize)]
pub struct BlameLine {
    pub hash: String,
    pub author: String,
    pub time: i64,
    pub summary: String,
    pub line: usize,
    pub text: String,
}

#[tauri::command]
pub async fn blame(state: State<'_, AppState>, repo: String, path: String, rev: Option<String>) -> Result<Vec<BlameLine>, String> {
    let git = state.git();
    blocking(move || {
        let mut args = vec!["blame".to_string(), "--line-porcelain".into()];
        if let Some(r) = rev.filter(|r| !r.is_empty()) {
            args.push(r);
        }
        args.push("--".into());
        args.push(path);
        let out = git.run(&repo, &s(&args))?;
        let mut lines = vec![];
        let mut cur = BlameLine { hash: String::new(), author: String::new(), time: 0, summary: String::new(), line: 0, text: String::new() };
        for l in out.lines() {
            if let Some(t) = l.strip_prefix('\t') {
                cur.text = t.to_string();
                lines.push(std::mem::replace(
                    &mut cur,
                    BlameLine { hash: String::new(), author: String::new(), time: 0, summary: String::new(), line: 0, text: String::new() },
                ));
            } else if let Some(v) = l.strip_prefix("author ") {
                cur.author = v.into();
            } else if let Some(v) = l.strip_prefix("author-time ") {
                cur.time = v.parse().unwrap_or(0);
            } else if let Some(v) = l.strip_prefix("summary ") {
                cur.summary = v.into();
            } else if cur.hash.is_empty() {
                let mut it = l.split(' ');
                if let (Some(h), Some(_), Some(n)) = (it.next(), it.next(), it.next()) {
                    if h.len() >= 40 && h.chars().all(|c| c.is_ascii_hexdigit()) {
                        cur.hash = h.into();
                        cur.line = n.parse().unwrap_or(0);
                    }
                }
            }
        }
        Ok(lines)
    })
    .await
}

// ───────────────────────────── index / working tree ─────────────────────────────

#[tauri::command]
pub async fn stage(state: State<'_, AppState>, repo: String, paths: Vec<String>) -> Result<(), String> {
    let git = state.git();
    blocking(move || {
        let mut a = vec!["add".to_string(), "-A".into(), "--".into()];
        a.extend(paths);
        git.run(&repo, &s(&a)).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn stage_all(state: State<'_, AppState>, repo: String) -> Result<(), String> {
    let git = state.git();
    blocking(move || git.run(&repo, &["add", "-A"]).map(|_| ())).await
}

#[tauri::command]
pub async fn unstage(state: State<'_, AppState>, repo: String, paths: Vec<String>) -> Result<(), String> {
    let git = state.git();
    blocking(move || {
        let has_head = git.run(&repo, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_ok();
        let mut a: Vec<String> = if has_head {
            vec!["reset".into(), "-q".into(), "HEAD".into(), "--".into()]
        } else {
            vec!["rm".into(), "--cached".into(), "-r".into(), "-q".into(), "--".into()]
        };
        if paths.is_empty() {
            a.push(".".into());
        } else {
            a.extend(paths);
        }
        git.run(&repo, &s(&a)).map(|_| ())
    })
    .await
}

/// Throws away working tree changes; untracked files are deleted.
#[tauri::command]
pub async fn discard(state: State<'_, AppState>, repo: String, paths: Vec<String>, untracked: Vec<String>) -> Result<(), String> {
    let git = state.git();
    blocking(move || {
        if !paths.is_empty() {
            let mut a = vec!["checkout".to_string(), "--".into()];
            a.extend(paths);
            git.run(&repo, &s(&a))?;
        }
        if !untracked.is_empty() {
            let mut a = vec!["clean".to_string(), "-f".into(), "-q".into(), "--".into()];
            a.extend(untracked);
            git.run(&repo, &s(&a))?;
        }
        Ok(())
    })
    .await
}

/// Applies a patch made by the UI (hunk / line staging, discard).
#[tauri::command]
pub async fn apply_patch(state: State<'_, AppState>, repo: String, patch: String, cached: bool, reverse: bool) -> Result<(), String> {
    let git = state.git();
    blocking(move || {
        let mut a = vec!["apply", "--recount", "--whitespace=nowarn"];
        if cached {
            a.push("--cached");
        }
        if reverse {
            a.push("--reverse");
        }
        a.push("-");
        git.run_stdin(&repo, &a, patch.as_bytes()).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn resolve_conflict(state: State<'_, AppState>, repo: String, path: String, side: String) -> Result<(), String> {
    let git = state.git();
    blocking(move || {
        match side.as_str() {
            "ours" => {
                git.run(&repo, &["checkout", "--ours", "--", &path])?;
            }
            "theirs" => {
                git.run(&repo, &["checkout", "--theirs", "--", &path])?;
            }
            _ => {}
        }
        git.run(&repo, &["add", "--", &path]).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn add_to_gitignore(repo: String, pattern: String) -> Result<(), String> {
    blocking(move || {
        let p = Path::new(&repo).join(".gitignore");
        let mut content = std::fs::read_to_string(&p).unwrap_or_default();
        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&pattern);
        content.push('\n');
        std::fs::write(p, content).map_err(|e| e.to_string())
    })
    .await
}

// ───────────────────────────── commit ─────────────────────────────

#[tauri::command]
pub async fn commit(
    state: State<'_, AppState>,
    repo: String,
    message: String,
    amend: bool,
    reset_author: Option<bool>,
    signoff: bool,
    no_verify: bool,
) -> Result<String, String> {
    let git = state.git();
    blocking(move || {
        let mut a = vec!["commit", "--cleanup=strip", "-F", "-"];
        if amend {
            a.push("--amend");
            // Author of the amended commit becomes the configured user.name / user.email.
            if reset_author.unwrap_or(false) {
                a.push("--reset-author");
            }
        }
        if signoff {
            a.push("--signoff");
        }
        if no_verify {
            a.push("--no-verify");
        }
        git.run_stdin(&repo, &a, message.as_bytes())
    })
    .await
}

#[tauri::command]
pub async fn head_message(state: State<'_, AppState>, repo: String) -> Result<String, String> {
    let git = state.git();
    blocking(move || git.run(&repo, &["log", "-1", "--format=%B"]).map(|s| s.trim_end().to_string())).await
}

/// Message prepared by git for merge / revert / cherry-pick.
#[tauri::command]
pub async fn prepared_message(state: State<'_, AppState>, repo: String) -> Result<String, String> {
    let git = state.git();
    blocking(move || {
        let gd = git_dir(&git, &repo).ok_or("no git dir")?;
        let msg = std::fs::read_to_string(gd.join("MERGE_MSG")).unwrap_or_default();
        Ok(msg.lines().filter(|l| !l.starts_with('#')).collect::<Vec<_>>().join("\n").trim().to_string())
    })
    .await
}

// ───────────────────────────── generic git operation ─────────────────────────────

/// Runs any git command (used by the toolbar, menus and the console).
/// Returns the combined output.
#[tauri::command]
pub async fn git_op(state: State<'_, AppState>, repo: String, args: Vec<String>) -> Result<String, String> {
    let git = state.git();
    blocking(move || git.run_op(&repo, &s(&args))).await
}

// ───────────────────────────── shell helpers ─────────────────────────────

use std::process::Command as Proc;

fn spawn(cmd: &mut Proc) -> Result<(), String> {
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Shows a file (selected) or a folder in the system file manager.
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    let is_file = Path::new(&path).is_file();
    #[cfg(windows)]
    {
        let p = path.replace('/', "\\");
        let mut cmd = Proc::new("explorer");
        if is_file { cmd.arg(format!("/select,{p}")) } else { cmd.arg(&p) };
        spawn(&mut cmd)
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Proc::new("open");
        if is_file { cmd.args(["-R", &path]) } else { cmd.arg(&path) };
        spawn(&mut cmd)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        // xdg-open cannot select a file: open its folder.
        let dir = if is_file { Path::new(&path).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or(path) } else { path };
        spawn(Proc::new("xdg-open").arg(dir))
    }
}

/// Opens a file with its default application.
#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    #[cfg(windows)]
    return spawn(Proc::new("explorer").arg(path.replace('/', "\\")));
    #[cfg(target_os = "macos")]
    return spawn(Proc::new("open").arg(&path));
    #[cfg(not(any(windows, target_os = "macos")))]
    return spawn(Proc::new("xdg-open").arg(&path));
}

/// Opens a web page (e.g. a "new pull request" page) in the default browser.
/// Only http(s) URLs, so a crafted remote URL cannot launch anything else.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) || url.chars().any(|c| c.is_whitespace() || c == '"') {
        return Err(tr("Érvénytelen webcím.", "Invalid web address."));
    }
    #[cfg(windows)]
    return spawn(Proc::new("rundll32").args(["url.dll,FileProtocolHandler", &url]));
    #[cfg(target_os = "macos")]
    return spawn(Proc::new("open").arg(&url));
    #[cfg(not(any(windows, target_os = "macos")))]
    return spawn(Proc::new("xdg-open").arg(&url));
}

/// Opens a terminal in the given folder.
#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Windows Terminal if installed, else cmd.exe
        if Proc::new("wt").args(["-d", &path]).spawn().is_ok() {
            return Ok(());
        }
        spawn(Proc::new("cmd").args(["/C", "start", "", "cmd", "/K"]).current_dir(&path))
    }
    #[cfg(target_os = "macos")]
    {
        spawn(Proc::new("open").args(["-a", "Terminal", &path]))
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        // First terminal emulator that starts wins.
        let tries: [(&str, Vec<String>); 6] = [
            ("x-terminal-emulator", vec![]),
            ("gnome-terminal", vec![format!("--working-directory={path}")]),
            ("konsole", vec!["--workdir".into(), path.clone()]),
            ("xfce4-terminal", vec![format!("--working-directory={path}")]),
            ("kitty", vec!["--directory".into(), path.clone()]),
            ("xterm", vec![]),
        ];
        for (exe, args) in tries {
            if Proc::new(exe).args(&args).current_dir(&path).spawn().is_ok() {
                return Ok(());
            }
        }
        Err(tr("Nem található terminál program.", "No terminal application was found."))
    }
}

// ───────────────────────────── AI ─────────────────────────────

#[derive(Serialize)]
pub struct AiResult {
    pub text: String,
    pub truncated: bool,
}

#[tauri::command]
pub async fn ai_commit_message(state: State<'_, AppState>, repo: String) -> Result<AiResult, String> {
    let git = state.git();
    let cfg = state.settings.get();
    let (branch, recent, stat, diff) = blocking(move || {
        let stat = git.run(&repo, &["diff", "--cached", "--stat", "--no-color"])?;
        if stat.trim().is_empty() {
            return Err(tr("Nincs stage-elt változás. Előbb add hozzá a fájlokat (Stage).", "Nothing is staged. Stage some files first."));
        }
        let diff = git.run(&repo, &["diff", "--cached", "--no-color", "--no-ext-diff", "-U3", "-M"])?;
        let branch = git.run(&repo, &["branch", "--show-current"]).unwrap_or_default();
        let recent = git.run(&repo, &["log", "-15", "--format=%s"]).unwrap_or_default();
        Ok((branch.trim().to_string(), recent, stat, diff))
    })
    .await?;
    let (diff, truncated) = ai::cut_diff(&diff, &cfg.ai_provider);
    let text = ai::complete(ai::AiRequest {
        provider: &cfg.ai_provider,
        api_key: cfg.ai_key(),
        model: cfg.ai_model_id(),
        system: ai::commit_system(&cfg.ai_language, &cfg.commit_style),
        user: ai::commit_user(&branch, &recent, &stat, &diff, truncated),
        effort: "low",
        max_tokens: 4000,
    })
    .await?;
    let text = text.trim().trim_matches('`').trim().to_string();
    Ok(AiResult { text, truncated })
}

#[derive(Deserialize)]
pub struct AnalyzeReq {
    /// commit | range | working | staged | file
    pub kind: String,
    pub hash: Option<String>,
    pub from: Option<String>,
    /// empty = working tree
    pub to: Option<String>,
    pub path: Option<String>,
    pub question: Option<String>,
    pub merge_base: Option<bool>,
    /// for kind = file: the diff the UI shows
    pub diff_text: Option<String>,
}

#[tauri::command]
pub async fn ai_analyze(state: State<'_, AppState>, repo: String, req: AnalyzeReq) -> Result<AiResult, String> {
    let git = state.git();
    let cfg = state.settings.get();
    let kind = req.kind.clone();
    let question = req.question.clone().filter(|q| !q.trim().is_empty());
    let (context, diff) = blocking(move || -> Result<(String, String), String> {
        let path_args = |a: &mut Vec<String>| {
            if let Some(p) = req.path.as_ref().filter(|p| !p.is_empty()) {
                a.push("--".into());
                a.push(p.clone());
            }
        };
        match req.kind.as_str() {
            "commit" => {
                let h = req.hash.clone().ok_or_else(|| tr("hiányzó commit", "missing commit"))?;
                let header = git.run(&repo, &["show", "-s", "--format=commit %H%nAuthor: %an <%ae>%nDate: %aI%n%n%B", &h])?;
                let parents = git.run(&repo, &["show", "-s", "--format=%P", &h])?;
                let base = parents.split_whitespace().next().map(|x| x.to_string()).unwrap_or_else(|| empty_tree(&git, &repo));
                let mut a: Vec<String> = vec!["diff".into(), "--no-color".into(), "--no-ext-diff".into(), "-M".into(), "--stat".into(), "-p".into(), base, h];
                path_args(&mut a);
                Ok((header, git.run(&repo, &s(&a))?))
            }
            "range" => {
                let from = req.from.clone().ok_or_else(|| tr("hiányzó kiinduló revízió", "missing start revision"))?;
                let to = req.to.clone().unwrap_or_default();
                let base = if req.merge_base.unwrap_or(false) && !to.is_empty() {
                    git.run(&repo, &["merge-base", &from, &to]).map(|x| x.trim().to_string()).unwrap_or(from.clone())
                } else {
                    from.clone()
                };
                let to_label = if to.is_empty() { "working tree".to_string() } else { to.clone() };
                let mut ctx = format!("Comparing FROM `{from}` TO `{to_label}`.\n");
                if !to.is_empty() {
                    let ahead = git.run(&repo, &["log", "--format=%h %an: %s", "-n200", &format!("{from}..{to}")]).unwrap_or_default();
                    let behind = git.run(&repo, &["log", "--format=%h %an: %s", "-n200", &format!("{to}..{from}")]).unwrap_or_default();
                    ctx.push_str(&format!("\nCommits only in `{to}`:\n{}\n", if ahead.trim().is_empty() { "(none)" } else { ahead.trim() }));
                    ctx.push_str(&format!("\nCommits only in `{from}`:\n{}\n", if behind.trim().is_empty() { "(none)" } else { behind.trim() }));
                }
                let mut a: Vec<String> = vec!["diff".into(), "--no-color".into(), "--no-ext-diff".into(), "-M".into(), "--stat".into(), "-p".into(), base];
                if !to.is_empty() {
                    a.push(to);
                }
                path_args(&mut a);
                Ok((ctx, git.run(&repo, &s(&a))?))
            }
            "staged" => {
                let mut a: Vec<String> = vec!["diff".into(), "--cached".into(), "--no-color".into(), "-M".into(), "--stat".into(), "-p".into()];
                path_args(&mut a);
                Ok(("Staged (not yet committed) changes.".into(), git.run(&repo, &s(&a))?))
            }
            "file" => Ok((
                format!("Diff of a single file: {}", req.path.clone().unwrap_or_default()),
                req.diff_text.clone().unwrap_or_default(),
            )),
            _ => {
                let has_head = git.run(&repo, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_ok();
                let mut a: Vec<String> = vec!["diff".into(), "--no-color".into(), "-M".into(), "--stat".into(), "-p".into()];
                if has_head {
                    a.push("HEAD".into());
                } else {
                    a.push("--cached".into());
                }
                path_args(&mut a);
                Ok(("All uncommitted changes (staged and unstaged) compared to HEAD.".into(), git.run(&repo, &s(&a))?))
            }
        }
    })
    .await?;
    if diff.trim().is_empty() {
        return Err(tr("Nincs mit elemezni: a diff üres.", "Nothing to analyse: the diff is empty."));
    }
    let (diff, truncated) = ai::cut_diff(&diff, &cfg.ai_provider);
    let mut user = String::new();
    user.push_str(&context);
    user.push_str("\n\n<diff>\n");
    user.push_str(&diff);
    user.push_str("\n</diff>\n");
    if truncated {
        user.push_str("\nNote: the diff was cut because of its size; say which parts you could not see.\n");
    }
    user.push_str("\n");
    match &question {
        Some(q) => {
            user.push_str("Question about this diff: ");
            user.push_str(q);
        }
        None => user.push_str("Review this change using the default structure."),
    }
    let system = if kind == "range" { ai::compare_system(&cfg.ai_language) } else { ai::analyze_system(&cfg.ai_language) };
    let text = ai::complete(ai::AiRequest {
        provider: &cfg.ai_provider,
        api_key: cfg.ai_key(),
        model: cfg.ai_model_id(),
        system,
        user,
        effort: "medium",
        max_tokens: 16000,
    })
    .await?;
    Ok(AiResult { text, truncated })
}

/// Settings → AI → Test: sends a tiny request with the values typed in the
/// dialog (not yet saved) and reports the model's answer and the time taken.
#[tauri::command]
pub async fn ai_test(provider: String, api_key: String, model: String) -> Result<String, String> {
    let started = std::time::Instant::now();
    let text = ai::complete(ai::AiRequest {
        provider: &provider,
        api_key: &api_key,
        model: &model,
        system: "You are a connection test. Answer with exactly: OK".to_string(),
        user: "Connection test. Answer with exactly: OK".to_string(),
        effort: "low",
        max_tokens: 200,
    })
    .await?;
    let first: String = text.lines().next().unwrap_or("").chars().take(80).collect();
    Ok(format!("{model} · {} ms · „{first}”", started.elapsed().as_millis()))
}

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub tauri: String,
    pub git: String,
    pub settings_path: String,
    pub os: String,
}

/// Data for the About box.
#[tauri::command]
pub async fn app_info(state: State<'_, AppState>) -> Result<AppInfo, String> {
    let git = state.git();
    let git_ver = blocking(move || git.version()).await.unwrap_or_else(|e| e);
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        tauri: tauri::VERSION.to_string(),
        git: git_ver,
        settings_path: state.settings.path.to_string_lossy().into_owned(),
        os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
    })
}

// ───────────────────────────── git identity ─────────────────────────────

#[derive(Serialize)]
pub struct GitIdentity {
    /// From `git config --global`.
    pub global_name: String,
    pub global_email: String,
    /// What a commit in `repo` would use (repo config wins over global).
    pub name: String,
    pub email: String,
}

fn config_get(git: &Git, repo: Option<&str>, scope: Option<&str>, key: &str) -> String {
    let mut args = vec!["config"];
    if let Some(s) = scope {
        args.push(s);
    }
    args.extend(["--get", key]);
    git.raw(repo, &args, None).map(|o| if o.code == 0 { o.text().trim().to_string() } else { String::new() }).unwrap_or_default()
}

#[tauri::command]
pub async fn git_identity(state: State<'_, AppState>, repo: Option<String>) -> Result<GitIdentity, String> {
    let git = state.git();
    blocking(move || {
        let r = repo.as_deref().filter(|p| !p.is_empty());
        let global_name = config_get(&git, None, Some("--global"), "user.name");
        let global_email = config_get(&git, None, Some("--global"), "user.email");
        let (name, email) = match r {
            Some(p) => (config_get(&git, Some(p), None, "user.name"), config_get(&git, Some(p), None, "user.email")),
            None => (global_name.clone(), global_email.clone()),
        };
        Ok(GitIdentity { global_name, global_email, name, email })
    })
    .await
}

/// Writes user.name / user.email to the global git config (empty = unset).
#[tauri::command]
pub async fn set_git_identity(state: State<'_, AppState>, name: String, email: String) -> Result<(), String> {
    let git = state.git();
    blocking(move || {
        for (key, val) in [("user.name", name.trim()), ("user.email", email.trim())] {
            if val.is_empty() {
                // exit code 5 = key was not set: fine
                let out = git.raw(None, &["config", "--global", "--unset", key], None)?;
                if out.code != 0 && out.code != 5 {
                    return Err(out.stderr.trim().to_string());
                }
            } else {
                let out = git.raw(None, &["config", "--global", key, val], None)?;
                if out.code != 0 {
                    return Err(out.stderr.trim().to_string());
                }
            }
        }
        Ok(())
    })
    .await
}

// ───────────────────────────── splash screen ─────────────────────────────

static SPLASH_DONE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// What is remembered of the main window: everything but the visibility
/// (the main window must stay hidden until the splash is over).
pub fn window_state_flags() -> tauri_plugin_window_state::StateFlags {
    tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE
}

/// How long the splash screen is shown; the main window appears after it.
pub const SPLASH_TIME: std::time::Duration = std::time::Duration::from_secs(3);

/// Creates the main window (hidden: `create: false` + `visible: false` in
/// tauri.conf.json). It is created after the splash, not together with it:
/// two WebView2 windows created at the same moment sometimes left the main
/// one without a page.
pub fn create_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let cfg = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .ok_or("no 'main' window in tauri.conf.json")?;
    tauri::WebviewWindowBuilder::from_config(app, &cfg)
        .and_then(|b| b.build())
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Shows the main window and closes the splash (only the first call counts).
pub fn finish_splash(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(main) = app.get_webview_window("main") else {
        return; // keep the splash: closing the last window would quit the app
    };
    if SPLASH_DONE.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let _ = main.show();
    // Windows moves a window created hidden when it is first shown: put it back
    // where it was saved (size, position, maximized).
    {
        use tauri_plugin_window_state::WindowExt;
        let _ = main.restore_state(window_state_flags());
    }
    let _ = main.set_focus();
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
}

// ───────────────────────────── ssh / zoom ─────────────────────────────

#[tauri::command]
pub fn ssh_info() -> crate::ssh::SshInfo {
    crate::ssh::info()
}

#[tauri::command]
pub fn ssh_public_key(key: String) -> Result<String, String> {
    crate::ssh::public_key(&key)
}

#[tauri::command]
pub async fn ssh_generate_key(state: State<'_, AppState>, key: String, comment: String) -> Result<String, String> {
    let git = state.settings.get().git_path;
    blocking(move || crate::ssh::generate(&git, &key, &comment)).await
}

#[tauri::command]
pub async fn ssh_test(state: State<'_, AppState>, key: String, host: String) -> Result<String, String> {
    let git = state.settings.get().git_path;
    blocking(move || crate::ssh::test(&git, &key, &host)).await
}

/// Zoom of the whole page (Ctrl + / Ctrl - / Ctrl 0, Ctrl + mouse wheel).
#[tauri::command]
pub fn set_zoom(window: tauri::WebviewWindow, scale: f64) -> Result<(), String> {
    window.set_zoom(scale.clamp(0.5, 3.0)).map_err(|e| e.to_string())
}

/// Writes the window size/position to disk now (not only at exit, which is
/// skipped when the process is ended by the system, an installer or a crash).
pub fn save_window_state(app: &tauri::AppHandle) {
    use tauri_plugin_window_state::AppHandleExt;
    let _ = app.save_window_state(window_state_flags());
}

/// Saves the window state shortly after the last move/resize.
pub fn save_window_state_later(app: &tauri::AppHandle) {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static LAST: AtomicU64 = AtomicU64::new(0);
    static PENDING: AtomicBool = AtomicBool::new(false);
    let now = || SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    LAST.store(now(), Ordering::SeqCst);
    if PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        while now().saturating_sub(LAST.load(Ordering::SeqCst)) < 1000 {
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        PENDING.store(false, Ordering::SeqCst);
        let main = app.clone();
        let _ = app.run_on_main_thread(move || save_window_state(&main));
    });
}
