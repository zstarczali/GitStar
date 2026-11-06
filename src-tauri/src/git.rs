//! Thin wrapper around the git.exe command line client.
//!
//! Every git operation of GitStar goes through `git.exe` (or the binary set in
//! the settings), so the behaviour is identical to the command line: hooks,
//! credential helpers, config, LFS filters all work as usual.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone)]
pub struct Git {
    pub exe: String,
}

pub struct Output {
    pub code: i32,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

impl Output {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
}

impl Git {
    pub fn new(exe: &str) -> Self {
        let exe = if exe.trim().is_empty() { "git".to_string() } else { exe.trim().to_string() };
        Git { exe }
    }

    fn command(&self, repo: Option<&str>, args: &[&str]) -> Command {
        let mut cmd = Command::new(&self.exe);
        if let Some(r) = repo {
            cmd.current_dir(r);
        }
        // Stable, machine-readable output regardless of the user's config.
        cmd.args(["-c", "core.quotepath=false", "-c", "color.ui=never", "-c", "core.pager=cat"]);
        cmd.args(args);
        cmd.env("GIT_TERMINAL_PROMPT", "0");
        cmd.env("GIT_OPTIONAL_LOCKS", "0");
        cmd.env("LC_ALL", "C");
        cmd.env("LANG", "C");
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }

    /// Runs git and returns the raw output, whatever the exit code.
    pub fn raw(&self, repo: Option<&str>, args: &[&str], stdin: Option<&[u8]>) -> Result<Output, String> {
        let mut cmd = self.command(repo, args);
        if stdin.is_some() {
            cmd.stdin(Stdio::piped());
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Nem sikerült elindítani a git-et ({}): {}", self.exe, e))?;
        if let Some(data) = stdin {
            if let Some(mut si) = child.stdin.take() {
                si.write_all(data).map_err(|e| e.to_string())?;
            }
        }
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        Ok(Output {
            code: out.status.code().unwrap_or(-1),
            stdout: out.stdout,
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
    }

    /// Runs git, fails with stderr on a non-zero exit code.
    pub fn run(&self, repo: &str, args: &[&str]) -> Result<String, String> {
        let out = self.raw(Some(repo), args, None)?;
        if out.code != 0 {
            return Err(error_text(&out, args));
        }
        Ok(out.text())
    }

    pub fn run_bytes(&self, repo: &str, args: &[&str]) -> Result<Vec<u8>, String> {
        let out = self.raw(Some(repo), args, None)?;
        if out.code != 0 {
            return Err(error_text(&out, args));
        }
        Ok(out.stdout)
    }

    pub fn run_stdin(&self, repo: &str, args: &[&str], input: &[u8]) -> Result<String, String> {
        let out = self.raw(Some(repo), args, Some(input))?;
        if out.code != 0 {
            return Err(error_text(&out, args));
        }
        Ok(out.text())
    }

    /// Runs a command whose combined stdout+stderr is the interesting part
    /// (fetch, push, pull, merge ...).
    pub fn run_op(&self, repo: &str, args: &[&str]) -> Result<String, String> {
        let out = self.raw(Some(repo), args, None)?;
        let mut text = out.text();
        if !out.stderr.trim().is_empty() {
            if !text.is_empty() && !text.ends_with('\n') {
                text.push('\n');
            }
            text.push_str(&out.stderr);
        }
        if out.code != 0 {
            return Err(if text.trim().is_empty() { error_text(&out, args) } else { text });
        }
        Ok(text)
    }

    pub fn version(&self) -> Result<String, String> {
        let out = self.raw(None, &["--version"], None)?;
        Ok(out.text().trim().to_string())
    }
}

fn error_text(out: &Output, args: &[&str]) -> String {
    let msg = out.stderr.trim();
    if msg.is_empty() {
        let o = out.text();
        if o.trim().is_empty() {
            format!("git {} (kilépési kód: {})", args.join(" "), out.code)
        } else {
            o.trim().to_string()
        }
    } else {
        msg.to_string()
    }
}

/// Resolves the .git directory (handles worktrees and submodules).
pub fn git_dir(git: &Git, repo: &str) -> Option<std::path::PathBuf> {
    let out = git.run(repo, &["rev-parse", "--absolute-git-dir"]).ok()?;
    let p = out.trim();
    if p.is_empty() { None } else { Some(Path::new(p).to_path_buf()) }
}
