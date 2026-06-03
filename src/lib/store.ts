/* store.ts — global UI state + the active dataset (Zustand).
   The dataset lives here so it can be swapped from mock → Rust index at runtime. */

import { create } from "zustand";
import type { Route, Dataset, Library } from "../data/types";
import { MOCK_DATASET } from "../data/mock";
import { isTauri, api, loadConvert } from "./tauri";

export type Phase = "setup" | "app";

export interface TweakState {
  dark: boolean;
  accent: string;
}

interface AppState {
  phase: Phase;
  route: Route;
  query: string;
  fav: string[];
  sidebarOpen: boolean;
  searchOpen: boolean;
  toastMsg: string | null;
  tweaks: TweakState;
  /** User's display name (captured in onboarding, personalizes the app). */
  name: string;
  /** Quick Find global hotkey (Tauri accelerator). */
  quickfindShortcut: string;
  /** Version string of an available app update (from the updater), else null. */
  updateVersion: string | null;
  setUpdateVersion: (v: string | null) => void;

  /** Active dataset — mock by default, replaced by the Rust index under Tauri. */
  data: Dataset;
  libraries: Library[];
  loading: boolean;
  /** Generated/cached render thumbnails keyed by model id. Kept separate from the
      MODELS array so a single thumbnail completion only re-renders its own card. */
  thumbs: Record<string, string>;
  setThumb: (id: string, url: string) => void;

  setPhase: (p: Phase) => void;
  nav: (r: Route) => void;
  setQuery: (q: string) => void;
  toggleFav: (id: string) => void;
  setSidebarOpen: (v: boolean) => void;
  setSearchOpen: (v: boolean) => void;
  toast: (msg: string) => void;
  clearToast: () => void;
  toggleTheme: () => void;
  setAccent: (hex: string) => void;

  setData: (d: Dataset) => void;
  setLibraries: (l: Library[]) => void;
  applyScanProgress: (p: ScanProgress) => void;
  refresh: () => Promise<void>;

  /** Rename a creator (persisted under Tauri; survives rescans). */
  renameCreator: (id: string, name: string) => Promise<void>;
  /** Create a user-defined collection; returns its id (null on failure). */
  createCollection: (name: string) => Promise<string | null>;
  addToCollection: (collectionId: string, modelId: string) => Promise<void>;
  removeFromCollection: (collectionId: string, modelId: string) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;

  setName: (n: string) => void;
  setQuickfindShortcut: (acc: string) => void;
  /** Finish onboarding: persist the name + mark onboarded, enter the app. */
  completeOnboarding: (name: string) => void;
  /** Skip onboarding: mark onboarded (so it doesn't nag), enter the app. */
  skipOnboarding: () => void;
  /** Re-run the onboarding flow (from Settings). */
  replayOnboarding: () => void;
}

