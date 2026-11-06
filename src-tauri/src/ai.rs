//! AI features through the Claude Messages API (raw HTTP, API key auth).

use serde_json::{json, Value};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2026-10-21";
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

/// Largest diff sent to the model; above this the diff is cut and the user is
/// told so in the result.
pub const MAX_DIFF_CHARS: usize = 600_000;

pub struct AiRequest<'a> {
    pub api_key: &'a str,
    pub model: &'a str,
    pub system: String,
    pub user: String,
    pub effort: &'a str,
    pub max_tokens: u32,
}

/// Models that accept the `output_config.effort` parameter.
fn supports_effort(model: &str) -> bool {
    !(model.starts_with("claude-haiku-4") || model.contains("sonnet-4-5") || model.contains("3-"))
}

/// Models that accept server-side `fallbacks: "default"`.
fn supports_fallback(model: &str) -> bool {
    matches!(model, "claude-opus-5-5" | "claude-opus-5" | "claude-fable-5-1" | "claude-sonnet-5-5")
}

pub async fn complete(req: AiRequest<'_>) -> Result<String, String> {
    if req.api_key.trim().is_empty() {
        return Err("Nincs megadva Anthropic API kulcs (Beállítások → AI).".into());
    }
    let mut body = json!({
        "model": req.model,
        "max_tokens": req.max_tokens,
        "system": req.system,
        "messages": [{ "role": "user", "content": req.user }],
    });
    if supports_effort(req.model) {
        body["output_config"] = json!({ "effort": req.effort });
    }
    let fallback = supports_fallback(req.model);
    if fallback {
        body["fallbacks"] = json!("default");
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut http = client
        .post(API_URL)
        .header("x-api-key", req.api_key.trim())
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json");
    if fallback {
        http = http.header("anthropic-beta", FALLBACK_BETA);
    }
    let resp = http.json(&body).send().await.map_err(|e| format!("Hálózati hiba: {e}"))?;
    let status = resp.status();
    let v: Value = resp.json().await.map_err(|e| format!("Hibás válasz: {e}"))?;
    if !status.is_success() {
        let msg = v["error"]["message"].as_str().unwrap_or("ismeretlen hiba");
        let kind = v["error"]["type"].as_str().unwrap_or("");
        return Err(match status.as_u16() {
            401 => format!("Érvénytelen API kulcs ({msg})"),
            429 => format!("Túl sok kérés / kvóta elfogyott, próbáld később ({msg})"),
            529 => format!("Az API túlterhelt, próbáld később ({msg})"),
            c => format!("API hiba {c} {kind}: {msg}"),
        });
    }
    if v["stop_reason"].as_str() == Some("refusal") {
        let expl = v["stop_details"]["explanation"].as_str().unwrap_or("");
        return Err(format!("A modell elutasította a kérést. {expl}"));
    }
    let text: String = v["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    if text.trim().is_empty() {
        return Err("Üres válasz érkezett a modelltől.".into());
    }
    let mut text = text.trim().to_string();
    if v["stop_reason"].as_str() == Some("max_tokens") {
        text.push_str("\n\n_(A válasz a maximális hossznál megszakadt.)_");
    }
    Ok(text)
}

pub fn cut_diff(diff: &str) -> (String, bool) {
    if diff.len() <= MAX_DIFF_CHARS {
        return (diff.to_string(), false);
    }
    let mut end = MAX_DIFF_CHARS;
    while !diff.is_char_boundary(end) {
        end -= 1;
    }
    (diff[..end].to_string(), true)
}

fn lang_name(lang: &str) -> &'static str {
    if lang == "en" { "English" } else { "Hungarian" }
}

pub fn commit_system(lang: &str, style: &str) -> String {
    let style_rule = match style {
        "simple" => "Write a single concise summary line (max 72 characters). Add a short body only if the change really needs explanation.",
        "detailed" => "Write a summary line (max 72 characters), a blank line, then a body of bullet points explaining what changed and why.",
        _ => "Use the Conventional Commits format: `type(scope): summary` (types: feat, fix, refactor, perf, docs, style, test, build, ci, chore). Summary line max 72 characters. If the change is not trivial, add a blank line and a short body with bullet points.",
    };
    format!(
        "You write git commit messages. Read the staged diff and write the commit message for it.\n\
         {style_rule}\n\
         Write the message in {lang}; keep code identifiers, file names and the Conventional Commits type keyword as they are.\n\
         Describe the intent of the change, not a file-by-file list. Do not invent changes that are not in the diff.\n\
         Answer with the commit message only: no preamble, no quotes, no code fences.",
        lang = lang_name(lang)
    )
}

pub fn commit_user(branch: &str, recent: &str, stat: &str, diff: &str, truncated: bool) -> String {
    let mut s = String::new();
    s.push_str(&format!("Current branch: {branch}\n\n"));
    if !recent.trim().is_empty() {
        s.push_str("Recent commit subjects in this repository (match their style and language if consistent):\n");
        s.push_str(recent.trim());
        s.push_str("\n\n");
    }
    s.push_str("Staged changes (stat):\n");
    s.push_str(stat.trim());
    s.push_str("\n\n<diff>\n");
    s.push_str(diff);
    s.push_str("\n</diff>\n");
    if truncated {
        s.push_str("\nNote: the diff was cut because of its size; base the message on the stat for the rest.\n");
    }
    s
}

pub fn analyze_system(lang: &str) -> String {
    format!(
        "You are a senior code reviewer inside a git client. The user shows you a diff and asks you about it.\n\
         Answer in {lang}, formatted as Markdown (headings, bullet lists, `code`).\n\
         Default structure when no specific question is asked:\n\
         ## Összefoglaló / Summary — what the change does and why, in a few sentences.\n\
         ## Fő változások / Main changes — grouped by topic, not by file.\n\
         ## Lehetséges hibák és kockázatok / Possible bugs and risks — concrete issues with file and line references; say clearly if you found none.\n\
         ## Javaslatok / Suggestions — optional improvements.\n\
         Use the heading language that matches {lang}. Be specific and concise; do not repeat the diff back.",
        lang = lang_name(lang)
    )
}

pub fn compare_system(lang: &str) -> String {
    format!(
        "You are a senior engineer inside a git client. The user compares two revisions (branches, tags or commits) \
         and gives you the commit list between them and the diff from the first to the second.\n\
         Answer in {lang}, formatted as Markdown.\n\
         Structure: a short overview of how the second revision differs from the first; the differences grouped by feature/topic; \
         behaviour changes and breaking changes; risks for merging (conflicts, missing migrations, removed APIs); \
         and a recommendation. Refer to files and commits concretely.",
        lang = lang_name(lang)
    )
}
