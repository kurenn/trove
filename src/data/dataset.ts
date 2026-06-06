/* dataset.ts — pure helpers over the *active* dataset (held in the store).
   Components read the dataset reactively via useDataset(); helper functions read
   the current snapshot via the store, so they stay valid as data swaps. */

import { useApp } from "../lib/store";
import type { Dataset, Model, Filters, GeometryKey } from "./types";

/** Reactive hook — re-renders when the dataset changes (mock → Rust index). */
export const useDataset = (): Dataset => useApp((s) => s.data);

/** Non-reactive snapshot for use inside helpers / event handlers. */
const data = (): Dataset => useApp.getState().data;

export const creatorById = (id: string) => data().CREATORS.find((c) => c.id === id);
export const collectionById = (id: string) => data().COLLECTIONS.find((c) => c.id === id);
export const modelById = (id: string) => data().MODELS.find((m) => m.id === id);

export function similar(model: Model): Model[] {
  return data().MODELS.filter((m) => m.id !== model.id)
    .map((m) => ({
      m,
      score: m.tags.filter((t) => model.tags.includes(t)).length + (m.collection === model.collection ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.m);
}

// Slim grid models (from the real index) carry `real`/`partsCount`/`fileCount`
// instead of the full parts/files arrays; mock models carry the arrays. These
// resolve a card's facts from whichever is present.
export const isReal = (m: Model) => m.real ?? !!m.parts[0]?.files[0]?.path;
export const partCount = (m: Model) => m.partsCount ?? m.parts.length;
export const fileCount = (m: Model) => m.fileCount ?? m.files.length;

export function fmtSize(bytes: number): string {
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return Math.round(bytes / 1e3) + " KB";
  return bytes + " B";
}

/** "1 model" / "3 models" — correct pluralization for counts. */
export const nModels = (n: number) => `${n} model${n === 1 ? "" : "s"}`;

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function applyFilters(models: Model[], query: string, f: Filters): Model[] {
  const q = (query || "").trim().toLowerCase();
  let out = models.filter((m) => {
    if (q) {
      const cname = creatorById(m.creator)?.name ?? "";
      const hay = (m.name + " " + m.tags.join(" ") + " " + cname).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.tags.length && !f.tags.every((t) => m.tags.includes(t))) return false;
    // Slim grid models carry `fileTypes` (no full `files` array); mock carries files.
    const types = m.fileTypes ?? m.files.map((fl) => fl.type);
    if (f.types.length && !f.types.some((t) => types.includes(t))) return false;
    if (f.licenses.length && !f.licenses.includes(m.license)) return false;
    if (f.supportFree && m.supports) return false;
    return true;
  });
  const sorters: Record<Filters["sort"], (a: Model, b: Model) => number> = {
    newest: (a, b) => +new Date(b.added) - +new Date(a.added),
    popular: (a, b) => (b.makes ?? 0) - (a.makes ?? 0),
    name: (a, b) => a.name.localeCompare(b.name),
    quick: (a, b) => (a.filament ?? 0) - (b.filament ?? 0),
  };
  out = [...out].sort(sorters[f.sort] || sorters.newest);
  return out;
}

const DIM_ASPECT: Record<string, [number, number, number]> = {
  vase: [0.82, 0.82, 1.7], box: [1.55, 1.0, 0.62], flexi: [2.3, 0.5, 0.62],
  d20: [1, 1, 1], gear: [1.45, 1.45, 0.5], bracket: [1.15, 1.15, 0.7],
  figurine: [0.95, 0.95, 1.35], torusknot: [1.1, 1.1, 0.65],
};

export function modelDims(m: { volume?: number; geometry: GeometryKey; dimW?: number; dimD?: number; dimH?: number }) {
  // Prefer real persisted mesh dims; fall back to the volume estimate (mock).
  if (m.dimW || m.dimD || m.dimH) return { w: m.dimW ?? 0, d: m.dimD ?? 0, h: m.dimH ?? 0 };
  if (!m.volume) return { w: 0, d: 0, h: 0 };
  const base = Math.cbrt(m.volume) * 10; // mm
  const asp = DIM_ASPECT[m.geometry] || [1, 1, 1];
  const r = (x: number) => Math.round(base * x);
  return { w: r(asp[0]), d: r(asp[1]), h: r(asp[2]) };
}
