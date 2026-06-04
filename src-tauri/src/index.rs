// Filesystem indexer: walk a mounted folder, group printable files into model
// folders, persist to SQLite, and assemble the Dataset the frontend consumes.

use crate::db::Db;
use crate::model::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::cell::Cell;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use tauri::{Emitter, Manager, State};
use walkdir::WalkDir;

/// Per-library cancellation flags so a scan can be stopped (e.g. on eject) and
/// so a new scan supersedes an in-flight one for the same library.
#[derive(Default)]
pub struct ScanFlags(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

impl ScanFlags {
    /// Cancel any running scan for `id` and hand back a fresh flag for a new one.
    fn fresh(&self, id: &str) -> Arc<AtomicBool> {
        let mut map = self.0.lock().unwrap();
        if let Some(old) = map.get(id) {
            old.store(true, Ordering::SeqCst);
        }
        let flag = Arc::new(AtomicBool::new(false));
        map.insert(id.to_string(), flag.clone());
        flag
    }
    fn cancel(&self, id: &str) {
        if let Some(f) = self.0.lock().unwrap().get(id) {
            f.store(true, Ordering::SeqCst);
        }
    }
}

#[derive(Clone, Serialize)]
struct ScanProgress {
    #[serde(rename = "libId")]
    lib_id: String,
    models: u32,
    files: u32,
    done: bool,
    cancelled: bool,
    /// "scanning" (walking + indexing) | "previews" (building image cache) | "done".
    phase: String,
    /// New/changed models written this scan (lets the UI stay silent on no-op rescans).
    changed: u32,
}

fn emit_progress(app: &tauri::AppHandle, lib_id: &str, models: u32, files: u32, done: bool, cancelled: bool, phase: &str, changed: u32) {
    let _ = app.emit(
        "scan-progress",
        ScanProgress { lib_id: lib_id.to_string(), models, files, done, cancelled, phase: phase.to_string(), changed },
    );
}

const PRINTABLE: [&str; 5] = ["stl", "3mf", "obj", "step", "stp"];
const IMAGE: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];

fn is_image(ext: &str) -> bool {
    IMAGE.contains(&ext)
}

const PREVIEW_NAMES: [&str; 6] = ["render", "preview", "cover", "main", "thumb", "hero"];
const IMG_DIR_HINTS: [&str; 4] = ["render", "image", "photo", "pic"];

fn name_score(stem: &str) -> Option<usize> {
    let n = stem.to_lowercase();
    PREVIEW_NAMES.iter().position(|k| n.contains(k))
}

/// Choose a model's preview image from its gathered files (the model groups its
/// whole subtree, so `files` already contains every image under it). Prefers a
/// descriptive filename (render/preview/cover/…), then an image sitting in a
/// render/photo-named folder, then the largest image (usually the hero render).
fn pick_preview(files: &[ScannedFile]) -> Option<String> {
    let in_img_dir = |path: &str| {
        Path::new(path)
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .map(|n| { let n = n.to_lowercase(); IMG_DIR_HINTS.iter().any(|k| n.contains(k)) })
            .unwrap_or(false)
    };
    files
        .iter()
        .filter(|f| is_image(&f.ext))
        // sort key: best name rank, then in-image-folder, then largest.
        .min_by(|a, b| {
            let ra = name_score(&stem_of(&a.name)).unwrap_or(usize::MAX);
            let rb = name_score(&stem_of(&b.name)).unwrap_or(usize::MAX);
            ra.cmp(&rb)
                .then(in_img_dir(&b.path).cmp(&in_img_dir(&a.path)))
                .then(b.size.cmp(&a.size))
        })
        .map(|f| f.path.clone())
}
const GEOMS: [&str; 9] = ["vase", "gear", "d20", "cube", "torusknot", "bracket", "figurine", "flexi", "box"];
const PALETTE: [&str; 9] = [
    "#d98a4a", "#cf9248", "#e0703a", "#c2693d", "#5b8a72",
    "#4f86b3", "#9a6cc4", "#b5604f", "#6f8c5a",
];

// ── small helpers ────────────────────────────────────────────────────────────
fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn geometry_for(s: &str) -> String {
    GEOMS[(fnv1a(s) % GEOMS.len() as u64) as usize].to_string()
}
fn color_for(s: &str) -> String {
    PALETTE[(fnv1a(s) % PALETTE.len() as u64) as usize].to_string()
}

fn slug(s: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in s.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('_');
            prev_dash = true;
        }
    }
    out.trim_matches('_').to_string()
}

fn prettify(s: &str) -> String {
    let cleaned = s.replace(['_', '-'], " ");
    let mut out = String::new();
    for (i, word) in cleaned.split_whitespace().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        let mut chars = word.chars();
        if let Some(first) = chars.next() {
            out.extend(first.to_uppercase());
            out.push_str(chars.as_str());
        }
    }
    if out.is_empty() {
        s.to_string()
    } else {
        out
    }
}

fn ext_of(name: &str) -> String {
    let e = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if e == "stp" {
        "step".to_string()
    } else {
        e
    }
}

fn stem_of(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name)
        .to_string()
}

fn is_printable(ext: &str) -> bool {
    PRINTABLE.contains(&ext) || ext == "step"
}

/// Files that define a model on their own: printable meshes plus Blender sources.
/// A folder containing one of these (even a `.blend`-only folder) is a model.
fn is_model_file(ext: &str) -> bool {
    is_printable(ext) || ext == "blend"
}

/// Heuristic auto-tagging from folder/file names. Returns (tags, supports).
fn auto_tags(haystack: &str, file_exts: &[String], multi: bool) -> (Vec<String>, bool) {
    let h = haystack.to_lowercase();
    let mut tags: Vec<String> = Vec::new();
    let add = |t: &str, tags: &mut Vec<String>| {
        let s = t.to_string();
        if !tags.contains(&s) {
            tags.push(s);
        }
    };

    // materials
    for (kw, tag) in [
        ("petg", "PETG"), ("pla", "PLA"), ("abs", "ABS"), ("tpu", "TPU"),
        ("asa", "ASA"), ("nylon", "nylon"), ("resin", "resin"),
    ] {
        if h.contains(kw) {
            add(tag, &mut tags);
        }
    }

    // support handling
    let support_free = h.contains("support-free") || h.contains("supportfree")
        || h.contains("support free") || h.contains("no-support") || h.contains("no support");
    let mut supports = false;
    if support_free {
        add("support-free", &mut tags);
    } else if h.contains("support") {
        supports = true;
        add("supports", &mut tags);
    }

    // shape / category keywords
    for (kw, tag) in [
        ("print-in-place", "print-in-place"), ("printinplace", "print-in-place"),
        ("print in place", "print-in-place"), ("low poly", "low-poly"),
        ("flexi", "articulated"), ("articulated", "articulated"), ("fidget", "fidget"),
        ("vase", "vase-mode"), ("planter", "home"), ("pot", "home"), ("hook", "home"),
        ("miniature", "miniature"), ("mini", "miniature"), ("dice", "dice"),
        ("bracket", "functional"), ("mount", "functional"), ("gear", "functional"),
        ("jig", "functional"), ("clip", "functional"), ("low-poly", "low-poly"),
        ("lowpoly", "low-poly"), ("toy", "toy"), ("decor", "decorative"),
        ("terrain", "tabletop"), ("tabletop", "tabletop"),
    ] {
        if h.contains(kw) {
            add(tag, &mut tags);
        }
    }

    // file-type tags
    let mut exts = file_exts.to_vec();
    exts.sort();
    exts.dedup();
    for e in exts {
        add(&e, &mut tags);
    }
    if multi {
        add("multi-part", &mut tags);
    }
    (tags, supports)
}

