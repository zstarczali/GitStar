//! SSH support for git remotes: a private key chosen in the settings, key
//! generation, the public key for GitHub/GitLab, and a connection test.
//!
//! The key is handed to git through `GIT_SSH_COMMAND`, so it is used by every
//! git operation (fetch, pull, push, clone) without touching ~/.ssh/config.

use crate::settings::tr;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// ssh options used with the chosen key (git and the connection test).
fn key_options(key: &str) -> Vec<String> {
    let mut o = vec![
        "-i".to_string(),
        key.replace('\\', "/"),
        "-o".into(),
        "IdentitiesOnly=yes".into(),
        // no terminal to ask on: fail instead of hanging on a prompt
        "-o".into(),
        "BatchMode=yes".into(),
        // first connection to a new host: accept its key (a changed key is still refused)
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
    ];
    if cfg!(target_os = "macos") {
        // passphrase stored in the macOS keychain (ssh-add --apple-use-keychain)
        for x in ["IgnoreUnknown=UseKeychain", "UseKeychain=yes", "AddKeysToAgent=yes"] {
            o.push("-o".into());
            o.push(x.into());
        }
    }
    o
}

/// Quotes one word for the POSIX shell git runs GIT_SSH_COMMAND with.
fn sh_quote(s: &str) -> String {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_=./:@".contains(c)) {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

/// Sets up the ssh environment of a git (or ssh) process.
pub fn apply_env(cmd: &mut Command, key: &str) {
    #[cfg(target_os = "macos")]
    if let Some(sock) = login_agent_sock() {
        cmd.env("SSH_AUTH_SOCK", sock);
    }
    if !key.trim().is_empty() {
        let mut line = String::from("ssh");
        for o in key_options(key.trim()) {
            line.push(' ');
            line.push_str(&sh_quote(&o));
        }
        cmd.env("GIT_SSH_COMMAND", line);
    }
}

/// Starts looking up the login shell's ssh-agent in the background, so the
/// first git command does not wait for it.
pub fn warm_up() {
    #[cfg(target_os = "macos")]
    std::thread::spawn(|| {
        let _ = login_agent_sock();
    });
}

/// An app started from the Finder/Dock does not get the environment of the
/// user's shell: an ssh-agent set up in ~/.zshrc (1Password, Secretive,
/// a custom ssh-agent…) would be invisible to git. Ask the login shell once.
#[cfg(target_os = "macos")]
fn login_agent_sock() -> Option<&'static str> {
    use std::sync::OnceLock;
    static SOCK: OnceLock<Option<String>> = OnceLock::new();
    SOCK.get_or_init(|| {
        let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into());
        let mut child = Command::new(shell)
            .args(["-ilc", "printf '__GS_SOCK__%s__GS_END__' \"$SSH_AUTH_SOCK\""])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let start = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if start.elapsed() < std::time::Duration::from_secs(5) => {
                    std::thread::sleep(std::time::Duration::from_millis(50))
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
            }
        }
        let out = child.wait_with_output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let sock = text.split("__GS_SOCK__").nth(1)?.split("__GS_END__").next()?.trim().to_string();
        (!sock.is_empty() && Path::new(&sock).exists()).then_some(sock)
    })
    .as_deref()
}

fn home() -> PathBuf {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(PathBuf::from).unwrap_or_default()
}

/// ssh / ssh-keygen: preferably the one shipped with Git for Windows (the one
/// git itself uses), then the Windows OpenSSH, then whatever is on PATH.
fn tool(name: &str, git_exe: &str) -> String {
    #[cfg(windows)]
    {
        let exe = format!("{name}.exe");
        let mut roots: Vec<PathBuf> = Vec::new();
        let g = Path::new(git_exe.trim());
        if g.is_absolute() {
            // <root>\cmd\git.exe, <root>\bin\git.exe, <root>\mingw64\bin\git.exe
            for up in g.ancestors().skip(2).take(2) {
                roots.push(up.to_path_buf());
            }
        }
        for v in ["ProgramFiles", "ProgramW6432", "LOCALAPPDATA"] {
            if let Some(p) = std::env::var_os(v) {
                roots.push(PathBuf::from(&p).join("Git"));
                roots.push(PathBuf::from(&p).join("Programs").join("Git"));
            }
        }
        for r in roots {
            let p = r.join("usr").join("bin").join(&exe);
            if p.is_file() {
                return p.to_string_lossy().into_owned();
            }
        }
        if let Some(w) = std::env::var_os("SystemRoot") {
            let p = PathBuf::from(w).join("System32").join("OpenSSH").join(&exe);
            if p.is_file() {
                return p.to_string_lossy().into_owned();
            }
        }
    }
    let _ = git_exe;
    name.to_string()
}

