mod ai;
mod commands;
mod git;
mod graph;
mod settings;
mod claude_cli;
mod update;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Remembers the main window's size, position and maximized state
        // (saved on exit, restored when the window is created). Not the
        // visibility: the main window stays hidden until the splash is over.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(commands::window_state_flags())
                .with_denylist(&["splashscreen"])
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir().join("GitStar"));
            app.manage(AppState { settings: settings::SettingsStore::load(dir) });
            // Splash screen for SPLASH_TIME: the main window is created hidden right
            // after the splash, loads in the background, and is shown when the time is up.
            let started = std::time::Instant::now();
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(300));
                if let Err(e) = commands::create_main_window(&handle) {
                    eprintln!("GitStar: could not create the main window: {e}");
                }
                std::thread::sleep(commands::SPLASH_TIME.saturating_sub(started.elapsed()));
                commands::finish_splash(&handle);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Splash closed by the user before the UI was ready: show the main window anyway.
            if window.label() == "splashscreen" && matches!(event, tauri::WindowEvent::Destroyed) {
                commands::finish_splash(window.app_handle());
            }
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
            commands::open_url,
            commands::ai_commit_message,
            commands::ai_analyze,
            commands::ai_test,
            commands::app_info,
            commands::git_identity,
            commands::set_git_identity,
            update::check_for_update,
            update::download_and_install_update,
            update::update_server_check,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitStar");
}
