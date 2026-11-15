import { describe, it, expect, beforeEach } from "vitest";
import { applyFilters, isReal, partCount, fileCount, librariesNeedingReindex, slicerFile, printStatusOf, slicerId, slicerButtonName, canSplit, folderName, cadFile, formatsOf, plateProject, plateLabel, versionFiles } from "./dataset";
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

describe("librariesNeedingReindex", () => {
  it("returns only stale libraries that aren't already scanning", () => {
    const libs = [
      library({ id: "old", stale: true, status: "idle" }),
      library({ id: "busy", stale: true, status: "scanning" }),
      library({ id: "fresh", stale: false, status: "watching" }),
      library({ id: "mock" }), // mock/browser rows carry no flag at all
    ];
    expect(librariesNeedingReindex(libs).map((l) => l.id)).toEqual(["old"]);
  });
});

describe("applyFilters — print status", () => {
  const models = [
    model({ id: "none" }), // no printStatus field at all, like a never-touched model
    model({ id: "empty", printStatus: "" }),
    model({ id: "todo", printStatus: "queued" }),
    model({ id: "done", printStatus: "printed" }),
  ];
  const ids = (f: Filters) => applyFilters(models, "", f).map((m) => m.id).sort();

  it("doesn't filter when no status is selected", () => {
    expect(ids(filters())).toEqual(["done", "empty", "none", "todo"]);
  });
  it("keeps only models with a selected status", () => {
    expect(ids(filters({ status: ["queued"] }))).toEqual(["todo"]);
    expect(ids(filters({ status: ["printed"] }))).toEqual(["done"]);
  });
  it("treats several selected statuses as any-of", () => {
    expect(ids(filters({ status: ["queued", "printed"] }))).toEqual(["done", "todo"]);
  });
  it("reads a missing status as none", () => {
    expect(printStatusOf(models[0])).toBe("");
  });
});

describe("slicerFile / cadFile", () => {
  const file = (name: string, onDisk = true) => ({ name, type: name.split(".").pop()!, size: 1, path: onDisk ? "/lib/" + name : undefined });

  it("picks the best format of the part in view: 3MF for the slicer, STEP for CAD", () => {
    const arm = [file("arm.stl"), file("arm.3mf"), file("arm.step")];
    const m = model({ files: [...arm, file("base.stl")] });
    expect(slicerFile(m, arm)?.name).toBe("arm.3mf");
    expect(cadFile(m, arm)?.name).toBe("arm.step");
  });
  it("uses the part's only format when that is all there is", () => {
    const base = [file("base.stl")];
    const m = model({ files: [file("project.3mf"), ...base] });
    expect(slicerFile(m, base)?.name).toBe("base.stl");
    expect(cadFile(m, base)?.name).toBe("base.stl");
  });
  it("falls back to the best file in the model when the part has nothing usable", () => {
    const m = model({ files: [file("a.stl"), file("notes.txt"), file("project.3MF"), file("design.sc")] });
    expect(slicerFile(m, [file("scene.blend")])?.name).toBe("project.3MF");
    expect(slicerFile(m)?.name).toBe("project.3MF");
    expect(cadFile(m)?.name).toBe("design.sc"); // a native design beats everything
  });
  it("returns nothing when no file is usable or on disk", () => {
    expect(slicerFile(model({ files: [file("scene.blend"), file("readme.pdf")] }))).toBeUndefined();
    // Mock/unhydrated files carry no path — there is nothing to hand over.
    expect(slicerFile(model({ files: [file("a.stl", false)] }))).toBeUndefined();
    expect(cadFile(model(), [file("a.step", false)])).toBeUndefined();
  });
});

describe("formatsOf", () => {
  it("lists a model's formats once each, source-like first, from slim or full data", () => {
    expect(formatsOf(model({ fileTypes: ["stl", "png", "step", "3mf", "STL"] }))).toEqual(["3mf", "step", "stl"]);
    const f = (type: string) => ({ name: "x." + type, type, size: 1 });
    expect(formatsOf(model({ files: [f("obj"), f("stl"), f("txt")] }))).toEqual(["stl", "obj"]);
    expect(formatsOf(model())).toEqual([]);
  });
});

describe("slicer choice", () => {
  it("falls back to Bambu Studio for an unset or unknown setting", () => {
    expect(slicerId(null)).toBe("bambu");
    expect(slicerId("")).toBe("bambu");
    expect(slicerId("cura")).toBe("bambu");
    expect(slicerId("orca")).toBe("orca");
    expect(slicerId("custom")).toBe("custom");
  });
  it("names the button after the app, or generically for a custom command", () => {
    expect(slicerButtonName("bambu")).toBe("Bambu Studio");
    expect(slicerButtonName("orca")).toBe("OrcaSlicer");
    expect(slicerButtonName("custom")).toBe("slicer");
  });
});

describe("folder grouping helpers", () => {
  it("offers a split only for real folder models with more than one file", () => {
    expect(canSplit(model({ real: true, fileCount: 12 }))).toBe(true);
    expect(canSplit(model({ real: true, fileCount: 1 }))).toBe(false); // nothing to split
    expect(canSplit(model({ real: true, fileCount: 2, fileModel: true }))).toBe(false); // one file + its image
    expect(canSplit(model({ fileCount: 12 }))).toBe(false); // mock/demo data
  });
  it("names a folder by its last path segment", () => {
    expect(folderName("/home/me/Prints/Mounts")).toBe("Mounts");
    expect(folderName("/home/me/Prints/Mounts/")).toBe("Mounts");
    expect(folderName("C:\\Prints\\Mounts")).toBe("Mounts");
  });
});

describe("plates", () => {
  const file = (name: string, onDisk = true) => ({ name, type: name.split(".").pop()!, size: 1, path: onDisk ? "/lib/" + name : undefined });
  it("lists the plates of the part's 3MF, else the model's first 3MF", () => {
    const m = model({ files: [file("a.stl"), file("all.3mf"), file("b.3MF")] });
    expect(plateProject(m, [file("arm.stl"), file("arm.3mf")])?.name).toBe("arm.3mf");
    expect(plateProject(m, [file("arm.stl")])?.name).toBe("all.3mf");
    expect(plateProject(model({ files: [file("a.stl")] }))).toBeUndefined();
    expect(plateProject(model({ files: [file("a.3mf", false)] }))).toBeUndefined(); // not on disk
  });
  it("labels an unnamed plate by its number", () => {
    expect(plateLabel({ index: 3, name: "  " })).toBe("Plate 3");
    expect(plateLabel({ index: 3, name: "03_hull" })).toBe("03_hull");
  });
});

describe("versionFiles", () => {
  const f = (name: string) => ({ name, type: "3mf", size: 1, path: "/lib/" + name });
  const part = { files: [f("stand_v4.3mf")], versions: [{ files: [f("stand_v4.3mf")] }, { files: [f("stand_v2.3mf")] }] };
  it("returns the chosen version's files, newest at index 0", () => {
    expect(versionFiles(part, 0)[0].name).toBe("stand_v4.3mf");
    expect(versionFiles(part, 1)[0].name).toBe("stand_v2.3mf");
  });
  it("falls back to the part's own files without versions or with a stale index", () => {
    expect(versionFiles({ files: [f("clip.3mf")] }, 2)[0].name).toBe("clip.3mf");
    expect(versionFiles(part, 9)[0].name).toBe("stand_v4.3mf");
  });
});
