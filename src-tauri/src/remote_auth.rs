//! Explicit per-remote protocol selection. Credentials remain in SSH / Git helpers.
use crate::{git::Git, settings::tr};
use serde::Serialize;

fn github_path(url: &str) -> Option<String> {
    let path = if let Some(path) = url.strip_prefix("git@github.com:") {
        path.to_string()
    } else {
        let u = reqwest::Url::parse(url).ok()?;
        if u.host_str()? != "github.com"
            || u.port().is_some()
            || u.query().is_some()
            || u.fragment().is_some()
            || u.password().is_some()
        {
            return None;
        }
        match u.scheme() {
            "https" if u.username().is_empty() => {}
            "ssh" if u.username() == "git" => {}
            _ => return None,
        }
        u.path().trim_start_matches('/').to_string()
    };
    let path = path.trim_end_matches('/');
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|s| {
            s.is_empty()
                || *s == "."
                || *s == ".."
                || !s
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
    {
        return None;
    }
    Some(path.to_string())
}
fn convert(url: &str, mode: &str) -> Result<String, String> {
    let path = github_path(url).ok_or_else(|| tr("Az automatikus váltás csak szokásos github.com remote-címekhez használható. Egyéb címnél használd az URL módosítása menüt.", "Automatic switching supports standard github.com remote URLs. For other addresses, use Change URL."))?;
    match mode {
        "ssh" => Ok(format!("git@github.com:{path}")),
        "https" => Ok(format!("https://github.com/{path}")),
        _ => Err(tr(
            "Érvénytelen hitelesítési mód.",
            "Invalid authentication mode.",
        )),
    }
}
fn urls(git: &Git, repo: &str, name: &str) -> Result<(String, Option<String>), String> {
    if !git.run(repo, &["remote"])?.lines().any(|n| n == name) {
        return Err(tr("A remote nem található.", "Remote not found."));
    }
    let read = |suffix: &str| -> Result<Vec<String>, String> {
        let out = git.raw(
            Some(repo),
            &[
                "config",
                "--local",
                "--get-all",
                &format!("remote.{name}.{suffix}"),
            ],
            None,
        )?;
        if out.code != 0 && out.code != 1 {
            return Err(out.stderr);
        }
        Ok(out.text().lines().map(str::to_string).collect())
    };
    let fetch = read("url")?;
    let push = read("pushurl")?;
    if fetch.len() != 1 || push.len() > 1 {
        return Err(tr("Több URL-t vagy örökölt konfigurációt használó remote: a címeket kézzel kell módosítani.", "Remote uses multiple URLs or inherited configuration; edit its URLs manually."));
    }
    Ok((fetch[0].clone(), push.first().cloned()))
}
#[derive(Serialize)]
pub struct AuthInfo {
    pub fetch_url: String,
    pub push_url: String,
    pub ssh_fetch: String,
    pub ssh_push: String,
    pub https_fetch: String,
    pub https_push: String,
}
pub fn info(git: &Git, repo: &str, name: &str) -> Result<AuthInfo, String> {
    let (fetch, push) = urls(git, repo, name)?;
    let push = push.unwrap_or_else(|| fetch.clone());
    Ok(AuthInfo {
        ssh_fetch: convert(&fetch, "ssh")?,
        ssh_push: convert(&push, "ssh")?,
        https_fetch: convert(&fetch, "https")?,
        https_push: convert(&push, "https")?,
        fetch_url: fetch,
        push_url: push,
    })
}
pub fn set(git: &Git, repo: &str, name: &str, mode: &str) -> Result<(), String> {
    let (fetch, push) = urls(git, repo, name)?;
    // Validate both before editing either; preserve separate push destinations.
    let new_fetch = convert(&fetch, mode)?;
    let new_push = push.as_ref().map(|u| convert(u, mode)).transpose()?;
    let key = format!("remote.{name}.url");
    git.run(
        repo,
        &["config", "--local", "--replace-all", &key, &new_fetch],
    )?;
    if let Some(url) = new_push {
        if let Err(e) = git.run(
            repo,
            &[
                "config",
                "--local",
                "--replace-all",
                &format!("remote.{name}.pushurl"),
                &url,
            ],
        ) {
            if let Err(rollback) =
                git.run(repo, &["config", "--local", "--replace-all", &key, &fetch])
            {
                return Err(format!("{e}\nRollback: {rollback}"));
            }
            return Err(e);
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn converts_protocols_without_changing_repository() {
        for u in [
            "https://github.com/owner/repo.git",
            "git@github.com:owner/repo.git",
            "ssh://git@github.com/owner/repo.git",
        ] {
            assert_eq!(convert(u, "ssh").unwrap(), "git@github.com:owner/repo.git");
            assert_eq!(
                convert(u, "https").unwrap(),
                "https://github.com/owner/repo.git"
            );
        }
    }
    #[test]
    fn preserves_distinct_push_target_and_validates_before_writing() {
        let dir = std::env::temp_dir().join(format!(
            "gitstar-auth-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&dir).unwrap();
        let repo = dir.to_str().unwrap();
        let git = Git::new("git");
        git.run(repo, &["init"]).unwrap();
        git.run(
            repo,
            &[
                "remote",
                "add",
                "origin",
                "https://github.com/team/source.git",
            ],
        )
        .unwrap();
        git.run(
            repo,
            &[
                "remote",
                "set-url",
                "--push",
                "origin",
                "https://github.com/me/fork.git",
            ],
        )
        .unwrap();
        set(&git, repo, "origin", "ssh").unwrap();
        let current = info(&git, repo, "origin").unwrap();
        assert_eq!(current.fetch_url, "git@github.com:team/source.git");
        assert_eq!(current.push_url, "git@github.com:me/fork.git");
        git.run(
            repo,
            &[
                "remote",
                "set-url",
                "--push",
                "origin",
                "git@custom:me/fork.git",
            ],
        )
        .unwrap();
        assert!(set(&git, repo, "origin", "https").is_err());
        assert_eq!(
            urls(&git, repo, "origin").unwrap().0,
            "git@github.com:team/source.git"
        );
        git.run(repo, &["config", "--unset-all", "remote.origin.pushurl"])
            .unwrap();
        set(&git, repo, "origin", "https").unwrap();
        assert_eq!(
            urls(&git, repo, "origin").unwrap(),
            ("https://github.com/team/source.git".into(), None)
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rejects_custom_hosts_credentials_and_ports() {
        for u in [
            "https://github.com.evil/owner/repo",
            "https://token@github.com/owner/repo",
            "ssh://git@github.com:2222/owner/repo",
            "git@alias:owner/repo",
            "https://gitlab.com/owner/repo",
            "https://github.com/owner/repo?token=x",
            "/local/path",
        ] {
            assert!(convert(u, "ssh").is_err(), "{u}");
        }
    }
}
