mod ai;
mod commands;
mod git;
mod graph;
mod settings;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir().join("GitStar"));
            app.manage(AppState { settings: settings::SettingsStore::load(dir) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::git_version,
            commands::set_ui_language,
            commands::open_repo,
            commands::init_repo,
            commands::clone_repo,
            commands::status,
            commands::refs,
            commands::log,
            commands::search_commits,
            commands::commit_details,
            commands::compare,
            commands::diff,
            commands::file_content,
            commands::blame,
            commands::stage,
            commands::stage_all,
            commands::unstage,
            commands::discard,
            commands::apply_patch,
            commands::resolve_conflict,
            commands::add_to_gitignore,
            commands::commit,
            commands::head_message,
            commands::prepared_message,
            commands::git_op,
            commands::reveal_in_explorer,
            commands::open_file,
            commands::open_terminal,
            commands::ai_commit_message,
            commands::ai_analyze,
            commands::ai_test,
            commands::app_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitStar");
}
