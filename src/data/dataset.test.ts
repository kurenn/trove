import { describe, it, expect, beforeEach } from "vitest";
import { applyFilters, isReal, partCount, fileCount } from "./dataset";
import { useApp } from "../lib/store";
import { DEFAULT_FILTERS, type Filters, type Model, type GeometryKey } from "./types";

function model(over: Partial<Model> = {}): Model {
  return {
    id: "m", name: "Thing", creator: "voxel", collection: "", geometry: "vase" as GeometryKey,
    color: "#fff", tags: [], files: [], license: "MIT", source: "Local", sourceUrl: "",
    supports: false, added: "2026-01-01", liked: false, desc: "", folder: "",
    parts: [], extras: [], fileCount: 1, totalSize: 100,
    ...over,
  };
}
const filters = (over: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...over });

// applyFilters resolves the creator/collection *names* for search via the store; seed them.
beforeEach(() => {
  useApp.setState({
    data: {
      ...useApp.getState().data,
      CREATORS: [{ id: "voxel", name: "Studio Voxel", handle: "@voxel", models: 0, blurb: "", tone: "#000" }],
      COLLECTIONS: [{ id: "helmets", name: "Helmets", blurb: "", cover: "cube", tone: "#000", count: 0 }],
    },
  });
});

describe("applyFilters — search", () => {
  const models = [
    model({ id: "a", name: "Helix Vase", tags: ["decorative"] }),
    model({ id: "b", name: "Cable Tray", tags: ["functional", "desk"] }),
  ];

  it("returns everything for an empty query", () => {
    expect(applyFilters(models, "", filters()).map((m) => m.id).sort()).toEqual(["a", "b"]);
  });
  it("matches on name, case-insensitively", () => {
    expect(applyFilters(models, "helix", filters()).map((m) => m.id)).toEqual(["a"]);
  });
  it("matches on a tag", () => {
    expect(applyFilters(models, "desk", filters()).map((m) => m.id)).toEqual(["b"]);
  });
  it("matches query words in any order", () => {
    const m = [model({ id: "a", name: "Batman Helmet" })];
    expect(applyFilters(m, "helmet batman", filters()).map((x) => x.id)).toEqual(["a"]);
  });
  it("requires every query word to be present", () => {
    const m = [model({ id: "a", name: "Batman Helmet" })];
    expect(applyFilters(m, "batman spaceship", filters())).toEqual([]);
  });
  it("matches on the creator's display name", () => {
    expect(applyFilters(models, "studio voxel", filters()).map((m) => m.id).sort()).toEqual(["a", "b"]);
  });
});

describe("applyFilters — finds models by descriptive folder name", () => {
  it("matches an ancestor folder when the model name + files are generic", () => {
    const models = [
      model({ id: "a", name: "Stls", folder: "/lib/Marvel/Batman Helmet/STLs" }),
      model({ id: "b", name: "Parts", folder: "/lib/Marvel/Iron Man/parts" }),
    ];
    expect(applyFilters(models, "batman helmet", filters()).map((m) => m.id)).toEqual(["a"]);
  });

  it("treats _ and - in folder names as spaces", () => {
    const models = [model({ id: "a", name: "v2", folder: "/lib/props/Red_Hood-Helmet/v2" })];
    expect(applyFilters(models, "red hood helmet", filters()).map((m) => m.id)).toEqual(["a"]);
  });

  it("matches by collection name", () => {
    const models = [
      model({ id: "a", name: "generic", collection: "helmets" }),
      model({ id: "b", name: "other", collection: "" }),
    ];
    expect(applyFilters(models, "helmets", filters()).map((m) => m.id)).toEqual(["a"]);
  });
});

describe("applyFilters — facets", () => {
  it("requires ALL selected tags (AND semantics)", () => {
    const models = [
      model({ id: "a", tags: ["functional", "desk"] }),
      model({ id: "b", tags: ["functional"] }),
    ];
    expect(applyFilters(models, "", filters({ tags: ["functional", "desk"] })).map((m) => m.id)).toEqual(["a"]);
  });

  it("filters by file type using slim `fileTypes`", () => {
    const models = [
      model({ id: "a", fileTypes: ["stl", "3mf"] }),
      model({ id: "b", fileTypes: ["step"] }),
    ];
    expect(applyFilters(models, "", filters({ types: ["stl"] })).map((m) => m.id)).toEqual(["a"]);
  });

  it("falls back to the full `files` array (mock models) for the type facet", () => {
    const models = [
      model({ id: "a", fileTypes: undefined, files: [{ name: "x.stl", type: "stl", size: 1 }] }),
      model({ id: "b", fileTypes: undefined, files: [{ name: "y.step", type: "step", size: 1 }] }),
    ];
    expect(applyFilters(models, "", filters({ types: ["stl"] })).map((m) => m.id)).toEqual(["a"]);
  });

  it("filters by license", () => {
    const models = [model({ id: "a", license: "MIT" }), model({ id: "b", license: "CC-BY 4.0" })];
    expect(applyFilters(models, "", filters({ licenses: ["MIT"] })).map((m) => m.id)).toEqual(["a"]);
  });

  it("supportFree excludes models that need supports", () => {
    const models = [model({ id: "a", supports: false }), model({ id: "b", supports: true })];
    expect(applyFilters(models, "", filters({ supportFree: true })).map((m) => m.id)).toEqual(["a"]);
  });
});

describe("applyFilters — sort", () => {
  it("orders by name when sort = name", () => {
    const models = [model({ id: "z", name: "Zed" }), model({ id: "a", name: "Apple" })];
    expect(applyFilters(models, "", filters({ sort: "name" })).map((m) => m.name)).toEqual(["Apple", "Zed"]);
  });
  it("orders newest-first by default", () => {
    const models = [
      model({ id: "old", added: "2026-01-01" }),
      model({ id: "new", added: "2026-06-01" }),
    ];
    expect(applyFilters(models, "", filters()).map((m) => m.id)).toEqual(["new", "old"]);
  });
});

describe("slim-payload fallbacks", () => {
  it("isReal trusts the slim `real` flag, else infers from a part path", () => {
    expect(isReal(model({ real: true }))).toBe(true);
    expect(isReal(model({ real: false }))).toBe(false);
    expect(isReal(model({ parts: [{ id: "p", name: "p", geometry: "vase", color: "#000", files: [{ name: "a.stl", type: "stl", size: 1, path: "/x.stl" }] }] }))).toBe(true);
    expect(isReal(model({ parts: [] }))).toBe(false); // mock with no path → procedural
  });
  it("partCount/fileCount prefer the slim scalars over the arrays", () => {
    expect(partCount(model({ partsCount: 3, parts: [] }))).toBe(3);
    expect(partCount(model({ partsCount: undefined, parts: [{ id: "p", name: "p", geometry: "vase", color: "#000", files: [] }] }))).toBe(1);
    expect(fileCount(model({ fileCount: 5, files: [] }))).toBe(5);
    expect(fileCount(model({ fileCount: undefined, files: [{ name: "a", type: "stl", size: 1 }] }))).toBe(1);
  });
});