export interface ScanProgress {
  libId: string;
  models: number;
  files: number;
  done: boolean;
  cancelled: boolean;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Resolve a dataset's cached thumbnail + folder-image paths to asset URLs and
    seed the per-id thumb map (preserving runtime-generated renders). Shared by
    refresh and the mutating commands so all paths produce display-ready data. */
async function resolveAssets(data: Dataset, prevThumbs: Record<string, string>) {
  const conv = await loadConvert();
  data.MODELS = data.MODELS.map((m) => ({
    ...m,
    thumb: m.thumb ? conv(m.thumb) : undefined,
    preview: m.preview ? conv(m.preview) : undefined,
  }));
  const seeded: Record<string, string> = { ...prevThumbs };
  for (const m of data.MODELS) if (m.thumb) seeded[m.id] = m.thumb;
  return { data, seeded };
}

/** Browser-only: update a user collection's membership + count in place. */
function mutateMembers(d: Dataset, collectionId: string, fn: (ms: string[]) => string[]): Dataset {
  return {
    ...d,
    COLLECTIONS: d.COLLECTIONS.map((c) => {
      if (c.id !== collectionId) return c;
      const members = fn(c.members ?? []);
      return { ...c, members, count: members.length };
    }),
  };
}

const TWEAKS_KEY = "trove.tweaks";
function loadTweaks(): TweakState {
  try {
    const raw = localStorage.getItem(TWEAKS_KEY);
    if (raw) return { dark: false, accent: "#c2693d", ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { dark: false, accent: "#c2693d" };
}
function saveTweaks(t: TweakState) {
  try { localStorage.setItem(TWEAKS_KEY, JSON.stringify(t)); } catch { /* ignore */ }
}

const NAME_KEY = "trove.name";
const ONBOARDED_KEY = "trove.onboarded";
const SHORTCUT_KEY = "trove.shortcut";
export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";
const load = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export const useApp = create<AppState>((set, get) => ({
  // Show onboarding on genuine first run (no completion flag persisted yet).
  // VITE_FORCE_ONBOARDING=1 forces it on every boot (for testing the flow).
  phase: import.meta.env.VITE_FORCE_ONBOARDING === "1" || load(ONBOARDED_KEY) !== "1" ? "setup" : "app",
  route: { name: "library" },
  query: "",
  fav: MOCK_DATASET.MODELS.filter((m) => m.liked).map((m) => m.id),
  sidebarOpen: false,
  searchOpen: false,
  toastMsg: null,
  tweaks: loadTweaks(),
  name: load(NAME_KEY) || "",
  quickfindShortcut: load(SHORTCUT_KEY) || DEFAULT_SHORTCUT,
  updateVersion: null,

  data: MOCK_DATASET,
  libraries: [],
  loading: false,
  thumbs: {},

  setPhase: (phase) => set({ phase }),
  nav: (route) => set({ route, sidebarOpen: false }),
  setQuery: (query) => set({ query }),
  toggleFav: (id) =>
    set((s) => ({ fav: s.fav.includes(id) ? s.fav.filter((x) => x !== id) : [...s.fav, id] })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  toast: (toastMsg) => {
    set({ toastMsg });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toastMsg: null }), 2200);
  },
  clearToast: () => set({ toastMsg: null }),
  toggleTheme: () => set((s) => { const tweaks = { ...s.tweaks, dark: !s.tweaks.dark }; saveTweaks(tweaks); return { tweaks }; }),
  setAccent: (accent) => set((s) => { const tweaks = { ...s.tweaks, accent }; saveTweaks(tweaks); return { tweaks }; }),

  setData: (data) => set({ data }),
  setUpdateVersion: (updateVersion) => set({ updateVersion }),
  setLibraries: (libraries) => set({ libraries }),
  setThumb: (id, url) => set((s) => ({ thumbs: { ...s.thumbs, [id]: url } })),
  applyScanProgress: (p) =>
    set((s) => ({
      libraries: s.libraries.map((l) =>
        l.id === p.libId
          ? { ...l, status: p.done && !p.cancelled ? l.status : "scanning", models: p.models, files: p.files }
          : l
      ),
    })),
  refresh: async () => {
    if (!isTauri) return;
    set({ loading: true });
    try {
      const [raw, libraries] = await Promise.all([api.getDataset(), api.listLibraries()]);
      const { data, seeded } = await resolveAssets(raw, get().thumbs);
      set({ data, libraries, thumbs: seeded, fav: get().fav.filter((id) => data.MODELS.some((m) => m.id === id)) });
      // No automatic mesh loading here: the grid shows cached thumbnails or a
      // neutral placeholder. Real thumbnails are generated only when a model is
      // opened (Detail), so the catalog stays instant on huge/remote libraries.
    } catch (e) {
      console.error("refresh failed", e);
    } finally {
      set({ loading: false });
    }
  },

  // Apply a freshly-rebuilt dataset coming back from a mutating command (creator
  // rename, collection edits). Resolves asset URLs the same way refresh does.
  renameCreator: async (id, name) => {
    if (isTauri) {
      const raw = await api.renameCreator(id, name);
      const { data, seeded } = await resolveAssets(raw, get().thumbs);
      set({ data, thumbs: seeded });
    } else {
      const d = get().data;
      set({ data: { ...d, CREATORS: d.CREATORS.map((c) => (c.id === id ? { ...c, name } : c)) } });
    }
  },
  createCollection: async (name) => {
    const nm = name.trim();
    if (!nm) return null;
    if (isTauri) {
      const [id, raw] = await api.createCollection(nm);
      const { data, seeded } = await resolveAssets(raw, get().thumbs);
      set({ data, thumbs: seeded });
      return id;
    }
    const d = get().data;
    const id = "uc" + Date.now().toString(36);
    const coll = { id, name: nm, blurb: "", cover: "cube" as Dataset["COLLECTIONS"][number]["cover"], tone: "var(--accent)", count: 0, members: [] as string[] };
    set({ data: { ...d, COLLECTIONS: [...d.COLLECTIONS, coll] } });
    return id;
  },
  addToCollection: async (collectionId, modelId) => {
    if (isTauri) {
      const raw = await api.addToCollection(collectionId, modelId);
      const { data, seeded } = await resolveAssets(raw, get().thumbs);
      set({ data, thumbs: seeded });
    } else {
      set({ data: mutateMembers(get().data, collectionId, (ms) => (ms.includes(modelId) ? ms : [...ms, modelId])) });
    }
  },
  removeFromCollection: async (collectionId, modelId) => {
    if (isTauri) {
      const raw = await api.removeFromCollection(collectionId, modelId);
      const { data, seeded } = await resolveAssets(raw, get().thumbs);
      set({ data, thumbs: seeded });
    } else {
      set({ data: mutateMembers(get().data, collectionId, (ms) => ms.filter((x) => x !== modelId)) });
    }
  },
  deleteCollection: async (id) => {
    if (isTauri) {
      const raw = await api.deleteCollection(id);
      const { data, seeded } = await resolveAssets(raw, get().thumbs);
      set({ data, thumbs: seeded });
    } else {
      const d = get().data;
      set({ data: { ...d, COLLECTIONS: d.COLLECTIONS.filter((c) => c.id !== id) } });
    }
  },

  setName: (name) => { save(NAME_KEY, name); set({ name }); },
  setQuickfindShortcut: (acc) => {
    save(SHORTCUT_KEY, acc);
    set({ quickfindShortcut: acc });
    if (isTauri) api.setQuickfindShortcut(acc).catch((e) => console.error("set shortcut", e));
  },
  completeOnboarding: (name) => {
    save(NAME_KEY, name);
    save(ONBOARDED_KEY, "1");
    set({ name, phase: "app", route: { name: "library" } });
  },
  skipOnboarding: () => {
    save(ONBOARDED_KEY, "1");
    set({ phase: "app", route: { name: "library" } });
  },
  replayOnboarding: () => set({ phase: "setup" }),
}));

/** Luminance-based ink color for text on the accent (ported from prototype). */
export function inkFor(hex: string): string {
  const h = hex.replace("#", "");
  const x = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const r = parseInt(x.slice(0, 2), 16), g = parseInt(x.slice(2, 4), 16), b = parseInt(x.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#2c241c" : "#fff7f0";
}