/// epoch seconds → "YYYY-MM-DD" (Howard Hinnant's civil-from-days).
fn iso_date(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// A path's modification time in epoch seconds (0 if unavailable).
/// True if `path` is on a network filesystem (SMB/NFS/AFP/WebDAV). FSEvents over
/// such mounts fires phantom/repeating change events, so we never auto-watch them
/// (it caused an endless rescan loop). macOS uses statfs; other platforms assume local.
#[cfg(target_os = "macos")]
pub fn is_network_path(path: &Path) -> bool {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let c = match CString::new(path.as_os_str().as_bytes()) {
        Ok(c) => c,
        Err(_) => return false,
    };
    unsafe {
        let mut sfs: libc::statfs = std::mem::zeroed();
        if libc::statfs(c.as_ptr(), &mut sfs) != 0 {
            return false;
        }
        let ty: String = sfs
            .f_fstypename
            .iter()
            .take_while(|&&ch| ch != 0)
            .map(|&ch| ch as u8 as char)
            .collect::<String>()
            .to_lowercase();
        ["smb", "nfs", "afp", "webdav", "cifs", "ftp"].iter().any(|k| ty.contains(k))
    }
}

#[cfg(not(target_os = "macos"))]
pub fn is_network_path(_path: &Path) -> bool {
    false
}

fn mtime_secs(p: &Path) -> i64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ── scanning ─────────────────────────────────────────────────────────────────
#[derive(Debug)]
struct ScannedFile {
    name: String,
    ext: String,
    size: u64,
    path: String,
}

/// Walk `root`, returning (model_dir_path → files-directly-in-it) for every
/// directory that directly contains at least one printable file. Retained for
/// `persist_scan`/tests; the live scanner uses the streaming `scan_stream`.
#[allow(dead_code)]
fn collect_model_dirs(
    root: &Path,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(u32),
) -> BTreeMap<PathBuf, Vec<ScannedFile>> {
    let mut dirs: BTreeMap<PathBuf, Vec<ScannedFile>> = BTreeMap::new();
    let mut seen: u32 = 0;
    for entry in WalkDir::new(root).follow_links(false).into_iter().filter_map(|e| e.ok()) {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if name.starts_with('.') {
            continue;
        }
        let ext = ext_of(&name);
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let parent = match path.parent() {
            Some(p) => p.to_path_buf(),
            None => continue,
        };
        dirs.entry(parent).or_default().push(ScannedFile {
            name,
            ext,
            size,
            path: path.to_string_lossy().to_string(),
        });
        seen += 1;
        if seen % 1000 == 0 {
            on_progress(seen);
        }
    }
    // keep only dirs that hold a printable file
    dirs.retain(|_, files| files.iter().any(|f| is_printable(&f.ext)));
    dirs
}

/// A fully-computed model ready to insert — built from the filesystem walk with
/// NO database lock held, so the (potentially slow, network-bound) computation
/// never blocks other DB access.
struct ModelRecord {
    id: String,
    name: String,
    creator_slug: String,
    creator_name: String,
    collection_slug: String,
    collection_name: String,
    geometry: String,
    color: String,
    supports: bool,
    added: String,
    folder: String,
    file_count: u32,
    total_size: u64,
    dir_mtime: i64,
    preview: Option<String>,
    tags: Vec<String>,
    files: Vec<ScannedFile>,
}

/// Compute a model record for one directory (pure CPU/FS read; no DB).
/// `mtime` is the directory's modification time (epoch secs) — used both for the
/// "added" date and as the incremental-rescan change fingerprint.
fn compute_record(root: &Path, dir: &Path, mtime: i64, files: Vec<ScannedFile>) -> ModelRecord {
    let rel = dir.strip_prefix(root).unwrap_or(dir);
    let segs: Vec<String> = rel
        .components()
        .filter_map(|c| c.as_os_str().to_str().map(|s| s.to_string()))
        .collect();

    let (creator_name, collection_name, model_name) = match segs.len() {
        0 => ("Uncategorized".to_string(), String::new(), prettify(&file_name(root))),
        1 => ("Uncategorized".to_string(), String::new(), prettify(&segs[0])),
        2 => (prettify(&segs[0]), String::new(), prettify(&segs[1])),
        _ => (prettify(&segs[0]), prettify(&segs[1]), prettify(&segs[segs.len() - 1])),
    };

    let folder = dir.to_string_lossy().to_string();
    let model_id = format!("m{:x}", fnv1a(&folder));
    let added = iso_date(mtime);
    let printable: Vec<&ScannedFile> = files.iter().filter(|f| is_printable(&f.ext)).collect();
    let total_size: u64 = files.iter().map(|f| f.size).sum();
    let fcount = files.len() as u32;

    let hay = format!(
        "{} {} {}",
        model_name,
        rel.to_string_lossy(),
        files.iter().map(|f| f.name.as_str()).collect::<Vec<_>>().join(" ")
    );
    let printable_exts: Vec<String> = printable.iter().map(|f| f.ext.clone()).collect();
    let (tags, supports) = auto_tags(&hay, &printable_exts, printable.len() > 1);
    let preview = pick_preview(&files);

    ModelRecord {
        id: model_id,
        name: model_name,
        creator_slug: slug(&creator_name),
        creator_name,
        collection_slug: slug(&collection_name),
        collection_name,
        geometry: geometry_for(&folder),
        color: color_for(&folder),
        supports,
        added,
        folder,
        file_count: fcount,
        total_size,
        dir_mtime: mtime,
        preview,
        tags,
        files,
    }
}

/// Insert one computed record (call inside a transaction).
fn insert_record(conn: &Connection, lib_id: &str, rec: &ModelRecord) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO models (id, library_id, name, creator, collection, geometry, color,
            license, source, source_url, supports, added, descr, folder, file_count, total_size, dir_mtime, preview)
         VALUES (?1,?2,?3,?4,?5,?6,?7,'Unknown','Local','',?8,?9,'',?10,?11,?12,?13,?14)",
        params![
            rec.id, lib_id, rec.name, rec.creator_slug, rec.collection_slug,
            rec.geometry, rec.color, rec.supports as i32, rec.added, rec.folder,
            rec.file_count, rec.total_size as i64, rec.dir_mtime, rec.preview
        ],
    )?;
    remember_name(conn, "creator", &rec.creator_slug, &rec.creator_name)?;
    if !rec.collection_name.is_empty() {
        remember_name(conn, "collection", &rec.collection_slug, &rec.collection_name)?;
    }
    for f in &rec.files {
        let part = is_printable(&f.ext);
        conn.execute(
            "INSERT INTO files (model_id, name, type, size, path, is_part, geometry, color)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![rec.id, f.name, f.ext, f.size as i64, f.path, part as i32, geometry_for(&f.path), color_for(&f.path)],
        )?;
    }
    for t in &rec.tags {
        let _ = conn.execute("INSERT OR IGNORE INTO tags (model_id, tag) VALUES (?1,?2)", params![rec.id, t]);
    }
    Ok(())
}

/// Synchronous full scan into the given connection (one transaction). Used by
/// tests; the live app uses `do_scan` (background, chunked).
#[allow(dead_code)]
fn persist_scan(conn: &mut Connection, lib_id: &str, root: &Path) -> rusqlite::Result<(u32, u32)> {
    conn.execute("DELETE FROM models WHERE library_id = ?1", params![lib_id])?;
    let never = AtomicBool::new(false);
    let dirs = collect_model_dirs(root, &never, &mut |_| {});
    let mut models = 0u32;
    let mut files = 0u32;
    let tx = conn.transaction()?;
    for (dir, fs) in dirs {
        let rec = compute_record(root, &dir, mtime_secs(&dir), fs);
        files += rec.file_count;
        insert_record(&tx, lib_id, &rec)?;
        models += 1;
    }
    tx.commit()?;
    Ok((models, files))
}

const SCAN_CHUNK: usize = 200;
const SCAN_BATCH: usize = 40;

/// Recursively walk `root`, invoking `on_model` for every directory that directly
/// contains a printable file — STREAMING, so models are emitted as they're found
/// (no full-tree buffering). This lets the caller persist results progressively,
/// so the library fills in during a slow/network walk instead of staying empty
/// until the very end. Returns the total number of read errors encountered.
/// Superseded by `scan_parallel` in the live path; kept for the benchmark/test.
#[allow(dead_code)]
fn scan_stream(
    root: &Path,
    cancel: &AtomicBool,
    on_model: &mut dyn FnMut(ModelRecord),
    on_files: &mut dyn FnMut(u32),
) -> u32 {
    let mut stack = vec![root.to_path_buf()];
    let mut seen: u32 = 0;
    let mut errors: u32 = 0;
    while let Some(dir) = stack.pop() {
        if cancel.load(Ordering::SeqCst) {
            return errors;
        }
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => { errors += 1; continue; }
        };
        let mut files: Vec<ScannedFile> = Vec::new();
        for ent in rd.filter_map(|e| e.ok()) {
            let name = ent.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let ft = match ent.file_type() {
                Ok(t) => t,
                Err(_) => { errors += 1; continue; }
            };
            let path = ent.path();
            if ft.is_dir() {
                stack.push(path);
            } else if ft.is_file() {
                let ext = ext_of(&name);
                let size = ent.metadata().map(|m| m.len()).unwrap_or(0);
                files.push(ScannedFile { name, ext, size, path: path.to_string_lossy().to_string() });
                seen += 1;
                if seen % 500 == 0 {
                    on_files(seen);
                }
            }
        }
        if files.iter().any(|f| is_printable(&f.ext)) {
            let mt = mtime_secs(&dir);
            on_model(compute_record(root, &dir, mt, files));
        }
    }
    errors
}

/// Default walker concurrency. High enough to overlap per-entry I/O latency on
/// USB/HDD/network volumes (where serial stat/readdir round-trips dominate),
/// low enough to avoid thrashing a single spindle.
const WALK_THREADS: usize = 16;

/// Bump when the scan/grouping logic changes so installed libraries rebuild once
/// on the next scan (v2 = subtree model grouping).
const SCAN_VERSION: i64 = 2;

/// A message from a walker thread to the DB writer.
/// (Retained for the `bench_walk` benchmark; the live scan uses `collect_tree`.)
#[allow(dead_code)]
enum ScanMsg {
    /// A new or changed model directory — write/replace it.
    Model(Box<ModelRecord>),
    /// An unchanged model directory (id only) — keep its existing DB row & thumbnail.
    Unchanged(String),
}

/// PARALLEL streaming walk: each directory is processed on a worker thread
/// (jwalk), so the many slow per-entry `stat`/`readdir` calls overlap instead of
/// running serially. INCREMENTAL: if a model directory's mtime matches the
/// `existing` fingerprint, it's reported `Unchanged` (skipping per-file stats and
/// any DB/thumbnail work); otherwise its files are read and a `Model` is emitted.
#[allow(dead_code)]
fn scan_parallel(
    root: &Path,
    cancel: Arc<AtomicBool>,
    threads: usize,
    existing: Arc<std::collections::HashMap<String, i64>>,
    on_msg: Arc<dyn Fn(ScanMsg) + Send + Sync>,
) {
    let root_for_closure = root.to_path_buf();
    let cancel_cl = cancel.clone();
    let walk = jwalk::WalkDir::new(root)
        .skip_hidden(true)
        .parallelism(jwalk::Parallelism::RayonNewPool(threads.max(1)))
        .process_read_dir(move |_depth, dir_path, _state, children| {
            if cancel_cl.load(Ordering::SeqCst) {
                children.clear();
                return;
            }
            let folder = dir_path.to_string_lossy().to_string();
            let model_id = format!("m{:x}", fnv1a(&folder));
            let mtime = mtime_secs(dir_path);

            // Incremental fast path: known directory, unchanged mtime → skip all
            // per-file stats and DB work, just keep the existing row/thumbnail.
            if existing.get(&model_id) == Some(&mtime) {
                on_msg(ScanMsg::Unchanged(model_id));
                return;
            }

            let mut files: Vec<ScannedFile> = Vec::new();
            for dirent in children.iter().flatten() {
                let name = dirent.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                // One metadata() gives type + size, reliable even where readdir
                // d_type is unavailable (exFAT/SMB).
                let md = match dirent.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if !md.is_file() {
                    continue;
                }
                files.push(ScannedFile {
                    name: name.clone(),
                    ext: ext_of(&name),
                    size: md.len(),
                    path: dirent.path().to_string_lossy().to_string(),
                });
            }
            if files.iter().any(|f| is_printable(&f.ext)) {
                on_msg(ScanMsg::Model(Box::new(compute_record(&root_for_closure, dir_path, mtime, files))));
            }
        });
    for _ in walk {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
    }
}

/// Upsert a batch of changed/new records in one short transaction (lock released
/// after). DELETE-by-id first so a changed model fully replaces its prior rows
/// (files/tags cascade); for a new model the delete is a harmless no-op.
fn flush_batch(db: &Mutex<Connection>, lib_id: &str, batch: &mut Vec<ModelRecord>, counters: &Cell<(u32, u32)>) {
    if batch.is_empty() {
        return;
    }
    if let Ok(mut conn) = db.lock() {
        if let Ok(tx) = conn.transaction() {
            for rec in batch.iter() {
                let _ = tx.execute("DELETE FROM models WHERE id=?1", params![rec.id]);
                if insert_record(&tx, lib_id, rec).is_ok() {
                    let (m, f) = counters.get();
                    counters.set((m + 1, f + rec.file_count));
                }
            }
            let _ = tx.commit();
        }
    }
    batch.clear();
}

