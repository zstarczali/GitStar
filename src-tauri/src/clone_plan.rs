//! Resolve clone destinations with native paths, before running any Git command.
use crate::settings::tr;
use serde::Serialize;
use std::path::{Component, Path};

#[derive(Serialize)]
pub struct ClonePlan {
    pub url: String,
    pub parent: String,
    pub name: String,
    pub dest: String,
}
pub fn plan(url: &str, parent: &str, name: &str, mode: &str) -> Result<ClonePlan, String> {
    let url = url.trim();
    if url.is_empty() || url.starts_with('-') || url.chars().any(char::is_control) {
        return Err(tr(
            "Adj meg egy érvényes repository-címet.",
            "Enter a valid repository URL.",
        ));
    }
    let url = match mode {
        "original" => url.to_string(),
        "ssh" | "https" => crate::remote_auth::convert(url, mode)?,
        _ => {
            return Err(tr(
                "Érvénytelen kapcsolatmód.",
                "Invalid connection method.",
            ))
        }
    };
    let parent = Path::new(parent.trim());
    if !parent.is_absolute() {
        return Err(tr(
            "Válassz egy teljes elérési útvonalú szülőmappát.",
            "Choose an absolute parent folder path.",
        ));
    }
    let source_path = reqwest::Url::parse(&url)
        .ok()
        .filter(|u| u.has_host())
        .map(|u| u.path().to_string());
    let source = source_path.as_deref().unwrap_or(&url).trim_end_matches('/');
    let inferred = source.rsplit(['/', '\\', ':']).next().unwrap_or("");
    let inferred = inferred.strip_suffix(".git").unwrap_or(inferred);
    let name = if name.trim().is_empty() {
        inferred
    } else {
        name.trim()
    };
    // One portable directory name; never let a repo name escape its parent.
    if name.is_empty()
        || name == "."
        || name == ".."
        || name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        || name.ends_with(['.', ' '])
        || Path::new(name).components().count() != 1
        || !matches!(
            Path::new(name).components().next(),
            Some(Component::Normal(_))
        )
    {
        return Err(tr(
            "Érvénytelen célmappanév.",
            "Invalid destination folder name.",
        ));
    }
    let name = name.to_string();
    let dest = parent.join(&name);
    Ok(ClonePlan {
        url,
        parent: parent.to_string_lossy().into_owned(),
        name,
        dest: dest.to_string_lossy().into_owned(),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn github_https_can_use_ssh_and_native_destination() {
        let root = std::env::temp_dir();
        let p = plan(
            "https://github.com/zstarczali/SID-Studio.git",
            root.to_str().unwrap(),
            "",
            "ssh",
        )
        .unwrap();
        assert_eq!(p.url, "git@github.com:zstarczali/SID-Studio.git");
        assert_eq!(p.name, "SID-Studio");
        assert_eq!(Path::new(&p.dest), root.join("SID-Studio"));
    }
    #[test]
    fn explicit_name_and_original_url_are_preserved() {
        let root = std::env::temp_dir();
        let p = plan(
            "git@custom:owner/repo.git",
            root.to_str().unwrap(),
            "My Project",
            "original",
        )
        .unwrap();
        assert_eq!(p.url, "git@custom:owner/repo.git");
        assert_eq!(Path::new(&p.dest), root.join("My Project"));
        assert_eq!(
            plan(
                "git@custom:repo.git",
                root.to_str().unwrap(),
                "",
                "original"
            )
            .unwrap()
            .name,
            "repo"
        );
    }
    #[test]
    fn clones_local_repository_to_native_path_with_spaces() {
        let root = std::env::temp_dir().join(format!(
            "gitstar-clone-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let source = root.join("source repo");
        std::fs::create_dir_all(&source).unwrap();
        let git = crate::git::Git::new("git");
        git.run(source.to_str().unwrap(), &["init"]).unwrap();
        git.run(
            source.to_str().unwrap(),
            &[
                "-c",
                "user.name=Clone Test",
                "-c",
                "user.email=clone@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--allow-empty",
                "-m",
                "Initial",
            ],
        )
        .unwrap();
        let p = plan(
            source.to_str().unwrap(),
            root.to_str().unwrap(),
            "clone with spaces",
            "original",
        )
        .unwrap();
        git.run_op(
            root.to_str().unwrap(),
            &["clone", "--progress", "--", &p.url, &p.dest],
        )
        .unwrap();
        assert!(Path::new(&p.dest).join(".git").is_dir());
        assert_eq!(
            git.run(&p.dest, &["log", "-1", "--format=%s"])
                .unwrap()
                .trim(),
            "Initial"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_paths_outside_parent_and_option_urls() {
        let root = std::env::temp_dir();
        for name in ["..", "../outside", "a/b", "a\\b", "/absolute", "C:drive"] {
            assert!(plan(
                "https://github.com/owner/repo.git",
                root.to_str().unwrap(),
                name,
                "original"
            )
            .is_err());
        }
        assert!(plan(
            "--upload-pack=anything",
            root.to_str().unwrap(),
            "repo",
            "original"
        )
        .is_err());
        assert!(plan(
            "https://github.com/owner/repo.git",
            "relative",
            "",
            "original"
        )
        .is_err());
    }
}
