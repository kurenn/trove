/* tauri.ts — thin bridge to the Rust backend. In a plain browser (dev/preview
   without Tauri) isTauri is false and callers fall back to mock data. */

import type { Dataset, Library, ScanOptions, QuickResults } from "../data/types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let _invoke: InvokeFn | null = null;
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!_invoke) {
    const api = await import("@tauri-apps/api/core");
    _invoke = api.invoke as InvokeFn;
  }
  return _invoke<T>(cmd, args);
}

export const api = {
  getDataset: () => invoke<Dataset>("get_dataset"),
  /** Rename a creator (persisted; survives rescans). Returns the rebuilt dataset. */
  renameCreator: (id: string, name: string) => invoke<Dataset>("rename_creator", { id, name }),
  /** Create a user collection. Returns [newId, dataset]. */
  createCollection: (name: string) => invoke<[string, Dataset]>("create_collection", { name }),
  renameCollection: (id: string, name: string) => invoke<Dataset>("rename_collection", { id, name }),
  addToCollection: (collectionId: string, modelId: string) =>
    invoke<Dataset>("add_to_collection", { collectionId, modelId }),
  removeFromCollection: (collectionId: string, modelId: string) =>
    invoke<Dataset>("remove_from_collection", { collectionId, modelId }),
  deleteCollection: (id: string) => invoke<Dataset>("delete_collection", { id }),
  listLibraries: () => invoke<Library[]>("list_libraries"),
  addLibrary: (path: string, name: string | null, options: ScanOptions) =>
    invoke<Library[]>("add_library", { path, name, options }),
  rescanLibrary: (id: string) => invoke<Library[]>("rescan_library", { id }),
  cancelScan: (id: string) => invoke<void>("cancel_scan", { id }),
  ejectLibrary: (id: string) => invoke<Library[]>("eject_library", { id }),
  setWatch: (id: string, on: boolean) => invoke<Library[]>("set_watch", { id, on }),
  rescanLibraryForce: (id: string) => invoke<Library[]>("rescan_library", { id, force: true }),
  /** Persist a model's rendered thumbnail (PNG data URL) + real dims → cache path. */
  saveThumb: (modelId: string, dataUrl: string, dim?: { w: number; d: number; h: number }) =>
    invoke<string>("save_thumb", { modelId, dataUrl, dimW: dim?.w ?? 0, dimD: dim?.d ?? 0, dimH: dim?.h ?? 0 }),
  /** Quick Find: backend FTS search over files + folders. */
  quickSearch: (query: string) => invoke<QuickResults>("quick_search", { query }),
  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),
  getQuickfindShortcut: () => invoke<string>("get_quickfind_shortcut"),
  setQuickfindShortcut: (accelerator: string) => invoke<void>("set_quickfind_shortcut", { accelerator }),
  hideLauncher: () => invoke<void>("hide_launcher"),
  focusMain: () => invoke<void>("focus_main"),
};

/** Load Tauri's convertFileSrc (asset protocol) once; sync thereafter. */
let _convert: ((p: string) => string) | null = null;
export async function loadConvert(): Promise<(p: string) => string> {
  if (!isTauri) return (p) => p;
  if (!_convert) {
    const api = await import("@tauri-apps/api/core");
    _convert = api.convertFileSrc;
  }
  return _convert;
}

/** Resolve an absolute file path to a URL the webview can fetch.
   Under Tauri this is the asset protocol; in the browser the path is assumed to
   already be a fetchable URL (used by dev mesh tests). */
export async function assetUrl(path: string): Promise<string> {
  const conv = await loadConvert();
  return conv(path);
}

/** Native folder picker (Tauri dialog plugin). Returns the chosen path or null. */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ directory: true, multiple: false, title: "Choose a folder to index" });
  return typeof res === "string" ? res : null;
}

/** Open a file with the OS default app (e.g. hand a model off to a slicer). */
export async function openPath(path: string): Promise<boolean> {
  if (!isTauri) return false;
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
  return true;
}

/** Reveal a file/folder in the OS file manager (Finder/Explorer). */
export async function revealInManager(path: string): Promise<boolean> {
  if (!isTauri) return false;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
  return true;
}

/** Copy text to the clipboard (works in webview and browser). */
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