/// Insert computed model dirs into the DB in small transactioned chunks, locking
/// only per chunk (never across the whole scan). Returns (models, files) written.
/// Retained as the reference implementation exercised by the lock-release test;
/// the live scanner uses the streaming `scan_stream` + `flush_batch` path.
#[allow(dead_code)]
fn write_chunked(
    db: &Mutex<Connection>,
    lib_id: &str,
    root: &Path,
    entries: &[(PathBuf, Vec<ScannedFile>)],
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(u32, u32),
) -> (u32, u32) {
    let mut models = 0u32;
    let mut files = 0u32;
    for chunk in entries.chunks(SCAN_CHUNK) {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let recs: Vec<ModelRecord> =
            chunk.iter().map(|(dir, fs)| compute_record(root, dir, mtime_secs(dir), fs.clone())).collect();
        if let Ok(mut conn) = db.lock() {
            if let Ok(tx) = conn.transaction() {
                for rec in &recs {
                    if insert_record(&tx, lib_id, rec).is_ok() {
                        models += 1;
                        files += rec.file_count;
                    }
                }
                let _ = tx.commit();
            }
        } // lock released here, between chunks
        on_progress(models, files);
    }
    (models, files)
}

/// One model after grouping: its root directory, every file in its subtree (parts
/// + extras + images), and a change fingerprint (max mtime across the subtree).
struct GroupedModel {
    dir: PathBuf,
    files: Vec<ScannedFile>,
    fingerprint: i64,
}

/// PARALLEL tree collector: walk `root`, emitting (dir, loose-files, dir-mtime) for
/// every directory that holds at least one file. Used by the two-phase grouping
/// scan (collect the whole tree → group into models), so a model whose printables
/// live in nested subfolders is recognized as ONE model rather than fragmenting.
fn collect_tree(
    root: &Path,
    cancel: Arc<AtomicBool>,
    threads: usize,
    on_dir: Arc<dyn Fn(PathBuf, Vec<ScannedFile>, i64) + Send + Sync>,
) {
    let cancel_cl = cancel.clone();
    let walk = jwalk::WalkDir::new(root)
        .skip_hidden(true)
        .parallelism(jwalk::Parallelism::RayonNewPool(threads.max(1)))
        .process_read_dir(move |_depth, dir_path, _state, children| {
            if cancel_cl.load(Ordering::SeqCst) {
                children.clear();
                return;
            }
            let mut files: Vec<ScannedFile> = Vec::new();
            for dirent in children.iter().flatten() {
                let name = dirent.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let md = match dirent.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if !md.is_file() {
                    continue;
                }
                files.push(ScannedFile {
                    name: name.clone(),
                    ext: ext_of(&name),
                    size: md.len(),
                    path: dirent.path().to_string_lossy().to_string(),
                });
            }
            if !files.is_empty() {
                on_dir(dir_path.to_path_buf(), files, mtime_secs(dir_path));
            }
        });
    for _ in walk {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
    }
}

/// Group collected directories into models. A directory is a **model root** when it
/// directly holds loose media (a printable OR an image); a directory of only
/// subfolders is a container (creator/tier/category) whose children are models in
/// their own right. Every directory's files are attributed to its nearest
/// ancestor-or-self model root, so a model absorbs its whole subtree (nested STL
/// folders → parts, any image → preview). Models with no printable are dropped.
fn group_models(root: &Path, dirs: &BTreeMap<PathBuf, (Vec<ScannedFile>, i64)>) -> Vec<GroupedModel> {
    // A "candidate" directly holds loose media: a model file (printable or .blend)
    // or an image.
    let candidates: HashSet<PathBuf> = dirs
        .iter()
        .filter(|(_, (files, _))| files.iter().any(|f| is_model_file(&f.ext) || is_image(&f.ext)))
        .map(|(p, _)| p.clone())
        .collect();
    // A model root is the SHALLOWEST candidate in its chain — a candidate with no
    // candidate ancestor. So a model with loose images + nested STL subfolders is
    // one model (the top), while a container (no loose media) lets each child be a
    // model in its own right.
    let roots: HashSet<PathBuf> = candidates
        .iter()
        .filter(|p| {
            let mut cur = p.parent();
            while let Some(c) = cur {
                if candidates.contains(c) {
                    return false; // a shallower candidate absorbs this one
                }
                if c == root {
                    break;
                }
                cur = c.parent();
            }
            true
        })
        .cloned()
        .collect();

    // Nearest ancestor-or-self model root for a directory (bounded by the library root).
    let nearest_root = |d: &Path| -> Option<PathBuf> {
        let mut cur: Option<&Path> = Some(d);
        while let Some(c) = cur {
            if roots.contains(c) {
                return Some(c.to_path_buf());
            }
            if c == root {
                break;
            }
            cur = c.parent();
        }
        None
    };

    let mut acc: BTreeMap<PathBuf, (Vec<ScannedFile>, i64)> = BTreeMap::new();
    for (dirp, (files, mt)) in dirs {
        if let Some(mr) = nearest_root(dirp) {
            let e = acc.entry(mr).or_insert_with(|| (Vec::new(), 0));
            e.0.extend(files.iter().map(|f| f.clone()));
            if *mt > e.1 {
                e.1 = *mt;
            }
        }
    }

    acc.into_iter()
        .filter(|(_, (files, _))| files.iter().any(|f| is_model_file(&f.ext)))
        .map(|(dir, (files, fingerprint))| GroupedModel { dir, files, fingerprint })
        .collect()
}

/// Background-safe INCREMENTAL scan. Two-phase: walk the whole tree with NO DB lock
/// held (parallel worker threads), then group directories into models (a model
/// absorbs nested part/asset subfolders). Models whose subtree fingerprint matches
/// the stored value are kept as-is (no DB write, no thumbnail re-render); only
/// new/changed models are upserted, and models whose folders disappeared are
/// removed. Cancellable; surfaces read errors (permission) as an 'error' status.
pub fn do_scan(app: &tauri::AppHandle, lib_id: &str, root: &Path, cancel: Arc<AtomicBool>, force: bool) {
    let db = app.state::<Db>();

    // Up-front readability probe → clean 'error' status on permission failure
    // (vs. a folder that's simply readable but has no printable files = idle).
    let root_ok = std::fs::read_dir(root).is_ok();

    if let Ok(conn) = db.0.lock() {
        let _ = conn.execute("UPDATE libraries SET status='scanning' WHERE id=?1", params![lib_id]);
    }
    emit_progress(app, lib_id, 0, 0, false, false, "scanning", 0);

    if !root_ok {
        if let Ok(conn) = db.0.lock() {
            let _ = conn.execute("UPDATE libraries SET status='error', last='just now' WHERE id=?1", params![lib_id]);
        }
        eprintln!("[scan] {lib_id}: cannot read {} (permission?)", root.display());
        emit_progress(app, lib_id, 0, 0, true, false, "done", 0);
        let _ = app.emit("dataset-changed", ());
        return;
    }

    // Force a one-time full rebuild when the scan/grouping logic changes (the
    // incremental mtime fingerprint can't detect that grouping itself changed, so
    // an upgraded install would otherwise keep stale rows). Per-library marker.
    let ver_key = format!("scan_version:{lib_id}");
    let stored_ver: i64 = db.0.lock().ok()
        .and_then(|c| c.query_row("SELECT value FROM settings WHERE key=?1", params![ver_key], |r| r.get::<_, String>(0)).ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let force = force || stored_ver != SCAN_VERSION;

    // Load existing fingerprints (model id → dir mtime) for incremental diffing.
    // A forced rescan starts from an empty map so every directory is reprocessed.
    let mut existing_map: HashMap<String, i64> = HashMap::new();
    if !force {
        if let Ok(conn) = db.0.lock() {
            if let Ok(mut st) = conn.prepare("SELECT id, dir_mtime FROM models WHERE library_id=?1") {
                if let Ok(rows) = st.query_map(params![lib_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))) {
                    for row in rows.flatten() { existing_map.insert(row.0, row.1); }
                }
            }
        }
    }
    let existing = Arc::new(existing_map);

    // ── Phase 1: collect the whole tree (parallel walk, no DB lock) ──
    let (tx, rx) = crossbeam_channel::unbounded::<(PathBuf, Vec<ScannedFile>, i64)>();
    let root_buf = root.to_path_buf();
    let cancel_walk = cancel.clone();
    let on_dir: Arc<dyn Fn(PathBuf, Vec<ScannedFile>, i64) + Send + Sync> =
        Arc::new(move |p, f, m| { let _ = tx.send((p, f, m)); });
    let walker = std::thread::spawn(move || {
        collect_tree(&root_buf, cancel_walk, WALK_THREADS, on_dir);
    });

    let mut dirs: BTreeMap<PathBuf, (Vec<ScannedFile>, i64)> = BTreeMap::new();
    let mut file_total = 0u32;
    while let Ok((p, files, mt)) = rx.recv() {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        file_total += files.len() as u32;
        dirs.insert(p, (files, mt));
        if dirs.len() % 64 == 0 {
            emit_progress(app, lib_id, 0, file_total, false, false, "scanning", 0);
        }
    }
    let _ = walker.join();

    if cancel.load(Ordering::SeqCst) {
        emit_progress(app, lib_id, 0, file_total, true, true, "done", 0);
        let _ = app.emit("dataset-changed", ());
        return;
    }

    // ── Phase 2: group directories into models (a model absorbs its subtree) ──
    let models = group_models(root, &dirs);

    // ── Phase 3: incremental upsert (skip models whose subtree is unchanged) ──
    let mut seen: HashSet<String> = HashSet::new();
    let counters = Cell::new((0u32, 0u32)); // (changed written, changed files)
    let mut batch: Vec<ModelRecord> = Vec::new();
    let mut changed = 0u32;
    let mut last_reload = 0u32;
    for gm in models {
        let id = format!("m{:x}", fnv1a(&gm.dir.to_string_lossy()));
        seen.insert(id.clone());
        if !force && existing.get(&id) == Some(&gm.fingerprint) {
            continue; // unchanged → keep existing row + thumbnail
        }
        changed += 1;
        batch.push(compute_record(root, &gm.dir, gm.fingerprint, gm.files));
        if batch.len() >= SCAN_BATCH {
            flush_batch(&db.0, lib_id, &mut batch, &counters);
            if changed - last_reload >= 80 {
                last_reload = changed;
                emit_progress(app, lib_id, seen.len() as u32, changed, false, false, "scanning", 0);
                let _ = app.emit("dataset-changed", ());
            }
        }
    }
    flush_batch(&db.0, lib_id, &mut batch, &counters);

    // Reconcile deletions: any DB model for this library not seen on disk is gone.
    let mut removed = 0u32;
    if let Ok(conn) = db.0.lock() {
        let stale: Vec<String> = conn
            .prepare("SELECT id FROM models WHERE library_id=?1")
            .and_then(|mut st| {
                st.query_map(params![lib_id], |r| r.get::<_, String>(0))
                    .map(|rows| rows.flatten().filter(|id| !seen.contains(id)).collect())
            })
            .unwrap_or_default();
        for id in &stale {
            let _ = conn.execute("DELETE FROM models WHERE id=?1", params![id]);
            removed += 1;
        }
    }

    // Rebuild the Quick Find FTS index from the freshly-updated base tables.
    if let Ok(conn) = db.0.lock() {
        let _ = rebuild_fts(&conn);
    }

    let total = seen.len() as u32;
    let watch_on = db.0.lock().ok()
        .and_then(|c| c.query_row("SELECT watch FROM libraries WHERE id=?1", params![lib_id], |r| r.get::<_, i64>(0)).ok())
        .unwrap_or(0) != 0;
    if let Ok(conn) = db.0.lock() {
        let _ = conn.execute(
            "UPDATE libraries SET status=?2, last='just now' WHERE id=?1",
            params![lib_id, if watch_on { "watching" } else { "idle" }],
        );
        // Mark this library as scanned with the current grouping version (so the
        // one-time forced rebuild only happens once after an upgrade).
        let _ = conn.execute(
            "INSERT INTO settings (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2",
            params![ver_key, SCAN_VERSION.to_string()],
        );
    }
    eprintln!("[scan] {lib_id}: {total} models ({changed} new/changed, {removed} removed)");
    let _ = app.emit("dataset-changed", ());

    // Build the LOCAL downscaled-image cache last — the library is already
    // browsable, and folder-image thumbnails now fill in without the grid ever
    // streaming full-resolution originals off a (slow) network share. The progress
    // indicator stays up (phase "previews") until this finishes.
    let thumbs_on = db.0.lock().ok()
        .and_then(|c| c.query_row("SELECT thumbs FROM libraries WHERE id=?1", params![lib_id], |r| r.get::<_, i64>(0)).ok())
        .unwrap_or(1) != 0;
    if thumbs_on {
        emit_progress(app, lib_id, total, 0, false, false, "previews", 0);
        generate_image_thumbs(app, lib_id, &cancel);
    }
    // Final tick → clears the indicator + fires the completion toast.
    emit_progress(app, lib_id, total, counters.get().1, true, false, "done", changed);
}

