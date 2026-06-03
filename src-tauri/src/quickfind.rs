// Quick Find: global-shortcut summon + launcher-window control.
// The launcher is a separate transparent, always-on-top window (defined in
// tauri.conf.json) that the global hotkey toggles — so it works even when the
// main window is hidden/backgrounded.

use crate::db::Db;
use rusqlite::params;
use tauri::{AppHandle, Emitter, Manager, State};

/// Safe default: ⌘/Ctrl + Shift + Space (avoids macOS Spotlight's ⌘Space).
pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";
const SETTING_KEY: &str = "quickfind_shortcut";

/// Show the launcher if hidden (as a full-screen transparent overlay), else hide.
/// The overlay covers the active monitor so the glass panel floats over a dimmed
/// desktop (the scrim is drawn in the webview), matching the design.
pub fn toggle_launcher(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("launcher") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            cover_active_monitor(&win);
            let _ = win.show();
            let _ = win.set_focus();
            let _ = app.emit_to("launcher", "launcher-show", ());
        }
    }
}

/// Resize+reposition the launcher window to fill the monitor it's currently on
/// (falls back to the primary monitor). Monitors report physical pixels; matching
/// them keeps the overlay 1:1 with the screen.
fn cover_active_monitor(win: &tauri::WebviewWindow) {
    let mon = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten());
    if let Some(mon) = mon {
        let pos = *mon.position();
        let size = *mon.size();
        let _ = win.set_position(tauri::PhysicalPosition::new(pos.x, pos.y));
        let _ = win.set_size(tauri::PhysicalSize::new(size.width, size.height));
    }
}

/// The configured accelerator, or the default if none stored.
pub fn current_shortcut(app: &AppHandle) -> String {
    let db = app.state::<Db>();
    if let Ok(conn) = db.0.lock() {
        if let Ok(v) = conn.query_row(
            "SELECT value FROM settings WHERE key=?1",
            params![SETTING_KEY],
            |r| r.get::<_, String>(0),
        ) {
            if !v.trim().is_empty() {
                return v;
            }
        }
    }
    DEFAULT_SHORTCUT.to_string()
}

/// Register `accelerator` as the (sole) global shortcut.
#[cfg(desktop)]
pub fn register(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let sc = Shortcut::from_str(accelerator).map_err(|e| format!("invalid shortcut: {e:?}"))?;
    gs.register(sc).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(desktop))]
pub fn register(_app: &AppHandle, _accelerator: &str) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn get_quickfind_shortcut(app: AppHandle) -> String {
    current_shortcut(&app)
}

#[tauri::command]
pub fn set_quickfind_shortcut(app: AppHandle, db: State<Db>, accelerator: String) -> Result<(), String> {
    // Validate + register first so a bad accelerator never gets persisted.
    register(&app, &accelerator)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2",
        params![SETTING_KEY, accelerator],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn hide_launcher(app: AppHandle) {
    if let Some(win) = app.get_webview_window("launcher") {
        let _ = win.hide();
    }
}

#[tauri::command]
pub fn focus_main(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.unminimize();
    }
}
