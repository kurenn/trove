/* mock.ts — typed port of the prototype's spool-data.js.
   Builds the same dataset (models → parts/extras, creators, collections, tags)
   used by Phase 1's UI. In Phase 2 this is swapped for the Rust-backed index. */

import type {
  Creator, Collection, Model, ModelFile, Part, SavedSearch,
  Dataset, FileType, GeometryKey,
} from "./types";

const CREATORS: Creator[] = [
  { id: "voxel",   name: "Studio Voxel",    handle: "@voxel",      models: 0, blurb: "Low-poly desk companions & abstract art objects.", tone: "#c2693d" },
  { id: "forge",   name: "ForgeWorks",      handle: "@forgeworks", models: 0, blurb: "Functional, support-free engineering parts.",      tone: "#5b8a72" },
  { id: "tinker",  name: "Tabletop Tinker", handle: "@tinker",     models: 0, blurb: "Miniatures, terrain & dice for game night.",        tone: "#9a6cc4" },
  { id: "hearth",  name: "Hearth & Home",   handle: "@hearth",     models: 0, blurb: "Cozy homeware, planters & organizers.",             tone: "#cf9248" },
  { id: "greeble", name: "Greeble Labs",    handle: "@greeble",    models: 0, blurb: "Articulated toys & fidget mechanisms.",            tone: "#4f86b3" },
];

const COLLECTIONS: Collection[] = [
  { id: "tabletop",   name: "Tabletop & Terrain", blurb: "Minis, dice and modular scenery.",   cover: "d20",   tone: "#9a6cc4" },
  { id: "desk",       name: "Desk Organizers",    blurb: "Trays, risers and cable wrangling.", cover: "box",   tone: "#cf9248" },
  { id: "articulated",name: "Articulated Toys",   blurb: "Print-in-place flexi friends.",      cover: "flexi", tone: "#4f86b3" },
  { id: "home",       name: "Home & Garden",      blurb: "Planters, vases and hooks.",         cover: "vase",  tone: "#5b8a72" },
  { id: "functional", name: "Functional Prints",  blurb: "Brackets, gears and jigs that work.",cover: "gear",  tone: "#c2693d" },
];

const f = (name: string, type: string, size: number): ModelFile => ({ name, type, size });

type RawModel = Omit<Model, "folder" | "parts" | "extras">;