/// Downscale each model's folder image (its `preview`) into the local thumbnail
/// cache so browsing never streams full-resolution images off a network share.
/// Only touches new/changed models (those with a `preview` but no cached `thumb`);
/// reads each source once, resizes to ≤512px, writes JPEG, points `thumb` at it.
/// Runs in the scan's background thread — gentle, cancellable, and incremental.
fn generate_image_thumbs(app: &tauri::AppHandle, lib_id: &str, cancel: &Arc<AtomicBool>) {
    use tauri::Manager;
    let db = app.state::<Db>();
    let dir = match app.path().app_cache_dir() {
        Ok(d) => d.join("thumbs"),
        Err(_) => return,
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let todo: Vec<(String, String)> = match db.0.lock() {
        Ok(conn) => conn
            .prepare(
                "SELECT id, preview FROM models
                 WHERE library_id=?1 AND preview IS NOT NULL AND (thumb IS NULL OR thumb='')",
            )
            .and_then(|mut st| {
                st.query_map(params![lib_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                    .map(|rows| rows.flatten().collect())
            })
            .unwrap_or_default(),
        Err(_) => return,
    };

    let mut done = 0u32;
    for (id, src) in todo {
        if cancel.load(Ordering::SeqCst) {
            return;
        }
        let out = dir.join(format!("{id}.jpg"));
        if downscale_image(Path::new(&src), &out, 512).is_ok() {
            if let Ok(conn) = db.0.lock() {
                let _ = conn.execute(
                    "UPDATE models SET thumb=?2 WHERE id=?1",
                    params![id, out.to_string_lossy().to_string()],
                );
            }
            done += 1;
            // Let the grid swap placeholders for real previews as they land, and
            // keep the indexing indicator's "Building previews… N" count moving.
            if done % 24 == 0 {
                let _ = app.emit("dataset-changed", ());
                emit_progress(app, lib_id, 0, done, false, false, "previews", 0);
            }
        }
    }
    if done > 0 {
        let _ = app.emit("dataset-changed", ());
    }

    // Embedded-thumbnail pass: models still without a cached preview → pull an
    // embedded thumbnail from a .3mf (reliable) or .blend (best-effort) so 3mf/
    // blend-only models get a real preview without rendering any mesh.
    let rows: Vec<(String, String, String)> = match db.0.lock() {
        Ok(conn) => conn
            .prepare(
                "SELECT m.id, f.path, f.type FROM models m
                 JOIN files f ON f.model_id = m.id
                 WHERE m.library_id=?1 AND (m.thumb IS NULL OR m.thumb='')
                   AND f.type IN ('3mf','blend')",
            )
            .and_then(|mut st| {
                st.query_map(params![lib_id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
                })
                .map(|rs| rs.flatten().collect())
            })
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    // One candidate per model, preferring a .3mf over a .blend.
    let mut by_model: BTreeMap<String, (Option<String>, Option<String>)> = BTreeMap::new();
    for (id, path, ty) in rows {
        let e = by_model.entry(id).or_insert((None, None));
        if ty == "3mf" {
            if e.0.is_none() { e.0 = Some(path); }
        } else if e.1.is_none() {
            e.1 = Some(path);
        }
    }
    let mut emb = 0u32;
    for (id, (mf3, blend)) in by_model {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let png = mf3.as_deref().and_then(|p| extract_3mf_thumbnail(Path::new(p)))
            .or_else(|| blend.as_deref().and_then(|p| extract_blend_thumbnail(Path::new(p))));
        if let Some(bytes) = png {
            let out = dir.join(format!("{id}.jpg"));
            if downscale_bytes(&bytes, &out, 512).is_ok() {
                if let Ok(conn) = db.0.lock() {
                    let _ = conn.execute("UPDATE models SET thumb=?2 WHERE id=?1", params![id, out.to_string_lossy().to_string()]);
                }
                emb += 1;
                if emb % 24 == 0 {
                    let _ = app.emit("dataset-changed", ());
                    emit_progress(app, lib_id, 0, done + emb, false, false, "previews", 0);
                }
            }
        }
    }
    if emb > 0 {
        let _ = app.emit("dataset-changed", ());
    }
    eprintln!("[scan] {lib_id}: cached {done} folder-image + {emb} embedded thumbnails");
}

/// Decode an image, shrink so the longest side ≤ `max`, and write a JPEG.
fn downscale_image(src: &Path, out: &Path, max: u32) -> Result<(), String> {
    let img = image::open(src).map_err(|e| e.to_string())?;
    write_scaled(img, out, max)
}

/// Same as `downscale_image` but from in-memory image bytes (embedded thumbnails).
fn downscale_bytes(bytes: &[u8], out: &Path, max: u32) -> Result<(), String> {
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    write_scaled(img, out, max)
}

fn write_scaled(img: image::DynamicImage, out: &Path, max: u32) -> Result<(), String> {
    let scaled = if img.width().max(img.height()) > max {
        img.thumbnail(max, max) // fast box-filter shrink — fine for previews
    } else {
        img
    };
    scaled.to_rgb8().save(out).map_err(|e| e.to_string()) // .jpg ext → JPEG
}

/// Pull the embedded preview PNG out of a `.3mf` (a zip). Slicer projects store a
/// plate render under `Metadata/`; prefer a descriptive name, else the largest PNG.
fn extract_3mf_thumbnail(path: &Path) -> Option<Vec<u8>> {
    use std::io::Read;
    let file = std::fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file)).ok()?;
    let names: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string()))
        .filter(|n| n.to_lowercase().ends_with(".png"))
        .collect();
    if names.is_empty() {
        return None;
    }
    let lower = |n: &str| n.to_lowercase();
    let name = names.iter().find(|n| lower(n).ends_with("metadata/thumbnail.png"))
        .or_else(|| names.iter().find(|n| lower(n).contains("thumbnail")))
        .or_else(|| names.iter().find(|n| lower(n).contains("plate") && !lower(n).contains("small")))
        .or_else(|| names.iter().find(|n| lower(n).contains("plate")))
        .or_else(|| names.iter().find(|n| lower(n).contains("metadata/")))
        .or_else(|| names.first())?
        .clone();
    let mut entry = zip.by_name(&name).ok()?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).ok()?;
    if buf.is_empty() { None } else { Some(buf) }
}

/// Best-effort: pull the embedded thumbnail from an UNCOMPRESSED `.blend`. Blender
/// stores it in a `TEST` file-block (width, height, then RGBA). Compressed blends
/// (gzip/zstd) are skipped. Returns PNG bytes.
fn extract_blend_thumbnail(path: &Path) -> Option<Vec<u8>> {
    use std::io::Read;
    // The thumbnail block sits near the start; decode a bounded prefix so a giant
    // .blend (hundreds of MB) doesn't get slurped into memory. Handles uncompressed
    // and Blender's compressed saves (zstd in 4.x, gzip in older).
    const CAP: u64 = 48 * 1024 * 1024;
    let mut magic = [0u8; 4];
    std::fs::File::open(path).ok()?.read_exact(&mut magic).ok()?;
    let file = std::fs::File::open(path).ok()?;
    let mut data = Vec::new();
    if &magic == b"BLEN" {
        file.take(CAP).read_to_end(&mut data).ok()?;
    } else if magic == [0x28, 0xB5, 0x2F, 0xFD] {
        let mut dec = zstd::stream::read::Decoder::new(file).ok()?;
        let _ = dec.take(CAP).read_to_end(&mut data); // may stop mid-stream at CAP — fine
    } else if magic[0] == 0x1F && magic[1] == 0x8B {
        let mut dec = flate2::read::GzDecoder::new(file);
        let _ = dec.take(CAP).read_to_end(&mut data);
    } else {
        return None;
    }
    if data.len() < 12 || &data[0..7] != b"BLENDER" {
        return None;
    }
    let ptr = if data[7] == b'-' { 8 } else { 4 };
    let big = data[8] == b'V';
    let u32_at = |b: &[u8]| if big {
        u32::from_be_bytes([b[0], b[1], b[2], b[3]])
    } else {
        u32::from_le_bytes([b[0], b[1], b[2], b[3]])
    };
    let header_len = 4 + 4 + ptr + 4 + 4; // code + size + old_ptr + sdna + count
    let mut pos = 12;
    while pos + header_len <= data.len() {
        let code = &data[pos..pos + 4];
        let size = u32_at(&data[pos + 4..pos + 8]) as usize;
        let body = pos + header_len;
        if code == b"ENDB" {
            break;
        }
        if code == b"TEST" && body + 8 <= data.len() {
            let w = u32_at(&data[body..body + 4]);
            let h = u32_at(&data[body + 4..body + 8]);
            let px = (w as usize).checked_mul(h as usize)?.checked_mul(4)?;
            if w > 0 && h > 0 && w <= 2048 && h <= 2048 && body + 8 + px <= data.len() {
                let raw = data[body + 8..body + 8 + px].to_vec();
                let mut img = image::RgbaImage::from_raw(w, h, raw)?;
                image::imageops::flip_vertical_in_place(&mut img); // blend stores bottom-up
                let mut out = std::io::Cursor::new(Vec::new());
                image::DynamicImage::ImageRgba8(img).write_to(&mut out, image::ImageFormat::Png).ok()?;
                return Some(out.into_inner());
            }
            return None;
        }
        pos = body + size;
    }
    None
}

