// Trove — Tauri application entry.

mod db;
mod index;
mod model;
mod quickfind;
mod watch;

use db::Db;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;
use watch::{WatchTx, Watchers};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // In-app auto-update (signed) + relaunch-after-install. Desktop only.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    // Global hotkey for Quick Find (desktop only). The handler toggles the
    // launcher window on key-press; the specific accelerator is registered in
    // setup() from saved settings (or the default).
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::ShortcutState;
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        quickfind::toggle_launcher(app);
                    }
                })
                .build(),
        );
    }

    builder
        .setup(|app| {
            // Open (or create) the index DB under the app's data directory.
            let dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&dir).ok();
            let conn = db::open(&dir.join("trove.db")).expect("failed to open trove.db");
            app.manage(Db(Mutex::new(conn)));
            app.manage(index::ScanFlags::default());

            // Clear any libraries left stuck in 'scanning' from a prior crash.
            if let Some(db) = app.try_state::<Db>() {
                if let Ok(conn) = db.0.lock() {
                    let _ = conn.execute("UPDATE libraries SET status='idle' WHERE status='scanning'", []);
                }
            }

            // File-watching: debouncer thread + watcher registry, then start
            // watchers for libraries that already have watch enabled.
            app.manage(Watchers(Mutex::new(HashMap::new())));
            let tx = watch::spawn_debouncer(app.handle().clone());
            app.manage(WatchTx(tx));
            watch::start_all(app.handle());

            // Register the Quick Find global shortcut (saved or default).
            #[cfg(desktop)]
            {
                let acc = quickfind::current_shortcut(app.handle());
                if let Err(e) = quickfind::register(app.handle(), &acc) {
                    eprintln!("[quickfind] failed to register '{acc}': {e}");
                }
            }

            // Dev-only: auto-mount a folder for end-to-end testing.
            if let Ok(p) = std::env::var("TROVE_DEV_MOUNT") {
                index::dev_mount(app.handle(), &p);
            }
            Ok(())
        })
        // Closing the main window HIDES it instead of quitting, so Trove keeps
        // running in the background and the Quick Find global hotkey stays live.
        // (macOS only — elsewhere there's no dock to reopen from, so close = quit.)
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            index::get_dataset,
            index::rename_creator,
            index::create_collection,
            index::rename_collection,
            index::add_to_collection,
            index::remove_from_collection,
            index::delete_collection,
            index::list_libraries,
            index::add_library,
            index::rescan_library,
            index::eject_library,
            index::set_watch,
            index::save_thumb,
            index::quick_search,
            index::get_setting,
            index::set_setting,
            quickfind::get_quickfind_shortcut,
            quickfind::set_quickfind_shortcut,
            quickfind::hide_launcher,
            quickfind::focus_main,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Trove")
        .run(|_app, _event| {
            // macOS: clicking the dock icon while the main window is hidden
            // (background mode) brings it back into view.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = &_event {
                if let Some(w) = _app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                    let _ = w.unminimize();
                }
            }
        });
}
