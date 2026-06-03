// SQLite schema + connection. One connection guarded by a Mutex in Tauri state.

use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS libraries (
            id        TEXT PRIMARY KEY,
            name      TEXT NOT NULL,
            type      TEXT NOT NULL,
            path      TEXT NOT NULL UNIQUE,
            status    TEXT NOT NULL DEFAULT 'idle',
            last      TEXT NOT NULL DEFAULT '',
            watch     INTEGER NOT NULL DEFAULT 1,
            organize  INTEGER NOT NULL DEFAULT 1,
            do_tags   INTEGER NOT NULL DEFAULT 1,
            thumbs    INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS models (
            id          TEXT PRIMARY KEY,
            library_id  TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            creator     TEXT NOT NULL DEFAULT '',
            collection  TEXT NOT NULL DEFAULT '',
            geometry    TEXT NOT NULL DEFAULT 'cube',
            color       TEXT NOT NULL DEFAULT '#c2693d',
            license     TEXT NOT NULL DEFAULT 'Unknown',
            source      TEXT NOT NULL DEFAULT 'Local',
            source_url  TEXT NOT NULL DEFAULT '',
            supports    INTEGER NOT NULL DEFAULT 0,
            added       TEXT NOT NULL DEFAULT '',
            descr       TEXT NOT NULL DEFAULT '',
            folder      TEXT NOT NULL,
            file_count  INTEGER NOT NULL DEFAULT 0,
            total_size  INTEGER NOT NULL DEFAULT 0,
            thumb       TEXT,
            preview     TEXT,
            dir_mtime   INTEGER NOT NULL DEFAULT 0,
            dim_w       INTEGER NOT NULL DEFAULT 0,
            dim_d       INTEGER NOT NULL DEFAULT 0,
            dim_h       INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS files (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            model_id  TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
            name      TEXT NOT NULL,
            type      TEXT NOT NULL,
            size      INTEGER NOT NULL DEFAULT 0,
            path      TEXT NOT NULL,
            is_part   INTEGER NOT NULL DEFAULT 0,
            geometry  TEXT NOT NULL DEFAULT 'cube',
            color     TEXT NOT NULL DEFAULT '#c2693d'
        );

        CREATE TABLE IF NOT EXISTS tags (
            model_id  TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
            tag       TEXT NOT NULL,
            UNIQUE(model_id, tag)
        );

        -- User edits to creator/collection display names. Consulted BEFORE the
        -- auto-derived `names` table so a rename survives rescans (which rewrite
        -- `names` from folder structure but never touch this).
        CREATE TABLE IF NOT EXISTS name_overrides (
            kind TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
            PRIMARY KEY(kind, id)
        );

        -- User-defined collections: arbitrary groupings of models, independent of
        -- the folder-derived collections. Membership is many-to-many.
        CREATE TABLE IF NOT EXISTS user_collections (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS collection_members (
            collection_id TEXT NOT NULL, model_id TEXT NOT NULL,
            PRIMARY KEY(collection_id, model_id)
        );

        CREATE INDEX IF NOT EXISTS idx_models_library ON models(library_id);
        CREATE INDEX IF NOT EXISTS idx_files_model    ON files(model_id);
        CREATE INDEX IF NOT EXISTS idx_tags_model     ON tags(model_id);
        CREATE INDEX IF NOT EXISTS idx_tags_tag       ON tags(tag);
        "#,
    )?;

    // Migrations for DBs created before these columns existed (ignore if present).
    let _ = conn.execute("ALTER TABLE models ADD COLUMN dir_mtime INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE models ADD COLUMN dim_w INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE models ADD COLUMN dim_d INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE models ADD COLUMN dim_h INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE models ADD COLUMN preview TEXT", []);

    // Full-text search over file + folder names/tags for the Quick Find launcher.
    // Trigram tokenizer gives substring ("contains") matching at scale; rows are
    // rebuilt from the base tables at the end of each scan. `kind` is 'file' or
    // 'folder'; `ref_id` joins back to files.id / models.id for display.
    let _ = conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
            kind UNINDEXED, ref_id UNINDEXED, text, tokenize='trigram'
        );",
    );
    Ok(())
}
