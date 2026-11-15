import { describe, it, expect } from "vitest";
import { needsStepThumb } from "./thumbs";
import type { Model, GeometryKey } from "../data/types";

function model(over: Partial<Model> = {}): Model {
  return {
    id: "m", name: "Thing", creator: "", collection: "", geometry: "cube" as GeometryKey,
    color: "#fff", tags: [], files: [], license: "", source: "Local", sourceUrl: "",
    supports: false, added: "2026-01-01", liked: false, desc: "", folder: "",
    parts: [], extras: [], real: true,
    ...over,
  };
}

describe("needsStepThumb", () => {
  it("picks real, image-less models whose only mesh is STEP", () => {
    expect(needsStepThumb(model({ fileTypes: ["step"] }), {})).toBe(true);
    expect(needsStepThumb(model({ fileTypes: ["STP", "pdf"] }), {})).toBe(true);
  });
  it("leaves models that get a picture some other way", () => {
    expect(needsStepThumb(model({ fileTypes: ["step", "stl"] }), {})).toBe(false); // scanner renders the STL
    expect(needsStepThumb(model({ fileTypes: ["step", "3mf"] }), {})).toBe(false); // 3MF carries a thumbnail
    expect(needsStepThumb(model({ fileTypes: ["step"], preview: "/x.jpg" }), {})).toBe(false);
    expect(needsStepThumb(model({ fileTypes: ["step"], thumb: "/t.jpg" }), {})).toBe(false);
    expect(needsStepThumb(model({ fileTypes: ["step"] }), { m: "data:…" })).toBe(false); // rendered this session
    expect(needsStepThumb(model({ fileTypes: ["step"], real: false }), {})).toBe(false); // mock data
    expect(needsStepThumb(model({ fileTypes: ["blend"] }), {})).toBe(false);
  });
});