/// Clone helper so chunks can own their files for compute_record.
impl Clone for ScannedFile {
    fn clone(&self) -> Self {
        ScannedFile { name: self.name.clone(), ext: self.ext.clone(), size: self.size, path: self.path.clone() }
    }
}

fn file_name(p: &Path) -> String {
    p.file_name().and_then(|n| n.to_str()).unwrap_or("library").to_string()
}

// A tiny key/value table for pretty display names of creator/collection slugs.
fn remember_name(conn: &Connection, kind: &str, id: &str, name: &str) -> rusqlite::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS names (kind TEXT, id TEXT, name TEXT, PRIMARY KEY(kind,id))",
        [],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO names (kind,id,name) VALUES (?1,?2,?3)",
        params![kind, id, name],
    )?;
    Ok(())
}

fn lookup_name(conn: &Connection, kind: &str, id: &str) -> String {
    // A user rename wins over the auto-derived name (and over a rescan rewriting it).
    if let Ok(n) = conn.query_row(
        "SELECT name FROM name_overrides WHERE kind=?1 AND id=?2",
        params![kind, id],
        |r| r.get::<_, String>(0),
    ) {
        if !n.trim().is_empty() {
            return n;
        }
    }
    conn.query_row(
        "SELECT name FROM names WHERE kind=?1 AND id=?2",
        params![kind, id],
        |r| r.get::<_, String>(0),
    )
    .unwrap_or_else(|_| prettify(id))
}

/// Persist a user's display-name edit for a creator/collection slug.
fn set_name_override(conn: &Connection, kind: &str, id: &str, name: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO name_overrides (kind,id,name) VALUES (?1,?2,?3)",
        params![kind, id, name],
    )?;
    Ok(())
}

// ── dataset assembly ─────────────────────────────────────────────────────────
fn build_dataset(conn: &Connection) -> rusqlite::Result<Dataset> {
    let mut models: Vec<Model> = Vec::new();

    let mut stmt = conn.prepare(
        "SELECT id, name, creator, collection, geometry, color, license, source, source_url,
                supports, added, descr, folder, file_count, total_size, thumb,
                dim_w, dim_d, dim_h, preview FROM models ORDER BY added DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?,
            r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, String>(5)?,
            r.get::<_, String>(6)?, r.get::<_, String>(7)?, r.get::<_, String>(8)?,
            r.get::<_, i64>(9)? != 0, r.get::<_, String>(10)?, r.get::<_, String>(11)?,
            r.get::<_, String>(12)?, r.get::<_, i64>(13)? as u32, r.get::<_, i64>(14)? as u64,
            r.get::<_, Option<String>>(15)?,
            r.get::<_, i64>(16)? as u32, r.get::<_, i64>(17)? as u32, r.get::<_, i64>(18)? as u32,
            r.get::<_, Option<String>>(19)?,
        ))
    })?;

    // Hoisted prepared statements — reused per model instead of re-preparing
    // 2× per model (a big win when building a multi-thousand-model dataset).
    let mut fstmt = conn.prepare(
        "SELECT name, type, size, path, is_part, geometry, color FROM files WHERE model_id=?1",
    )?;
    let mut tstmt = conn.prepare("SELECT tag FROM tags WHERE model_id=?1 ORDER BY tag")?;

    for row in rows {
        let (id, name, creator, collection, geometry, color, license, source, source_url,
            supports, added, desc, folder, file_count, total_size, thumb, dim_w, dim_d, dim_h, preview) = row?;

        // files → parts / extras
        let frows = fstmt.query_map(params![id], |r| {
            Ok((
                r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)? as u64,
                r.get::<_, String>(3)?, r.get::<_, i64>(4)? != 0,
                r.get::<_, String>(5)?, r.get::<_, String>(6)?,
            ))
        })?;

        let mut files: Vec<ModelFile> = Vec::new();
        let mut parts: Vec<Part> = Vec::new();
        let mut extras: Vec<ModelFile> = Vec::new();
        let mut pidx = 0;
        for fr in frows {
            let (fname, ftype, size, path, is_part, fgeo, fcol) = fr?;
            let mf = ModelFile { name: fname.clone(), ftype: ftype.clone(), size, path: Some(path) };
            files.push(mf.clone());
            if is_part {
                parts.push(Part {
                    id: format!("{}-p{}", id, pidx),
                    name: stem_of(&fname),
                    geometry: fgeo,
                    color: fcol,
                    files: vec![mf],
                });
                pidx += 1;
            } else {
                extras.push(mf);
            }
        }
        if parts.is_empty() {
            // safety: a model always has at least one part for the viewer
            parts.push(Part {
                id: format!("{}-p0", id),
                name: name.clone(),
                geometry: geometry.clone(),
                color: color.clone(),
                files: vec![],
            });
        }

        // tags
        let tags: Vec<String> = tstmt
            .query_map(params![id], |r| r.get::<_, String>(0))?
            .filter_map(|t| t.ok())
            .collect();

        models.push(Model {
            id, name, creator, collection, geometry, color, tags, files,
            license, source, source_url, supports, added, liked: false, desc, folder,
            parts, extras,
            print_time: None, filament: None, makes: None, volume: None,
            file_count, total_size,
            thumb, // raw cache path; frontend resolves to an asset URL
            preview, // raw folder-image path; frontend resolves to an asset URL
            dim_w, dim_d, dim_h,
        });
    }

    // creators
    let mut creators: Vec<Creator> = Vec::new();
    {
        let mut cmap: BTreeMap<String, u32> = BTreeMap::new();
        for m in &models {
            if !m.creator.is_empty() {
                *cmap.entry(m.creator.clone()).or_insert(0) += 1;
            }
        }
        for (cid, count) in cmap {
            let name = lookup_name(conn, "creator", &cid);
            creators.push(Creator {
                id: cid.clone(),
                name,
                handle: format!("@{}", cid),
                models: count,
                blurb: String::new(),
                tone: color_for(&cid),
            });
        }
    }

    // collections
    let mut collections: Vec<Collection> = Vec::new();
    {
        let mut comap: BTreeMap<String, (u32, String)> = BTreeMap::new();
        for m in &models {
            if !m.collection.is_empty() {
                let e = comap.entry(m.collection.clone()).or_insert((0, m.geometry.clone()));
                e.0 += 1;
            }
        }
        for (col_id, (count, cover)) in comap {
            let name = lookup_name(conn, "collection", &col_id);
            collections.push(Collection {
                id: col_id.clone(),
                name,
                blurb: String::new(),
                cover,
                tone: color_for(&col_id),
                count,
                members: None,
            });
        }
    }

    // user-defined collections (explicit membership; independent of folders)
    {
        let mut cstmt = conn.prepare("SELECT id, name FROM user_collections ORDER BY created, name")?;
        let ucs: Vec<(String, String)> = cstmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|x| x.ok())
            .collect();
        let mut mstmt = conn.prepare("SELECT model_id FROM collection_members WHERE collection_id=?1")?;
        for (cid, cname) in ucs {
            let members: Vec<String> = mstmt
                .query_map(params![cid], |r| r.get::<_, String>(0))?
                .filter_map(|x| x.ok())
                .collect();
            // Cover + count come from members that still exist in the index.
            let live: Vec<&Model> =
                members.iter().filter_map(|mid| models.iter().find(|m| &m.id == mid)).collect();
            let cover = live.first().map(|m| m.geometry.clone()).unwrap_or_else(|| "cube".to_string());
            collections.push(Collection {
                id: cid.clone(),
                name: cname,
                blurb: String::new(),
                cover,
                tone: color_for(&cid),
                count: live.len() as u32,
                members: Some(members),
            });
        }
    }

    // tags + licenses
    let mut all_tags: Vec<String> = models.iter().flat_map(|m| m.tags.clone()).collect();
    all_tags.sort();
    all_tags.dedup();
    let mut licenses: Vec<String> = models.iter().map(|m| m.license.clone()).collect();
    licenses.sort();
    licenses.dedup();

    let stats = Stats {
        models: models.len() as u32,
        files: models.iter().map(|m| m.file_count).sum(),
        creators: creators.len() as u32,
        collections: collections.len() as u32,
        filament: 0,
    };

    Ok(Dataset {
        creators,
        collections,
        models,
        all_tags,
        file_types: vec!["3mf".into(), "stl".into(), "step".into(), "obj".into(), "gcode".into()],
        licenses,
        stats,
    })
}

fn list_libs(conn: &Connection) -> rusqlite::Result<Vec<Library>> {
    let mut stmt = conn.prepare(
        "SELECT l.id, l.name, l.type, l.path, l.status, l.last,
            (SELECT COUNT(*) FROM models m WHERE m.library_id=l.id),
            (SELECT COALESCE(SUM(m.file_count),0) FROM models m WHERE m.library_id=l.id)
         FROM libraries l ORDER BY l.name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Library {
            id: r.get(0)?,
            name: r.get(1)?,
            source_type: r.get(2)?,
            path: r.get(3)?,
            status: r.get(4)?,
            last: r.get(5)?,
            models: r.get::<_, i64>(6)? as u32,
            files: r.get::<_, i64>(7)? as u32,
        })
    })?;
    rows.collect()
}

// ── Tauri commands ───────────────────────────────────────────────────────────
#[tauri::command]
pub fn get_dataset(db: State<Db>) -> Result<Dataset, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    build_dataset(&conn).map_err(|e| e.to_string())
}

/// Rename a creator (persisted as an override that survives rescans). Returns the
/// rebuilt dataset; the creator id (its slug) is unchanged so navigation holds.
#[tauri::command]
pub fn rename_creator(db: State<Db>, id: String, name: String) -> Result<Dataset, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Name can't be empty".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    set_name_override(&conn, "creator", &id, trimmed).map_err(|e| e.to_string())?;
    build_dataset(&conn).map_err(|e| e.to_string())
}

