// File watching: watch mounted library folders and, after a quiet debounce
// window, rescan the changed library and notify the frontend ("dataset-changed").

use crate::db::Db;
use crate::index;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const DEBOUNCE: Duration = Duration::from_millis(1200);

/// Active watchers keyed by library id.
pub struct Watchers(pub Mutex<HashMap<String, RecommendedWatcher>>);

/// Channel that file-change events push library ids into.
pub struct WatchTx(pub Sender<String>);

/// Spawn the debouncer thread; returns the sender watchers push lib ids into.
pub fn spawn_debouncer(app: AppHandle) -> Sender<String> {
    let (tx, rx) = channel::<String>();
    std::thread::spawn(move || {
        loop {
            // block until first event
            let first = match rx.recv() {
                Ok(id) => id,
                Err(_) => break, // sender dropped → app shutting down
            };
            let mut dirty: HashSet<String> = HashSet::new();
            dirty.insert(first);
            // drain further events during the quiet window
            loop {
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(id) => { dirty.insert(id); }
                    Err(_) => break, // timeout (quiet) or disconnect → flush
                }
            }
            // Rescan each dirty library via the chunked, lock-friendly scanner
            // (do_scan emits its own dataset-changed when finished).
            for id in &dirty {
                let path: Option<String> = app.try_state::<Db>().and_then(|db| {
                    db.0.lock().ok().and_then(|c| {
                        c.query_row("SELECT path FROM libraries WHERE id=?1", [id], |r| r.get::<_, String>(0)).ok()
                    })
                });
                if let Some(p) = path {
                    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                    index::do_scan(&app, id, std::path::Path::new(&p), cancel, false);
                }
            }
        }
    });
    tx
}

pub fn start(app: &AppHandle, lib_id: &str, path: &str) {
    // Never auto-watch network mounts — FSEvents over SMB/NFS fires phantom events
    // that loop the scanner endlessly. Those libraries refresh via manual Reindex.
    if index::is_network_path(std::path::Path::new(path)) {
        return;
    }
    let watchers = app.state::<Watchers>();
    let tx = app.state::<WatchTx>().0.clone();
    let id = lib_id.to_string();
    let mut watcher = match notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = tx.send(id.clone());
        }
    }) {
        Ok(w) => w,
        Err(_) => return,
    };
    if watcher.watch(std::path::Path::new(path), RecursiveMode::Recursive).is_ok() {
        watchers.0.lock().unwrap().insert(lib_id.to_string(), watcher);
    }
}

pub fn stop(app: &AppHandle, lib_id: &str) {
    if let Some(w) = app.state::<Watchers>().0.lock().unwrap().remove(lib_id) {
        drop(w);
    }
}

/// Start watchers for all libraries currently flagged watch=1 (on boot).
pub fn start_all(app: &AppHandle) {
    let rows: Vec<(String, String)> = {
        let db = app.state::<Db>();
        let conn = match db.0.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        let mut stmt = match conn.prepare("SELECT id, path FROM libraries WHERE watch=1") {
            Ok(s) => s,
            Err(_) => return,
        };
        let mapped = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map(|rows| rows.filter_map(|r| r.ok()).collect::<Vec<_>>())
            .unwrap_or_default();
        mapped
    };
    for (id, path) in rows {
        // Migrate existing network-mounted libraries off watch (they were the
        // source of the endless rescan loop) so the UI reflects reality.
        if index::is_network_path(std::path::Path::new(&path)) {
            if let Some(db) = app.try_state::<Db>() {
                if let Ok(c) = db.0.lock() {
                    let _ = c.execute("UPDATE libraries SET watch=0 WHERE id=?1", [&id]);
                }
            }
            continue;
        }
        start(app, &id, &path);
    }
}
