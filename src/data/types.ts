/* Domain types for Trove. These mirror what the Rust indexer returns in
   later phases; in Phase 1 they're populated from mock fixtures. */

export type GeometryKey =
  | "vase" | "gear" | "d20" | "cube" | "torusknot"
  | "bracket" | "figurine" | "flexi" | "box";

export type FileType = "3mf" | "stl" | "step" | "obj" | "gcode";

export interface ModelFile {
  name: string;
  type: string; // FileType in practice, but real scans may surface others
  size: number; // bytes
  /** Absolute path on disk — populated by the Rust scanner (Phase 2+). */
  path?: string;
  /** The file is an unreadable archive (e.g. a .3mf whose copy was cut short). */
  damaged?: boolean;
}

/** One version of a part, recognised from its file name (stand_v4.3mf → "v4"). */
export interface PartVersion {
  /** "v4", "v11h", or "original" for the file without a version marker. */
  label: string;
  files: ModelFile[];
}

export interface Part {
  id: string;
  name: string;
  geometry: GeometryKey;
  color: string;
  /** The part's files — of its newest version when it has several. */
  files: ModelFile[];
  /** All versions, newest first; absent unless the part exists in at least two. */
  versions?: PartVersion[];
}

/** One build plate of a slicer project (.3mf). */
export interface Plate {
  /** 1-based plate number, as the slicer shows it. */
  index: number;
  /** Plate name from the project; "" when it has none. */
  name: string;
  /** Cached preview image (asset URL once resolved). */
  thumb?: string;
  printed: boolean;
}

export interface Creator {
  id: string;
  name: string;
  handle: string;
  models: number;
  blurb: string;
  tone: string;
}

export interface Collection {
  id: string;
  name: string;
  blurb: string;
  cover: GeometryKey;
  tone: string;
  count?: number;
  /** User-defined collections carry explicit model-id membership; folder-derived
      collections leave this undefined (matched by the model's `collection`). */
  members?: string[];
}

/** User-set print status. "" = none. Mirrors PRINT_STATUSES in index.rs. */
export type PrintStatus = "" | "queued" | "printed";

export interface Model {
  id: string;
  name: string;
  creator: string; // creator id
  collection: string; // collection id
  geometry: GeometryKey;
  color: string;
  tags: string[];
  files: ModelFile[];
  license: string;
  source: string;
  sourceUrl: string;
  supports: boolean;
  added: string; // ISO date
  liked: boolean;
  desc: string;
  /** Absolute folder path on disk. */
  folder: string;
  parts: Part[];
  extras: ModelFile[];

  // Print-platform metadata the demo dataset carries but real files don't —
  // Trove never estimates print time / filament. Optional everywhere.
  volume?: number;
  filament?: number;
  printTime?: string;
  makes?: number;
  layerHeight?: number;
  nozzle?: number;

  // File-derived facts shown on cards for real (scanned) models.
  fileCount?: number;
  totalSize?: number;
  /** Real thumbnail (data URL or cached path) once rendered in Phase 3. */
  thumb?: string;
  /** A render/photo image from the model folder, used as the preview when present. */
  preview?: string;
  /** Persisted real mesh dims (mm); 0/undefined = unknown (use volume estimate). */
  dimW?: number;
  dimD?: number;
  dimH?: number;

  // Slim grid-payload fields (real/scanned models). The grid dataset omits the
  // heavy files/parts/extras/folder/desc; the detail view hydrates them on demand
  // (store.hydrateModel → get_model). These keep the card + type-faceting working
  // without the full files array.
  /** Distinct file extensions in the model (for client-side type facets). */
  fileTypes?: string[];
  /** Number of printable parts (card badge), without shipping the parts array. */
  partsCount?: number;
  /** True for real on-disk models — show the cached thumbnail, not a mock shape. */
  real?: boolean;
  /** User-set print status ("queued" = to print, "printed"); absent/"" = none. */
  printStatus?: PrintStatus;
  /** True when the model is one loose file on a shelf, not a folder of its own. */
  fileModel?: boolean;
  /** The folder this model was split out of by the user, if any (offer to regroup). */
  splitParent?: string;
  /** For a loose-file model: the same-named folder next to it, where it most
      likely belongs (pointed out on its page). */
  belongsTo?: string;
  /** True when the model holds a "(2)"-style copy of one of its own files. */
  duplicates?: boolean;
  /** True when one of the model's files is damaged (see ModelFile.damaged). */
  damaged?: boolean;
}

/* ── Quick Find launcher results (from the Rust quick_search command) ── */
export interface QuickFile {
  name: string;
  type: string;
  size: number;
  path: string;
  modelId: string;
  modelName: string;
  color: string;
  geometry: GeometryKey;
  thumb?: string;
  preview?: string;
}
export interface QuickFolder {
  id: string;
  name: string;
  color: string;
  geometry: GeometryKey;
  thumb?: string;
  preview?: string;
  folder: string;
  files: number;
  fileTypes: string[];
  tags: string[];
}
export interface QuickResults {
  files: QuickFile[];
  folders: QuickFolder[];
}

export interface SavedSearch {
  id: string;
  name: string;
  q: string;
  tags: string[];
  note: string;
}

export type LibStatus = "watching" | "idle" | "scanning" | "error";
export type LibSourceType = "local" | "smb" | "s3";

export interface Library {
  id: string;
  name: string;
  type: LibSourceType;
  path: string;
  models: number;
  files: number;
  status: LibStatus;
  last: string;
  /** internal: remembers the status to restore after a rescan. */
  _prev?: LibStatus;
  /** Indexed by an older scan version, so it needs one reindex to pick up the
      current naming/grouping/previews. Clears when the next full scan completes. */
  stale?: boolean;
}

export interface ScanOptions {
  organize: boolean;
  tags: boolean;
  thumbs: boolean;
  watch: boolean;
}

export interface DataStats {
  models: number;
  files: number;
  creators: number;
  collections: number;
  filament: number;
}

/** The shape every data source (mock today, Rust tomorrow) must provide. */
export interface Dataset {
  CREATORS: Creator[];
  COLLECTIONS: Collection[];
  MODELS: Model[];
  ALL_TAGS: string[];
  FILE_TYPES: FileType[];
  LICENSES: string[];
  SAVED_SEARCHES: SavedSearch[];
  stats: DataStats;
}

export interface Filters {
  tags: string[];
  types: string[];
  licenses: string[];
  supportFree: boolean;
  /** Print statuses to keep (any-of); empty = don't filter by status. */
  status: PrintStatus[];
  sort: "newest" | "popular" | "name" | "quick";
}

export const DEFAULT_FILTERS: Filters = {
  tags: [],
  types: [],
  licenses: [],
  supportFree: false,
  status: [],
  sort: "newest",
};

/* ── Route model (single object, like the prototype) ── */
export type Route =
  | { name: "library" }
  | { name: "search"; tag?: string; saved?: SavedSearch }
  | { name: "favorites" }
  | { name: "collections" }
  | { name: "collection"; id: string }
  | { name: "creators" }
  | { name: "creator"; id: string }
  | { name: "model"; id: string }
  | { name: "storage"; openAdd?: boolean }
  | { name: "settings" };

export type RouteName = Route["name"];
