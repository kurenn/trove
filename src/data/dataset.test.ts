import { describe, it, expect, beforeEach } from "vitest";
import { applyFilters, isReal, partCount, fileCount } from "./dataset";
import { useApp } from "../lib/store";
import { DEFAULT_FILTERS, type Filters, type Model, type GeometryKey, type Library } from "./types";

function library(over: Partial<Library> = {}): Library {
  return { id: "l1", name: "Lib", type: "local", path: "/tmp/x", models: 0, files: 0, status: "watching", last: "", ...over };
}

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
// `libraries` resets to [] each test — the library-root-stripping tests below opt in.
beforeEach(() => {
  useApp.setState({
    data: {
      ...useApp.getState().data,
      CREATORS: [{ id: "voxel", name: "Studio Voxel", handle: "@voxel", models: 0, blurb: "", tone: "#000" }],
      COLLECTIONS: [{ id: "helmets", name: "Helmets", blurb: "", cover: "cube", tone: "#000", count: 0 }],
    },
    libraries: [],
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

  it("matches a file name (mock/full-`files` datasets)", () => {
    const m = [model({ id: "a", name: "Generic Prop", files: [{ name: "visor.stl", type: "stl", size: 1 }] })];
    expect(applyFilters(m, "visor", filters()).map((x) => x.id)).toEqual(["a"]);
  });

  it("matches file-name words in any order alongside the name", () => {
    const m = [model({ id: "a", name: "Prop", files: [{ name: "battle_visor.blend", type: "blend", size: 1 }] })];
    expect(applyFilters(m, "visor prop", filters()).map((x) => x.id)).toEqual(["a"]);
  });

  it("a slim model with no `files` array does not crash and finds nothing by filename", () => {
    const m = [model({ id: "a", name: "Generic Prop", files: undefined as unknown as [] })];
    expect(() => applyFilters(m, "visor", filters())).not.toThrow();
    expect(applyFilters(m, "visor", filters())).toEqual([]);
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

  it("matches a Windows (backslash) folder path the same way", () => {
    const models = [model({ id: "a", name: "v2", folder: "C:\\lib\\props\\Red_Hood-Helmet\\v2" })];
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

describe("applyFilters — strips the library root from the folder haystack", () => {
  it("a word that appears only in the library's mount path no longer matches", () => {
    useApp.setState({ libraries: [library({ path: "/tmp/x/scratchpad/trove-lib" })] });
    const models = [model({ id: "a", name: "Widget", folder: "/tmp/x/scratchpad/trove-lib/Marvel/Widget" })];
    // "scratchpad" and "trove" only occur in the library root, not the model's own path.
    expect(applyFilters(models, "scratchpad", filters())).toEqual([]);
    expect(applyFilters(models, "trove", filters())).toEqual([]);
  });

  it("still finds a model by a descriptive ancestor folder once the root is stripped", () => {
    useApp.setState({ libraries: [library({ path: "/tmp/x/scratchpad/trove-lib" })] });
    const models = [
      model({ id: "a", name: "Stls", folder: "/tmp/x/scratchpad/trove-lib/Marvel/Batman Helmet/STLs" }),
      model({ id: "b", name: "Parts", folder: "/tmp/x/scratchpad/trove-lib/Marvel/Iron Man/parts" }),
    ];
    expect(applyFilters(models, "batman helmet", filters()).map((m) => m.id)).toEqual(["a"]);
  });

  it("falls back to the raw folder (no crash) when the model's library is unknown", () => {
    useApp.setState({ libraries: [library({ id: "other", path: "/tmp/x/some-other-lib" })] });
    const models = [model({ id: "a", name: "Stls", folder: "/lib/Marvel/Batman Helmet/STLs" })];
    expect(() => applyFilters(models, "batman helmet", filters())).not.toThrow();
    expect(applyFilters(models, "batman helmet", filters()).map((m) => m.id)).toEqual(["a"]);
  });
});

describe("applyFilters — backend search (searchIds)", () => {
  const models = [
    model({ id: "a", name: "Batman Helmet", added: "2026-01-01" }),
    model({ id: "b", name: "Generic Prop", added: "2026-06-01" }), // matched only via searchIds (e.g. a filename hit)
    model({ id: "c", name: "Iron Man Helmet", added: "2026-03-01" }),
  ];

  it("restricts to the given ids instead of the substring haystack", () => {
    // "b" has no textual match at all — only reachable through searchIds, as a
    // real (slim) model found by a filename the client can't see.
    expect(applyFilters(models, "prop", filters(), ["b"]).map((m) => m.id)).toEqual(["b"]);
  });

  it("still applies the other facet filters (tags/types/license/supportFree) on top of searchIds", () => {
    const withTag = [
      model({ id: "a", name: "Batman Helmet", tags: ["cosplay"] }),
      model({ id: "b", name: "Batman Visor", tags: ["functional"] }),
    ];
    expect(applyFilters(withTag, "batman", filters({ tags: ["cosplay"] }), ["a", "b"]).map((m) => m.id)).toEqual(["a"]);
  });

  it("null keeps today's exact substring behavior (no regression for mock/browser)", () => {
    const m = [model({ id: "a", name: "Batman Helmet" })];
    expect(applyFilters(m, "batman", filters(), null)).toEqual(applyFilters(m, "batman", filters()));
    expect(applyFilters(m, "batman", filters(), null).map((x) => x.id)).toEqual(["a"]);
  });

  it("omitting the argument entirely also keeps substring behavior", () => {
    const m = [model({ id: "a", name: "Batman Helmet" })];
    expect(applyFilters(m, "batman", filters()).map((x) => x.id)).toEqual(["a"]);
  });

  it("with the default sort, orders by searchIds' relevance rank rather than newest-first", () => {
    // "c" (added last) ranks WORSE than "a" here — relevance rank must win over
    // the newest-first default so the backend's best match shows first.
    expect(applyFilters(models, "helmet", filters(), ["a", "c"]).map((m) => m.id)).toEqual(["a", "c"]);
  });

  it("an explicit sort choice still overrides relevance order", () => {
    expect(applyFilters(models, "helmet", filters({ sort: "name" }), ["c", "a"]).map((m) => m.id)).toEqual(["a", "c"]);
  });

  it("an empty query ignores searchIds and returns everything", () => {
    expect(applyFilters(models, "", filters(), ["a"]).map((m) => m.id).sort()).toEqual(["a", "b", "c"]);
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
