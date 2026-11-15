// Serde structs mirroring the TypeScript domain types (src/data/types.ts).
// Field names match the TS interfaces so the frontend consumes them directly.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelFile {
    pub name: String,
    #[serde(rename = "type")]
    pub ftype: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The file is an unreadable archive (e.g. a .3mf whose copy was cut short).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub damaged: bool,
}

/// One version of a part, recognised from its file name (`stand_v4.3mf` → "v4").
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartVersion {
    /// "v4", "v11h", or "original" for the file without a version marker.
    pub label: String,
    pub files: Vec<ModelFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Part {
    pub id: String,
    pub name: String,
    pub geometry: String,
    pub color: String,
    /// The part's files — of its NEWEST version when it has several.
    pub files: Vec<ModelFile>,
    /// All versions, newest first. Empty unless the part exists in at least two.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub versions: Vec<PartVersion>,
}

/// One build plate of a slicer project (.3mf).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Plate {
    /// 1-based plate number, as the slicer shows it.
    pub index: u32,
    /// The plate's name from the project, or "" when it has none.
    pub name: String,
    /// Cached plate preview (raw cache path; the frontend resolves it).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb: Option<String>,
    /// Ticked off as printed by the user.
    pub printed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Creator {
    pub id: String,
    pub name: String,
    pub handle: String,
    pub models: u32,
    pub blurb: String,
    pub tone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub blurb: String,
    pub cover: String,
    pub tone: String,
    pub count: u32,
    /// For user-defined collections: explicit model-id membership (folder-derived
    /// collections leave this None and are matched by the model's `collection`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub creator: String,
    pub collection: String,
    pub geometry: String,
    pub color: String,
    pub tags: Vec<String>,
    pub files: Vec<ModelFile>,
    pub license: String,
    pub source: String,
    #[serde(rename = "sourceUrl")]
    pub source_url: String,
    pub supports: bool,
    pub added: String,
    pub liked: bool,
    pub desc: String,
    pub folder: String,
    pub parts: Vec<Part>,
    pub extras: Vec<ModelFile>,
    // Print-platform metadata that real files don't carry (Trove never estimates
    // print time / filament). Omitted from real scans; present only for demo data.
    #[serde(skip_serializing_if = "Option::is_none", rename = "printTime")]
    pub print_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filament: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub makes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume: Option<u32>,
    // File-derived facts shown on cards for real models.
    #[serde(rename = "fileCount")]
    pub file_count: u32,
    #[serde(rename = "totalSize")]
    pub total_size: u64,
    // ── Slim-payload fields ──────────────────────────────────────────────────
    // The grid dataset (build_dataset) ships these light, card-only facts and
    // leaves `files`/`parts`/`extras`/`folder`/`desc` empty; the detail view
    // hydrates the heavy fields on demand via get_model. `file_types` keeps
    // client-side type faceting working without the full files array.
    #[serde(rename = "fileTypes", default)]
    pub file_types: Vec<String>,
    #[serde(rename = "partsCount", default)]
    pub parts_count: u32,
    /// True for real on-disk models (always, from the index) — lets the grid show
    /// the cached thumbnail instead of a procedural mock shape without the parts array.
    #[serde(default)]
    pub real: bool,
    /// User-set print status: "" (none), "queued" (to print) or "printed".
    #[serde(rename = "printStatus", default)]
    pub print_status: String,
    /// True when the model is a single loose file (plus same-stem siblings) on a
    /// shelf — a library root or a split folder — rather than a folder of its own.
    #[serde(rename = "fileModel", default)]
    pub file_model: bool,
    /// The split folder this model came out of, if its parent folder was split by
    /// the user (lets the UI offer to regroup it).
    #[serde(rename = "splitParent", default, skip_serializing_if = "Option::is_none")]
    pub split_parent: Option<String>,
    /// For a loose-file model: the folder model right next to it with the same
    /// name — where this file most likely belongs (the UI offers to move it there).
    #[serde(rename = "belongsTo", default, skip_serializing_if = "Option::is_none")]
    pub belongs_to: Option<String>,
    /// True when the model holds a copy of one of its own files — the same name
    /// with a "(2)"-style marker, as a second download or a duplicate gets.
    #[serde(default)]
    pub duplicates: bool,
    /// True when one of the model's files is damaged (see `ModelFile::damaged`).
    #[serde(default)]
    pub damaged: bool,
    /** Cached thumbnail (asset path) once rendered. */
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb: Option<String>,
    /** A render/photo image found in the model folder, used as the preview when
        present (cheaper + nicer than rendering the mesh). Raw path; frontend
        resolves it to an asset URL. */
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    /** Real mesh bounding-box dims (mm), persisted once a mesh is loaded; 0 = unknown. */
    #[serde(rename = "dimW")]
    pub dim_w: u32,
    #[serde(rename = "dimD")]
    pub dim_d: u32,
    #[serde(rename = "dimH")]
    pub dim_h: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stats {
    pub models: u32,
    pub files: u32,
    pub creators: u32,
    pub collections: u32,
    pub filament: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dataset {
    #[serde(rename = "CREATORS")]
    pub creators: Vec<Creator>,
    #[serde(rename = "COLLECTIONS")]
    pub collections: Vec<Collection>,
    #[serde(rename = "MODELS")]
    pub models: Vec<Model>,
    #[serde(rename = "ALL_TAGS")]
    pub all_tags: Vec<String>,
    #[serde(rename = "FILE_TYPES")]
    pub file_types: Vec<String>,
    #[serde(rename = "LICENSES")]
    pub licenses: Vec<String>,
    pub stats: Stats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub source_type: String,
    pub path: String,
    pub models: u32,
    pub files: u32,
    pub status: String,
    pub last: String,
    /// Indexed by an older `SCAN_VERSION` (or never finished a scan), so its rows
    /// predate the current grouping/naming rules until it's reindexed. Drives the
    /// one-time "reindex" notice; clears itself when the next full scan completes.
    #[serde(default)]
    pub stale: bool,
}

// ── Quick Find launcher results ──────────────────────────────────────────────
#[derive(Debug, Clone, Serialize)]
pub struct QuickFile {
    pub name: String,
    #[serde(rename = "type")]
    pub ftype: String,
    pub size: u64,
    pub path: String,
    #[serde(rename = "modelId")]
    pub model_id: String,
    #[serde(rename = "modelName")]
    pub model_name: String,
    pub color: String,
    pub geometry: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QuickFolder {
    pub id: String,
    pub name: String,
    pub color: String,
    pub geometry: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub folder: String,
    pub files: u32,
    #[serde(rename = "fileTypes")]
    pub file_types: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QuickResults {
    pub files: Vec<QuickFile>,
    pub folders: Vec<QuickFolder>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScanOptions {
    #[serde(default)]
    pub organize: bool,
    #[serde(default)]
    pub tags: bool,
    #[serde(default)]
    pub thumbs: bool,
    #[serde(default)]
    pub watch: bool,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self { organize: true, tags: true, thumbs: true, watch: true }
    }
}
