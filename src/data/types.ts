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
}

export interface Part {
  id: string;
  name: string;
  geometry: GeometryKey;
  color: string;
  files: ModelFile[];
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
  sort: "newest" | "popular" | "name" | "quick";
}

export const DEFAULT_FILTERS: Filters = {
  tags: [],
  types: [],
  licenses: [],
  supportFree: false,
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
