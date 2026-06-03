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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Part {
    pub id: String,
    pub name: String,
    pub geometry: String,
    pub color: String,
    pub files: Vec<ModelFile>,
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
