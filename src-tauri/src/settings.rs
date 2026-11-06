//! Persistent settings (app config dir / settings.json).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Language of backend messages (errors shown in the UI). Set by the UI.
static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn set_english(on: bool) {
    ENGLISH.store(on, Ordering::Relaxed);
}

/// Picks the Hungarian or the English text.
pub fn tr(hu: &str, en: &str) -> String {
    if ENGLISH.load(Ordering::Relaxed) { en.to_string() } else { hu.to_string() }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    /// Path of git.exe; empty = "git" from PATH.
    pub git_path: String,
    /// "dark" | "light" | "system"
    pub theme: String,
    /// "auto" | "hu" | "en"
    pub ui_language: String,
    /// "anthropic" | "deepseek"
    pub ai_provider: String,
    pub anthropic_api_key: String,
    pub ai_model: String,
    pub deepseek_api_key: String,
    pub deepseek_model: String,
    /// Language of AI generated text: "hu" | "en"
    pub ai_language: String,
    /// "conventional" | "simple" | "detailed"
    pub commit_style: String,
    pub recent_repos: Vec<String>,
    pub open_repos: Vec<String>,
    pub active_repo: String,
    /// Pull button: "merge" | "rebase" | "ff" | "ask" (show the dialog every time)
    pub pull_mode: String,
    pub pull_autostash: bool,
    /// "split" | "unified"
    pub diff_mode: String,
    pub diff_context: u32,
    pub diff_ignore_ws: bool,
    pub diff_wrap: bool,
    pub log_limit: u32,
    pub font_size: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            git_path: String::new(),
            theme: "dark".into(),
            ui_language: "auto".into(),
            ai_provider: "anthropic".into(),
            anthropic_api_key: String::new(),
            ai_model: "claude-opus-5-5".into(),
            deepseek_api_key: String::new(),
            deepseek_model: "deepseek-flash".into(),
            ai_language: "hu".into(),
            commit_style: "conventional".into(),
            recent_repos: vec![],
            open_repos: vec![],
            active_repo: String::new(),
            pull_mode: "merge".into(),
            pull_autostash: true,
            diff_mode: "split".into(),
            diff_context: 3,
            diff_ignore_ws: false,
            diff_wrap: false,
            log_limit: 1500,
            font_size: 13,
        }
    }
}

impl Settings {
    /// API key of the selected AI provider.
    pub fn ai_key(&self) -> &str {
        if self.ai_provider == "deepseek" { &self.deepseek_api_key } else { &self.anthropic_api_key }
    }

    /// Model id of the selected AI provider.
    pub fn ai_model_id(&self) -> &str {
        if self.ai_provider == "deepseek" { &self.deepseek_model } else { &self.ai_model }
    }
}

pub struct SettingsStore {
    pub path: PathBuf,
    pub data: Mutex<Settings>,
}

impl SettingsStore {
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("settings.json");
        let data = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
            .unwrap_or_default();
        SettingsStore { path, data: Mutex::new(data) }
    }

    pub fn get(&self) -> Settings {
        self.data.lock().unwrap().clone()
    }

    pub fn save(&self, s: Settings) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, json).map_err(|e| e.to_string())?;
        *self.data.lock().unwrap() = s;
        Ok(())
    }
}