fn run(cmd: &mut Command) -> Result<(i32, String), String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().map_err(|e| e.to_string())?;
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&err);
    }
    Ok((out.status.code().unwrap_or(-1), text.trim().to_string()))
}

#[derive(Serialize)]
pub struct SshInfo {
    /// ~/.ssh
    pub dir: String,
    /// Private keys in ~/.ssh that have a .pub pair
    pub keys: Vec<String>,
    /// Suggested file name for a new key (not existing yet)
    pub new_key: String,
}

pub fn info() -> SshInfo {
    let dir = home().join(".ssh");
    let mut keys = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "pub") {
                let private = p.with_extension("");
                if private.is_file() {
                    keys.push(private.to_string_lossy().into_owned());
                }
            }
        }
    }
    keys.sort();
    let new_key = ["id_ed25519", "id_ed25519_gitstar"]
        .iter()
        .map(|n| dir.join(n))
        .find(|p| !p.exists())
        .unwrap_or_else(|| dir.join("id_ed25519_gitstar2"));
    SshInfo { dir: dir.to_string_lossy().into_owned(), keys, new_key: new_key.to_string_lossy().into_owned() }
}

fn pub_path(key: &str) -> PathBuf {
    PathBuf::from(format!("{}.pub", key.trim()))
}

pub fn public_key(key: &str) -> Result<String, String> {
    if key.trim().is_empty() {
        return Err(tr("Nincs megadva privát kulcs.", "No private key is set."));
    }
    let p = pub_path(key);
    std::fs::read_to_string(&p).map(|s| s.trim().to_string()).map_err(|e| {
        format!("{}: {} ({e})", tr("Nem olvasható a publikus kulcs", "Cannot read the public key"), p.display())
    })
}

pub fn generate(git_exe: &str, key: &str, comment: &str) -> Result<String, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err(tr("Nincs megadva a kulcs fájlneve.", "No file name for the key."));
    }
    if Path::new(key).exists() || pub_path(key).exists() {
        return Err(tr("Ez a kulcsfájl már létezik: ", "This key file already exists: ") + key);
    }
    if let Some(dir) = Path::new(key).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let exe = tool("ssh-keygen", git_exe);
    let (code, text) = run(Command::new(&exe).args(["-q", "-t", "ed25519", "-N", "", "-C", comment.trim(), "-f", key]))
        .map_err(|e| format!("{} ({exe}): {e}", tr("Nem sikerült elindítani az ssh-keygen-t", "Could not start ssh-keygen")))?;
    if code != 0 {
        return Err(if text.is_empty() { format!("ssh-keygen: exit code {code}") } else { text });
    }
    public_key(key)
}

/// `ssh -T git@github.com` with the key: tells whether the host accepts it.
pub fn test(git_exe: &str, key: &str, host: &str) -> Result<String, String> {
    let host = host.trim();
    if host.is_empty() || host.starts_with('-') || host.chars().any(char::is_whitespace) {
        return Err(tr("Érvénytelen cím.", "Invalid address."));
    }
    let exe = tool("ssh", git_exe);
    let mut cmd = Command::new(&exe);
    cmd.arg("-T");
    if !key.trim().is_empty() {
        cmd.args(key_options(key.trim()));
    } else {
        cmd.args(["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"]);
    }
    cmd.args(["-o", "ConnectTimeout=15", host]);
    #[cfg(target_os = "macos")]
    if let Some(sock) = login_agent_sock() {
        cmd.env("SSH_AUTH_SOCK", sock);
    }
    let (code, text) =
        run(&mut cmd).map_err(|e| format!("{} ({exe}): {e}", tr("Nem sikerült elindítani az ssh-t", "Could not start ssh")))?;
    // GitHub/Bitbucket answer with exit code 1 even when the key is accepted
    let low = text.to_lowercase();
    let ok = code == 0
        || low.contains("successfully authenticated")
        || low.contains("welcome to gitlab")
        || low.contains("authenticated via")
        || low.contains("logged in as");
    if ok { Ok(text) } else { Err(if text.is_empty() { format!("ssh: exit code {code}") } else { text }) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoting() {
        assert_eq!(sh_quote("C:/Users/x/.ssh/id_ed25519"), "C:/Users/x/.ssh/id_ed25519");
        assert_eq!(sh_quote("/Users/a b/k"), "'/Users/a b/k'");
        assert_eq!(sh_quote("it's"), r#"'it'\''s'"#);
    }
}