const MODELS_RAW: RawModel[] = [
  { id: "m1", name: "Helix Vase (Spiralized)", creator: "hearth", collection: "home", geometry: "vase", color: "#d98a4a",
    tags: ["vase-mode", "support-free", "decorative", "PLA"],
    files: [f("helix_vase.3mf", "3mf", 4.2e6), f("helix_vase.stl", "stl", 8.1e6)],
    license: "CC-BY 4.0", source: "Printables", sourceUrl: "printables.com/model/helix-vase",
    volume: 142, filament: 48, printTime: "5h 12m", supports: false, layerHeight: 0.2, nozzle: 0.4,
    added: "2026-05-28", makes: 23, liked: true,
    desc: "A single-wall spiralized vase with a gentle helical twist. Prints support-free in vase mode." },
  { id: "m2", name: "Parametric Cable Tray", creator: "hearth", collection: "desk", geometry: "box", color: "#cf9248",
    tags: ["functional", "support-free", "desk", "PETG"],
    files: [f("cable_tray.3mf", "3mf", 2.1e6), f("cable_tray.step", "step", 1.4e6)],
    license: "CC-BY-SA", source: "Local", sourceUrl: "",
    volume: 96, filament: 31, printTime: "3h 02m", supports: false, layerHeight: 0.24, nozzle: 0.4,
    added: "2026-05-27", makes: 11, liked: false,
    desc: "Snap-mount tray that clips under a desk to hide cables. Editable STEP source included." },
  { id: "m3", name: "Articulated Koi Fish", creator: "greeble", collection: "articulated", geometry: "flexi", color: "#e0703a",
    tags: ["articulated", "print-in-place", "fidget", "support-free", "toy"],
    files: [f("koi_flexi.3mf", "3mf", 6.7e6), f("koi_flexi.stl", "stl", 12.3e6)],
    license: "CC-BY-NC", source: "MakerWorld", sourceUrl: "makerworld.com/koi",
    volume: 58, filament: 19, printTime: "2h 44m", supports: false, layerHeight: 0.2, nozzle: 0.4,
    added: "2026-05-26", makes: 87, liked: true,
    desc: "Print-in-place flexi koi with 14 articulated segments. No supports, no assembly." },
  { id: "m4", name: "Hex Dice Set (d20 + d6)", creator: "tinker", collection: "tabletop", geometry: "d20", color: "#9a6cc4",
    tags: ["miniature", "dice", "tabletop", "multi-part", "resin"],
    files: [f("d20.stl", "stl", 3.3e6), f("d6.stl", "stl", 1.1e6), f("dice.3mf", "3mf", 4.9e6)],
    license: "CC-BY 4.0", source: "Thingiverse", sourceUrl: "thingiverse.com/dice",
    volume: 22, filament: 7, printTime: "1h 18m", supports: true, layerHeight: 0.05, nozzle: 0.4,
    added: "2026-05-25", makes: 41, liked: false,
    desc: "Sharp-edged polyhedral dice with deep numerals. Tuned for resin; supports included." },
  { id: "m5", name: "Planetary Gear Fidget", creator: "greeble", collection: "functional", geometry: "gear", color: "#4f86b3",
    tags: ["functional", "fidget", "print-in-place", "multi-part", "PLA"],
    files: [f("planetary.3mf", "3mf", 5.1e6), f("planetary.stl", "stl", 9.0e6)],
    license: "GPL", source: "Local", sourceUrl: "",
    volume: 74, filament: 25, printTime: "3h 50m", supports: false, layerHeight: 0.16, nozzle: 0.4,
    added: "2026-05-24", makes: 64, liked: true,
    desc: "A satisfying planetary gear set that spins straight off the bed. Tight tolerances; calibrate first." },
  { id: "m6", name: "Low-Poly Fox", creator: "voxel", collection: "tabletop", geometry: "figurine", color: "#c2693d",
    tags: ["low-poly", "decorative", "miniature", "support-free"],
    files: [f("lowpoly_fox.stl", "stl", 2.8e6)],
    license: "CC-BY 4.0", source: "Printables", sourceUrl: "printables.com/fox",
    volume: 39, filament: 13, printTime: "2h 05m", supports: false, layerHeight: 0.2, nozzle: 0.4,
    added: "2026-05-23", makes: 33, liked: false,
    desc: "Faceted low-poly fox that prints flat-faced and support-free. Great in a single color." },
  { id: "m7", name: "Modular Wall Bracket", creator: "forge", collection: "functional", geometry: "bracket", color: "#5b8a72",
    tags: ["functional", "support-free", "hardware", "PETG"],
    files: [f("bracket.step", "step", 0.9e6), f("bracket.3mf", "3mf", 1.7e6)],
    license: "CC0", source: "Local", sourceUrl: "",
    volume: 51, filament: 17, printTime: "2h 20m", supports: false, layerHeight: 0.28, nozzle: 0.6,
    added: "2026-05-22", makes: 8, liked: false,
    desc: "Load-bearing L-bracket with a gusset. Parametric STEP lets you resize the mounting holes." },
  { id: "m8", name: "Twisted Pen Pot", creator: "hearth", collection: "desk", geometry: "vase", color: "#cf9248",
    tags: ["vase-mode", "desk", "decorative", "support-free"],
    files: [f("pen_pot.3mf", "3mf", 2.0e6)],
    license: "CC-BY 4.0", source: "MakerWorld", sourceUrl: "makerworld.com/penpot",
    volume: 88, filament: 29, printTime: "2h 58m", supports: false, layerHeight: 0.3, nozzle: 0.4,
    added: "2026-05-21", makes: 19, liked: true,
    desc: "Faceted twisting pen pot. Vase-mode friendly and quick to print." },
  { id: "m9", name: "Mecha Greeble Panel", creator: "voxel", collection: "tabletop", geometry: "torusknot", color: "#c2693d",
    tags: ["decorative", "kitbash", "multi-part", "PLA"],
    files: [f("greeble_panel.stl", "stl", 5.5e6), f("greeble_panel.3mf", "3mf", 7.2e6)],
    license: "CC-BY-NC", source: "Thingiverse", sourceUrl: "thingiverse.com/greeble",
    volume: 63, filament: 21, printTime: "3h 31m", supports: true, layerHeight: 0.12, nozzle: 0.4,
    added: "2026-05-20", makes: 14, liked: false,
    desc: "Sci-fi detail panel for kitbashing. Tile it across a surface for instant texture." },
  { id: "m10", name: "Succulent Planter Trio", creator: "hearth", collection: "home", geometry: "vase", color: "#5b8a72",
    tags: ["home", "garden", "decorative", "support-free", "multi-part"],
    files: [f("planter_s.3mf", "3mf", 1.6e6), f("planter_m.3mf", "3mf", 2.0e6), f("planter_l.3mf", "3mf", 2.4e6)],
    license: "CC-BY 4.0", source: "Printables", sourceUrl: "printables.com/planter",
    volume: 120, filament: 40, printTime: "4h 40m", supports: false, layerHeight: 0.2, nozzle: 0.4,
    added: "2026-05-19", makes: 52, liked: true,
    desc: "Three nesting faceted planters with drainage. Looks great as a windowsill set." },
  { id: "m11", name: "Print-in-Place Dragon", creator: "greeble", collection: "articulated", geometry: "flexi", color: "#9a6cc4",
    tags: ["articulated", "print-in-place", "toy", "support-free", "popular"],
    files: [f("flexi_dragon.3mf", "3mf", 8.9e6), f("flexi_dragon.stl", "stl", 15.1e6)],
    license: "CC-BY-NC", source: "MakerWorld", sourceUrl: "makerworld.com/dragon",
    volume: 71, filament: 24, printTime: "3h 18m", supports: false, layerHeight: 0.2, nozzle: 0.4,
    added: "2026-05-18", makes: 203, liked: true,
    desc: "The classic articulated dragon, retuned for cleaner joints. Prints in one piece." },
  { id: "m12", name: "Honeycomb Wall Shelf", creator: "forge", collection: "home", geometry: "box", color: "#cf9248",
    tags: ["home", "functional", "support-free", "PETG", "modular"],
    files: [f("hex_shelf.3mf", "3mf", 3.0e6), f("hex_shelf.step", "step", 1.2e6)],
    license: "CC-BY-SA", source: "Local", sourceUrl: "",
    volume: 110, filament: 37, printTime: "4h 10m", supports: false, layerHeight: 0.24, nozzle: 0.4,
    added: "2026-05-17", makes: 16, liked: false,
    desc: "Hexagonal modular shelf that tiles into a honeycomb. Keyhole mounts on the back." },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const MULTI: Record<string, { name: string; geometry: GeometryKey }[]> = {
  m4: [{ name: "d20", geometry: "d20" }, { name: "d6", geometry: "cube" }, { name: "d10", geometry: "cube" }, { name: "d4", geometry: "cube" }],
  m5: [{ name: "Sun gear", geometry: "gear" }, { name: "Planet gear ×3", geometry: "gear" }, { name: "Ring carrier", geometry: "torusknot" }],
  m9: [{ name: "Panel base", geometry: "torusknot" }, { name: "Greeble set A", geometry: "gear" }, { name: "Greeble set B", geometry: "bracket" }],
  m10: [{ name: "Planter — small", geometry: "vase" }, { name: "Planter — medium", geometry: "vase" }, { name: "Planter — large", geometry: "vase" }],
  m12: [{ name: "Hex cell", geometry: "box" }, { name: "Wall mount", geometry: "bracket" }],
};

function creatorById(id: string) {
  return CREATORS.find((c) => c.id === id)!;
}

const MODELS: Model[] = MODELS_RAW.map((raw) => {
  const folder = "/srv/3d-models/" + slug(creatorById(raw.creator).name) + "/" + slug(raw.name);
  const multi = MULTI[raw.id];
  let parts: Part[];
  let extras: ModelFile[];
  let files = raw.files;
  if (multi) {
    const baseType = raw.files[0] ? raw.files[0].type : "stl";
    parts = multi.map((p, i) => ({
      id: raw.id + "-p" + i,
      name: p.name,
      geometry: p.geometry,
      color: raw.color,
      files: [f(slug(p.name) + "." + baseType, baseType, 1.2e6 + i * 0.6e6)],
    }));
    extras = raw.files.filter((fl) => fl.type === "3mf" || fl.type === "step").slice(0, 1);
    files = [...parts.flatMap((p) => p.files), ...extras];
  } else {
    parts = [{ id: raw.id + "-p0", name: raw.name, geometry: raw.geometry, color: raw.color, files: raw.files }];
    extras = [];
  }
  return { ...raw, folder, parts, extras, files };
});

CREATORS.forEach((c) => { c.models = MODELS.filter((m) => m.creator === c.id).length; });
COLLECTIONS.forEach((c) => { c.count = MODELS.filter((m) => m.collection === c.id).length; });

const ALL_TAGS = [...new Set(MODELS.flatMap((m) => m.tags))].sort();
const FILE_TYPES: FileType[] = ["3mf", "stl", "step", "obj", "gcode"];
const LICENSES = [...new Set(MODELS.map((m) => m.license))];

const SAVED_SEARCHES: SavedSearch[] = [
  { id: "s1", name: "Support-free & quick", q: "", tags: ["support-free"], note: "under 3h" },
  { id: "s2", name: "Print-in-place toys", q: "", tags: ["print-in-place"], note: "" },
  { id: "s3", name: "Editable STEP source", q: "step", tags: [], note: "" },
];

export const MOCK_DATASET: Dataset = {
  CREATORS, COLLECTIONS, MODELS, ALL_TAGS, FILE_TYPES, LICENSES, SAVED_SEARCHES,
  stats: {
    models: MODELS.length,
    files: MODELS.reduce((n, m) => n + m.files.length, 0),
    creators: CREATORS.length,
    collections: COLLECTIONS.length,
    filament: MODELS.reduce((n, m) => n + (m.filament ?? 0), 0),
  },
};
