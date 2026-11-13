mod ai;
mod commands;
mod git;
mod clone_plan;
mod remote_auth;
mod process;
mod graph;
mod settings;
mod claude_cli;
mod ssh;
mod update;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // macOS: no File/View/Window/Help menu, only what the system requires: the
    // application menu (Hide, Quit) and Edit, without which Cmd+C/V/X/A/Z do
    // not work in the text fields. Windows/Linux have no menu bar at all.
    #[cfg(target_os = "macos")]
    let builder = builder.enable_macos_default_menu(false).menu(|app| {
        use tauri::menu::{Menu, PredefinedMenuItem as P, Submenu};
        let app_menu = Submenu::with_items(app, "GitStar", true, &[
            &P::hide(app, None)?,
            &P::hide_others(app, None)?,
            &P::show_all(app, None)?,
            &P::separator(app)?,
            &P::quit(app, None)?,
        ])?;
        let edit = Submenu::with_items(app, "Edit", true, &[
            &P::undo(app, None)?,
            &P::redo(app, None)?,
            &P::separator(app)?,
            &P::cut(app, None)?,
            &P::copy(app, None)?,
            &P::paste(app, None)?,
            &P::select_all(app, None)?,
        ])?;
        Menu::with_items(app, &[&app_menu, &edit])
    });
    builder
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
            ssh::warm_up();
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
            // Main window: write its size/position to disk right away, not only
            // at a clean exit (which does not always happen).
            if window.label() == "main" {
                match event {
                    tauri::WindowEvent::CloseRequested { .. } => commands::save_window_state(window.app_handle()),
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                        commands::save_window_state_later(window.app_handle())
                    }
                    _ => {}
                }
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
            commands::clone_plan,
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
            commands::discard_staged,
            commands::apply_patch,
            commands::resolve_conflict,
            commands::add_to_gitignore,
            commands::commit,
            commands::head_message,
            commands::prepared_message,
            commands::git_op,
            commands::remote_auth_info,
            commands::set_remote_auth,
            commands::reveal_in_explorer,
            commands::open_file,
            commands::external_diff,
            commands::detect_diff_tool,
            commands::open_terminal,
            commands::open_url,
            commands::ai_commit_message,
            commands::ai_analyze,
            commands::ai_test,
            commands::app_info,
            commands::git_identity,
            commands::set_git_identity,
            commands::ssh_info,
            commands::ssh_public_key,
            commands::ssh_generate_key,
            commands::ssh_test,
            commands::set_zoom,
            commands::clipboard_text,
            update::check_for_update,
            update::download_and_install_update,
            update::update_server_check,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitStar");
}