/// Create a user-defined collection. Returns (new id, rebuilt dataset).
#[tauri::command]
pub fn create_collection(db: State<Db>, name: String) -> Result<(String, Dataset), String> {
    let nm = name.trim();
    if nm.is_empty() {
        return Err("Name can't be empty".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM user_collections", [], |r| r.get(0))
        .unwrap_or(0);
    let id = format!("uc{:x}", fnv1a(&format!("{nm}|{n}")));
    conn.execute(
        "INSERT OR REPLACE INTO user_collections (id,name,created) VALUES (?1,?2,datetime('now'))",
        params![id, nm],
    )
    .map_err(|e| e.to_string())?;
    let ds = build_dataset(&conn).map_err(|e| e.to_string())?;
    Ok((id, ds))
}

/// Rename a user-defined collection (or a folder-derived one, via an override).
#[tauri::command]
pub fn rename_collection(db: State<Db>, id: String, name: String) -> Result<Dataset, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Name can't be empty".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // User collections store the name directly; folder ones use an override.
    let updated = conn
        .execute("UPDATE user_collections SET name=?2 WHERE id=?1", params![id, trimmed])
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        set_name_override(&conn, "collection", &id, trimmed).map_err(|e| e.to_string())?;
    }
    build_dataset(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_to_collection(db: State<Db>, collection_id: String, model_id: String) -> Result<Dataset, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO collection_members (collection_id,model_id) VALUES (?1,?2)",
        params![collection_id, model_id],
    )
    .map_err(|e| e.to_string())?;
    build_dataset(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_from_collection(db: State<Db>, collection_id: String, model_id: String) -> Result<Dataset, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM collection_members WHERE collection_id=?1 AND model_id=?2",
        params![collection_id, model_id],
    )
    .map_err(|e| e.to_string())?;
    build_dataset(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_collection(db: State<Db>, id: String) -> Result<Dataset, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM collection_members WHERE collection_id=?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM user_collections WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    build_dataset(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_libraries(db: State<Db>) -> Result<Vec<Library>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    list_libs(&conn).map_err(|e| e.to_string())
}

/// Spawn a background scan thread for a library. Returns immediately; progress
/// is reported via "scan-progress" events and completion via "dataset-changed".
fn spawn_scan(app: &tauri::AppHandle, lib_id: String, path: String, watch: bool, force: bool) {
    let cancel = app.state::<ScanFlags>().fresh(&lib_id);
    let app = app.clone();
    std::thread::spawn(move || {
        do_scan(&app, &lib_id, &PathBuf::from(&path), cancel.clone(), force);
        // Start watching only after a successful (non-cancelled) scan.
        if watch && !cancel.load(Ordering::SeqCst) {
            crate::watch::start(&app, &lib_id, &path);
        }
    });
}

#[tauri::command]
pub fn add_library(
    app: tauri::AppHandle,
    db: State<Db>,
    path: String,
    name: Option<String>,
    options: Option<ScanOptions>,
) -> Result<Vec<Library>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a folder: {path}"));
    }
    let mut opts = options.unwrap_or_default();
    // Network shares can't be reliably watched (phantom FSEvents loop), so never
    // enable watch for them — they refresh via manual Reindex.
    if is_network_path(&root) {
        opts.watch = false;
    }
    let lib_id = format!("l{:x}", fnv1a(&path));
    let lib_name = name.unwrap_or_else(|| prettify(&file_name(&root)));

    // Insert the library row in 'scanning' state and return RIGHT AWAY — the walk
    // happens on a background thread so the UI never blocks (the freeze fix).
    let libs = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO libraries (id,name,type,path,status,last,watch,organize,do_tags,thumbs)
             VALUES (?1,?2,'local',?3,'scanning','now',?4,?5,?6,?7)",
            params![lib_id, lib_name, path, opts.watch as i32, opts.organize as i32, opts.tags as i32, opts.thumbs as i32],
        )
        .map_err(|e| e.to_string())?;
        list_libs(&conn).map_err(|e| e.to_string())?
    };

    spawn_scan(&app, lib_id, path, opts.watch, false);
    Ok(libs)
}

#[tauri::command]
pub fn rescan_library(app: tauri::AppHandle, db: State<Db>, id: String, force: Option<bool>) -> Result<Vec<Library>, String> {
    let (path, watch): (String, i64) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute("UPDATE libraries SET status='scanning' WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.query_row("SELECT path, watch FROM libraries WHERE id=?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?
    };
    spawn_scan(&app, id, path, watch != 0, force.unwrap_or(false));
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    list_libs(&conn).map_err(|e| e.to_string())
}

/// Stop an in-flight scan for a library without removing it (the Stop button).
#[tauri::command]
pub fn cancel_scan(app: tauri::AppHandle, db: State<Db>, id: String) -> Result<(), String> {
    app.state::<ScanFlags>().cancel(&id);
    if let Ok(conn) = db.0.lock() {
        let _ = conn.execute("UPDATE libraries SET status='idle', last='just now' WHERE id=?1", params![id]);
    }
    Ok(())
}

#[tauri::command]
pub fn eject_library(app: tauri::AppHandle, db: State<Db>, id: String) -> Result<Vec<Library>, String> {
    // Cancel any in-flight scan and stop watching before removing.
    app.state::<ScanFlags>().cancel(&id);
    crate::watch::stop(&app, &id);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM libraries WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    list_libs(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_watch(app: tauri::AppHandle, db: State<Db>, id: String, on: bool) -> Result<Vec<Library>, String> {
    let path: String = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let status = if on { "watching" } else { "idle" };
        conn.execute(
            "UPDATE libraries SET watch=?2, status=?3 WHERE id=?1",
            params![id, on as i32, status],
        )
        .map_err(|e| e.to_string())?;
        conn.query_row("SELECT path FROM libraries WHERE id=?1", params![id], |r| r.get(0))
            .map_err(|e| e.to_string())?
    };
    if on {
        crate::watch::start(&app, &id, &path);
    } else {
        crate::watch::stop(&app, &id);
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    list_libs(&conn).map_err(|e| e.to_string())
}

/// Dev helper: mount + scan a folder at boot (driven by TROVE_DEV_MOUNT) so the
/// full pipeline can be exercised without GUI interaction. No-op if already mounted.
pub fn dev_mount(app: &tauri::AppHandle, path: &str) {
    let root = PathBuf::from(path);
    if !root.is_dir() {
        eprintln!("[dev_mount] not a folder: {path}");
        return;
    }
    let lib_id = format!("l{:x}", fnv1a(&path.to_string()));
    let lib_name = prettify(&file_name(&root));
    let db = app.state::<Db>();
    if let Ok(conn) = db.0.lock() {
        // INSERT OR IGNORE (not REPLACE) so re-running keeps existing models +
        // fingerprints — exercises the real incremental rescan path across launches.
        let _ = conn.execute(
            "INSERT OR IGNORE INTO libraries (id,name,type,path,status,last,watch,organize,do_tags,thumbs)
             VALUES (?1,?2,'local',?3,'scanning','now',1,1,1,1)",
            params![lib_id, lib_name, path],
        );
    }
    // Use the real async path so the dev mount mirrors production (non-blocking).
    spawn_scan(app, lib_id, path.to_string(), true, false);
    eprintln!("[dev_mount] background scan started for {path}");
}

#[tauri::command]
pub fn save_thumb(
    app: tauri::AppHandle,
    db: State<Db>,
    model_id: String,
    data_url: String,
    dim_w: Option<u32>,
    dim_d: Option<u32>,
    dim_h: Option<u32>,
) -> Result<String, String> {
    use base64::Engine;
    use tauri::Manager;

    let b64 = data_url.split(',').nth(1).unwrap_or(&data_url);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| e.to_string())?;

    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("thumbs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{model_id}.png"));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    let path_str = path.to_string_lossy().to_string();

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // Persist the thumbnail path and, when supplied, the real mesh dimensions
    // (computed once during render) so cards/detail show W/D/H without reloading.
    conn.execute(
        "UPDATE models SET thumb=?2, dim_w=?3, dim_d=?4, dim_h=?5 WHERE id=?1",
        params![
            model_id, path_str,
            dim_w.unwrap_or(0), dim_d.unwrap_or(0), dim_h.unwrap_or(0)
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(path_str)
}

/// Rebuild the Quick Find FTS index from the base tables (run after a scan).
fn rebuild_fts(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM search_fts", [])?;
    // One row per file (file-name search).
    conn.execute(
        "INSERT INTO search_fts (kind, ref_id, text)
         SELECT 'file', f.id, f.name FROM files f WHERE f.is_part = 1",
        [],
    )?;
    // One row per model (folder name + tags).
    conn.execute(
        "INSERT INTO search_fts (kind, ref_id, text)
         SELECT 'folder', m.id, m.name || ' ' || COALESCE((SELECT group_concat(t.tag,' ') FROM tags t WHERE t.model_id=m.id),'')
         FROM models m",
        [],
    )?;
    Ok(())
}

/// Escape a user query into a single FTS5 quoted string token (safe for trigram).
fn fts_query(q: &str) -> String {
    format!("\"{}\"", q.replace('"', "\"\""))
}

#[tauri::command]
pub fn quick_search(db: State<Db>, query: String) -> Result<QuickResults, String> {
    let q = query.trim().to_lowercase();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut files: Vec<QuickFile> = Vec::new();
    let mut folders: Vec<QuickFolder> = Vec::new();
    if q.is_empty() {
        // Empty query → a few recent STL files + recent folders (the launcher's
        // resting state).
        collect_quick_files(&conn, None, &mut files).map_err(|e| e.to_string())?;
        collect_quick_folders(&conn, None, &mut folders).map_err(|e| e.to_string())?;
        return Ok(QuickResults { files, folders });
    }
    // Trigram FTS needs ≥3 chars; fall back to LIKE for short queries.
    let use_fts = q.chars().count() >= 3;
    if use_fts {
        let m = fts_query(&q);
        let mut fids: Vec<i64> = Vec::new();
        let mut mids: Vec<String> = Vec::new();
        {
            let mut st = conn
                .prepare("SELECT kind, ref_id FROM search_fts WHERE search_fts MATCH ?1 LIMIT 200")
                .map_err(|e| e.to_string())?;
            let rows = st
                .query_map(params![m], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?;
            for row in rows.flatten() {
                if row.0 == "file" {
                    if let Ok(id) = row.1.parse::<i64>() { fids.push(id); }
                } else {
                    mids.push(row.1);
                }
            }
        }
        for id in fids.iter().take(7) {
            if let Ok(f) = quick_file_by_id(&conn, *id) { files.push(f); }
        }
        for id in mids.iter().take(5) {
            if let Ok(f) = quick_folder_by_id(&conn, id) { folders.push(f); }
        }
    } else {
        let like = format!("%{q}%");
        collect_quick_files(&conn, Some(&like), &mut files).map_err(|e| e.to_string())?;
        collect_quick_folders(&conn, Some(&like), &mut folders).map_err(|e| e.to_string())?;
    }
    Ok(QuickResults { files, folders })
}

fn quick_file_by_id(conn: &Connection, id: i64) -> rusqlite::Result<QuickFile> {
    conn.query_row(
        "SELECT f.name, f.type, f.size, f.path, m.id, m.name, m.color, m.geometry, m.thumb, m.preview
         FROM files f JOIN models m ON f.model_id=m.id WHERE f.id=?1",
        params![id],
        |r| Ok(QuickFile {
            name: r.get(0)?, ftype: r.get(1)?, size: r.get::<_, i64>(2)? as u64, path: r.get(3)?,
            model_id: r.get(4)?, model_name: r.get(5)?, color: r.get(6)?, geometry: r.get(7)?,
            thumb: r.get(8)?, preview: r.get(9)?,
        }),
    )
}

fn quick_folder_by_id(conn: &Connection, id: &str) -> rusqlite::Result<QuickFolder> {
    let (mid, name, color, geometry, folder, thumb, preview): (String, String, String, String, String, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT id, name, color, geometry, folder, thumb, preview FROM models WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )?;
    let mut tst = conn.prepare("SELECT tag FROM tags WHERE model_id=?1 ORDER BY tag LIMIT 6")?;
    let tags: Vec<String> = tst.query_map(params![mid], |r| r.get(0))?.filter_map(|t| t.ok()).collect();
    let mut fst = conn.prepare("SELECT type FROM files WHERE model_id=?1 AND is_part=1")?;
    let mut file_types: Vec<String> = fst.query_map(params![mid], |r| r.get::<_, String>(0))?.filter_map(|t| t.ok()).collect();
    file_types.sort();
    file_types.dedup();
    let files = conn.query_row("SELECT COUNT(*) FROM files WHERE model_id=?1", params![mid], |r| r.get::<_, i64>(0))? as u32;
    Ok(QuickFolder { id: mid, name, color, geometry, thumb, preview, folder, files, file_types, tags })
}

fn collect_quick_files(conn: &Connection, like: Option<&str>, out: &mut Vec<QuickFile>) -> rusqlite::Result<()> {
    let sql = if like.is_some() {
        "SELECT f.id FROM files f WHERE f.is_part=1 AND lower(f.name) LIKE ?1
         ORDER BY (f.type='stl') DESC LIMIT 7"
    } else {
        "SELECT f.id FROM files f WHERE f.is_part=1 AND f.type='stl' LIMIT 4"
    };
    let mut st = conn.prepare(sql)?;
    let ids: Vec<i64> = if let Some(l) = like {
        st.query_map(params![l], |r| r.get(0))?.filter_map(|x| x.ok()).collect()
    } else {
        st.query_map([], |r| r.get(0))?.filter_map(|x| x.ok()).collect()
    };
    for id in ids {
        if let Ok(f) = quick_file_by_id(conn, id) { out.push(f); }
    }
    Ok(())
}

fn collect_quick_folders(conn: &Connection, like: Option<&str>, out: &mut Vec<QuickFolder>) -> rusqlite::Result<()> {
    let sql = if like.is_some() {
        "SELECT DISTINCT m.id FROM models m LEFT JOIN tags t ON t.model_id=m.id
         WHERE lower(m.name) LIKE ?1 OR lower(t.tag) LIKE ?1 LIMIT 5"
    } else {
        "SELECT id FROM models LIMIT 3"
    };
    let mut st = conn.prepare(sql)?;
    let ids: Vec<String> = if let Some(l) = like {
        st.query_map(params![l], |r| r.get(0))?.filter_map(|x| x.ok()).collect()
    } else {
        st.query_map([], |r| r.get(0))?.filter_map(|x| x.ok()).collect()
    };
    for id in ids {
        if let Ok(f) = quick_folder_by_id(conn, &id) { out.push(f); }
    }
    Ok(())
}

#[tauri::command]
pub fn get_setting(db: State<Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.query_row("SELECT value FROM settings WHERE key=?1", params![key], |r| r.get::<_, String>(0))
        .optional()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(db: State<Db>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn touch(p: &Path, bytes: usize) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, vec![0u8; bytes]).unwrap();
    }

    // Run the live collector + grouper over a temp tree (mirrors do_scan phases 1–2).
    fn group(root: &Path) -> Vec<GroupedModel> {
        let dirs = std::sync::Arc::new(std::sync::Mutex::new(BTreeMap::new()));
        let d2 = dirs.clone();
        let on_dir: Arc<dyn Fn(PathBuf, Vec<ScannedFile>, i64) + Send + Sync> =
            Arc::new(move |p, f, m| { d2.lock().unwrap().insert(p, (f, m)); });
        collect_tree(root, Arc::new(AtomicBool::new(false)), 4, on_dir);
        let map = dirs.lock().unwrap().clone();
        group_models(root, &map)
    }

    #[test]
    fn groups_subtrees_and_containers() {
        let root = std::env::temp_dir().join(format!("trove_grp_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        // Model whose printables live in variant subfolders, images at the top
        // (Squirtle pattern) → must be ONE model, not "Life Sized"/"150mm".
        touch(&root.join("Squirtle/front.jpg"), 1000);
        touch(&root.join("Squirtle/Life Sized/body.stl"), 2000);
        touch(&root.join("Squirtle/150mm/body.stl"), 2000);
        // A container (tier) of two distinct models → each its own model.
        touch(&root.join("Tier/Goku Helmet/helmet.stl"), 1500);
        touch(&root.join("Tier/Goku Helmet/render.png"), 500);
        touch(&root.join("Tier/Vegeta Helmet/helmet.stl"), 1500);

        let models = group(&root);
        let names: Vec<String> = models.iter().map(|g| file_name(&g.dir)).collect();
        assert!(names.contains(&"Squirtle".to_string()), "got {names:?}");
        assert!(names.contains(&"Goku Helmet".to_string()), "got {names:?}");
        assert!(names.contains(&"Vegeta Helmet".to_string()), "got {names:?}");
        // The variant subfolders and the container are NOT their own models.
        assert!(!names.iter().any(|n| n == "Life Sized" || n == "150mm" || n == "Tier"), "got {names:?}");
        assert_eq!(models.len(), 3, "got {names:?}");

        // Squirtle absorbed both variant STLs + uses the top-level image as preview.
        let sq = models.iter().find(|g| file_name(&g.dir) == "Squirtle").unwrap();
        assert_eq!(sq.files.iter().filter(|f| is_printable(&f.ext)).count(), 2);
        assert!(pick_preview(&sq.files).unwrap().ends_with("front.jpg"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn scans_folder_tree_into_dataset() {
        // unique temp root
        let root = std::env::temp_dir().join(format!("trove_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        // Creator/Model (depth 2, no collection)
        touch(&root.join("Studio Voxel/Low Poly Fox/fox.stl"), 2048);
        // Creator/Model with multiple parts + an extra (depth 2)
        touch(&root.join("Studio Voxel/Dice Set/d20.stl"), 1024);
        touch(&root.join("Studio Voxel/Dice Set/d6.stl"), 1024);
        touch(&root.join("Studio Voxel/Dice Set/readme.txt"), 100);
        // Creator/Collection/Model (depth 3)
        touch(&root.join("ForgeWorks/Functional/Wall Bracket/bracket.step"), 4096);

        let mut conn = crate::db::open(&root.join("test.db")).unwrap();
        conn.execute(
            "INSERT INTO libraries (id,name,type,path,status,last) VALUES ('lib','T','local',?1,'idle','')",
            params![root.to_string_lossy()],
        )
        .unwrap();

        let (models, files) = persist_scan(&mut conn, "lib", &root).unwrap();
        assert_eq!(models, 3, "expected 3 model folders");
        assert_eq!(files, 5, "expected 5 files total");

        let ds = build_dataset(&conn).unwrap();
        assert_eq!(ds.models.len(), 3);
        assert_eq!(ds.stats.models, 3);

        // creators: studio_voxel + forgeworks
        let creator_ids: Vec<&str> = ds.creators.iter().map(|c| c.id.as_str()).collect();
        assert!(creator_ids.contains(&"studio_voxel"), "creators: {:?}", creator_ids);
        assert!(creator_ids.contains(&"forgeworks"));

        // collection: functional (from depth-3 path)
        assert!(ds.collections.iter().any(|c| c.id == "functional"), "collections: {:?}",
            ds.collections.iter().map(|c| &c.id).collect::<Vec<_>>());

        // Dice Set → 2 printable parts + 1 extra, tagged multi-part
        let dice = ds.models.iter().find(|m| m.name == "Dice Set").expect("Dice Set model");
        assert_eq!(dice.parts.len(), 2, "dice parts");
        assert_eq!(dice.extras.len(), 1, "dice extras (readme.txt)");
        assert!(dice.tags.contains(&"multi-part".to_string()), "dice tags: {:?}", dice.tags);
        assert!(dice.tags.contains(&"stl".to_string()));

        // single-part model has 1 part, 0 extras, real file facts
        let fox = ds.models.iter().find(|m| m.name == "Low Poly Fox").expect("fox model");
        assert_eq!(fox.parts.len(), 1);
        assert_eq!(fox.file_count, 1);
        assert_eq!(fox.total_size, 2048);
        assert!(fox.print_time.is_none(), "real models carry no print time");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_override_and_user_collections() {
        let root = std::env::temp_dir().join(format!("trove_rc_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        touch(&root.join("Studio Voxel/Low Poly Fox/fox.stl"), 2048);
        touch(&root.join("Studio Voxel/Dice Set/d20.stl"), 1024);

        let mut conn = crate::db::open(&root.join("test.db")).unwrap();
        conn.execute(
            "INSERT INTO libraries (id,name,type,path,status,last) VALUES ('lib','T','local',?1,'idle','')",
            params![root.to_string_lossy()],
        )
        .unwrap();
        persist_scan(&mut conn, "lib", &root).unwrap();

        // Rename override beats the auto-derived name AND survives a rescan.
        set_name_override(&conn, "creator", "studio_voxel", "Voxel Labs").unwrap();
        let ds = build_dataset(&conn).unwrap();
        let c = ds.creators.iter().find(|c| c.id == "studio_voxel").unwrap();
        assert_eq!(c.name, "Voxel Labs", "override should win");
        persist_scan(&mut conn, "lib", &root).unwrap(); // rescan rewrites `names`
        let ds = build_dataset(&conn).unwrap();
        assert_eq!(
            ds.creators.iter().find(|c| c.id == "studio_voxel").unwrap().name,
            "Voxel Labs",
            "override must survive a rescan"
        );

        // A user collection with one member shows up with members + count.
        let fox_id = ds.models.iter().find(|m| m.name == "Low Poly Fox").unwrap().id.clone();
        conn.execute("INSERT INTO user_collections (id,name,created) VALUES ('uc1','Favorites','')", []).unwrap();
        conn.execute("INSERT INTO collection_members (collection_id,model_id) VALUES ('uc1',?1)", params![fox_id]).unwrap();
        let ds = build_dataset(&conn).unwrap();
        let uc = ds.collections.iter().find(|c| c.id == "uc1").expect("user collection present");
        assert_eq!(uc.name, "Favorites");
        assert_eq!(uc.count, 1);
        assert_eq!(uc.members.as_ref().unwrap(), &vec![fox_id]);
        // Folder-derived collections carry no explicit membership.
        assert!(ds.collections.iter().filter(|c| c.id != "uc1").all(|c| c.members.is_none()));

        let _ = fs::remove_dir_all(&root);
    }

    // Gated benchmark: set TROVE_BENCH_DIR to a real folder to compare the serial
    // vs parallel walkers. Skips in normal `cargo test`.
    //   TROVE_BENCH_DIR="/path/to/your/model/library" cargo test bench_walk -- --nocapture
    #[test]
    fn bench_walk() {
        use std::sync::atomic::AtomicUsize;
        use std::time::Instant;
        let dir = match std::env::var("TROVE_BENCH_DIR") {
            Ok(d) => std::path::PathBuf::from(d),
            Err(_) => return,
        };

        // TROVE_BENCH_MODE=serial|parallel runs a single COLD mode (so each can be
        // measured on a fresh folder); default runs both (cache-biased).
        let mode = std::env::var("TROVE_BENCH_MODE").unwrap_or_default();
        let files = Arc::new(AtomicUsize::new(0));

        let _ = &files;
        if mode != "parallel" {
            let never = AtomicBool::new(false);
            let t0 = Instant::now();
            let mut models = 0u32;
            let mut nfiles = 0u32;
            scan_stream(&dir, &never, &mut |rec| { models += 1; nfiles += rec.file_count; }, &mut |_| {});
            let t = t0.elapsed().as_secs_f64();
            eprintln!("[bench] SERIAL: {models} models, {nfiles} files in {:.2}s = {:.0} files/s",
                t, nfiles as f64 / t.max(0.001));
            if mode == "serial" { return; }
        }

        for threads in [8usize, 16, 32] {
            let cancel = Arc::new(AtomicBool::new(false));
            let cnt = Arc::new(AtomicUsize::new(0));
            let nf = Arc::new(AtomicUsize::new(0));
            let (c2, f2) = (cnt.clone(), nf.clone());
            let empty: Arc<HashMap<String, i64>> = Arc::new(HashMap::new());
            let t1 = Instant::now();
            scan_parallel(&dir, cancel, threads, empty,
                Arc::new(move |msg| if let ScanMsg::Model(rec) = msg {
                    c2.fetch_add(1, Ordering::Relaxed);
                    f2.fetch_add(rec.file_count as usize, Ordering::Relaxed);
                }));
            let t = t1.elapsed().as_secs_f64();
            eprintln!("[bench] PARALLEL x{threads}: {} models, {} files in {:.2}s = {:.0} files/s",
                cnt.load(Ordering::Relaxed), nf.load(Ordering::Relaxed), t, nf.load(Ordering::Relaxed) as f64 / t.max(0.001));
            if mode == "parallel" { return; }
        }
    }

    #[test]
    fn fts_quick_search_finds_files_and_folders() {
        let root = std::env::temp_dir().join(format!("trove_fts_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        touch(&root.join("Greeble Labs/Koi Flexi/koi_flexi.stl"), 64);
        touch(&root.join("Greeble Labs/Koi Flexi/koi_flexi.3mf"), 64);
        touch(&root.join("Forge/Bracket/wall_bracket.stl"), 64);

        let mut conn = crate::db::open(&root.join("fts.db")).unwrap();
        conn.execute(
            "INSERT INTO libraries (id,name,type,path,status,last) VALUES ('lib','T','local',?1,'idle','')",
            params![root.to_string_lossy()],
        ).unwrap();
        persist_scan(&mut conn, "lib", &root).unwrap();
        rebuild_fts(&conn).unwrap();

        // FTS (trigram) substring match on a file name.
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM search_fts WHERE search_fts MATCH ?1", params![fts_query("koi")], |r| r.get(0))
            .unwrap();
        assert!(n >= 2, "expected koi file rows in FTS, got {n}");

        // LIKE-path file collection.
        let mut files = Vec::new();
        collect_quick_files(&conn, Some("%koi%"), &mut files).unwrap();
        assert!(files.iter().all(|f| f.name.to_lowercase().contains("koi")));
        assert!(files.iter().any(|f| f.ftype == "stl"));
        assert!(!files.is_empty());

        // Folder collection by tag/name.
        let mut folders = Vec::new();
        collect_quick_folders(&conn, Some("%bracket%"), &mut folders).unwrap();
        assert!(folders.iter().any(|f| f.name.to_lowercase().contains("bracket")), "folders: {:?}", folders.iter().map(|f| &f.name).collect::<Vec<_>>());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn incremental_skips_unchanged_changes_changed() {
        use std::sync::Mutex;
        let root = std::env::temp_dir().join(format!("trove_inc_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        touch(&root.join("Alpha/a.stl"), 10);
        touch(&root.join("Beta/b.stl"), 10);

        // Collect (id, name, dir_mtime) from Model msgs, and ids from Unchanged.
        let run = |existing: HashMap<String, i64>| {
            let models: Arc<Mutex<Vec<(String, String, i64)>>> = Arc::new(Mutex::new(Vec::new()));
            let unchanged: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
            let (m2, u2) = (models.clone(), unchanged.clone());
            scan_parallel(&root, Arc::new(AtomicBool::new(false)), 4, Arc::new(existing),
                Arc::new(move |msg| match msg {
                    ScanMsg::Model(r) => m2.lock().unwrap().push((r.id.clone(), r.name.clone(), r.dir_mtime)),
                    ScanMsg::Unchanged(id) => u2.lock().unwrap().push(id),
                }));
            let m = models.lock().unwrap().clone();
            let u = unchanged.lock().unwrap().clone();
            (m, u)
        };

        // 1) First scan (no fingerprints) → both are new Models.
        let (m1, u1) = run(HashMap::new());
        assert_eq!(m1.len(), 2, "first scan should find 2 models");
        assert_eq!(u1.len(), 0);

        // Build the correct fingerprint map from the first scan.
        let fp: HashMap<String, i64> = m1.iter().map(|(id, _, mt)| (id.clone(), *mt)).collect();

        // 2) Rescan with matching fingerprints → both Unchanged (skipped).
        let (m2, u2) = run(fp.clone());
        assert_eq!(m2.len(), 0, "unchanged rescan must write nothing");
        assert_eq!(u2.len(), 2);

        // 3) Corrupt Alpha's fingerprint → Alpha re-processed, Beta still skipped.
        let alpha_id = m1.iter().find(|(_, n, _)| n == "Alpha").unwrap().0.clone();
        let mut fp2 = fp.clone();
        fp2.insert(alpha_id.clone(), -1);
        let (m3, u3) = run(fp2);
        assert_eq!(m3.len(), 1, "only Alpha should re-process");
        assert_eq!(m3[0].1, "Alpha");
        assert_eq!(u3.len(), 1);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_stream_emits_models_progressively() {
        let root = std::env::temp_dir().join(format!("trove_stream_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        // nested + flat model dirs, plus a non-model dir (only images)
        touch(&root.join("Helmet/front.stl"), 10);
        touch(&root.join("Helmet/back.stl"), 10);
        touch(&root.join("Saber/Stand/base.stl"), 10);     // nested model dir
        touch(&root.join("Saber/blade.3mf"), 10);          // model dir too
        touch(&root.join("Pictures/photo.jpg"), 10);       // NOT a model (no printable)

        let cancel = AtomicBool::new(false);
        let mut emitted: Vec<String> = Vec::new();
        let mut files_seen_calls = 0u32;
        let errors = scan_stream(
            &root,
            &cancel,
            &mut |rec| emitted.push(rec.name.clone()),
            &mut |_| files_seen_calls += 1,
        );
        emitted.sort();
        assert_eq!(errors, 0);
        // Model dirs: Helmet, Saber (blade.3mf), Saber/Stand (base.stl). Pictures excluded.
        // Names are the directory names (last path segment), prettified.
        assert_eq!(emitted, vec!["Helmet", "Saber", "Stand"], "got {:?}", emitted);
        let _ = files_seen_calls;
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_chunked_releases_lock_between_chunks() {
        use std::sync::Mutex;
        use std::time::{Duration, Instant};

        let root = std::env::temp_dir().join(format!("trove_chunk_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        // 450 model dirs (1 stl each) → 3 chunks of SCAN_CHUNK=200.
        for i in 0..450 {
            touch(&root.join(format!("Creator/Model {i}/part.stl")), 16);
        }
        let conn = crate::db::open(&root.join("c.db")).unwrap();
        conn.execute(
            "INSERT INTO libraries (id,name,type,path,status,last) VALUES ('lib','T','local',?1,'idle','')",
            params![root.to_string_lossy()],
        ).unwrap();
        let db = Mutex::new(conn);

        let never = AtomicBool::new(false);
        let entries: Vec<(PathBuf, Vec<ScannedFile>)> =
            collect_model_dirs(&root, &never, &mut |_| {}).into_iter().collect();
        assert_eq!(entries.len(), 450);

        // Record the model count visible to a concurrent reader after each chunk:
        // if the writer held the lock for the whole scan, we'd only ever see 0
        // until the end. Progressive counts prove the lock is released between chunks.
        let mut progress_counts: Vec<u32> = Vec::new();
        let (models, files) = write_chunked(&db, "lib", &root, &entries, &never, &mut |m, _f| {
            // A separate lock acquisition mid-scan must succeed quickly.
            let t = Instant::now();
            let visible: i64 = db.lock().unwrap()
                .query_row("SELECT COUNT(*) FROM models", [], |r| r.get(0)).unwrap();
            assert!(t.elapsed() < Duration::from_secs(2), "reader blocked too long mid-scan");
            progress_counts.push(visible as u32);
            let _ = m;
        });

        assert_eq!(models, 450);
        assert_eq!(files, 450);
        // 3 chunks → 3 progress steps with increasing visible counts.
        assert_eq!(progress_counts.len(), 3, "expected 3 chunks, got {:?}", progress_counts);
        assert_eq!(progress_counts, vec![200, 400, 450]);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn auto_tags_from_names() {
        let (tags, supports) = auto_tags(
            "articulated koi flexi PLA support-free",
            &["stl".into(), "3mf".into()],
            true,
        );
        assert!(tags.contains(&"articulated".to_string()));
        assert!(tags.contains(&"PLA".to_string()));
        assert!(tags.contains(&"support-free".to_string()));
        assert!(tags.contains(&"multi-part".to_string()));
        assert!(tags.contains(&"stl".to_string()));
        assert!(!supports, "support-free should not set supports");

        let (tags2, supports2) = auto_tags("dragon needs supports resin", &["stl".into()], false);
        assert!(supports2, "'supports' keyword sets supports");
        assert!(tags2.contains(&"supports".to_string()));
        assert!(tags2.contains(&"resin".to_string()));
        assert!(!tags2.contains(&"multi-part".to_string()));
    }

    #[test]
    fn pretty_and_slug_helpers() {
        assert_eq!(prettify("low_poly-fox"), "Low Poly Fox");
        assert_eq!(slug("Studio Voxel!"), "studio_voxel");
        assert_eq!(ext_of("model.STL"), "stl");
        assert_eq!(ext_of("part.stp"), "step");
        assert_eq!(iso_date(0), "1970-01-01");
    }
}
