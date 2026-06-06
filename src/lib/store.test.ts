import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Model } from "../data/types";

// Pretend we're under Tauri and stub the bridge: getModel returns a full record
// with a raw thumb path; loadConvert turns paths into asset URLs (as in the app).
const { getModel } = vi.hoisted(() => ({ getModel: vi.fn() }));
vi.mock("./tauri", () => ({
  isTauri: true,
  api: { getModel },
  loadConvert: async () => (p: string) => "asset://" + p,
}));

import { useApp } from "./store";

const fullModel = (id: string): Model => ({
  id, name: "Dice Set", creator: "voxel", collection: "", geometry: "d20",
  color: "#fff", tags: ["dice"], files: [{ name: "d20.stl", type: "stl", size: 1, path: "/lib/d20.stl" }],
  license: "MIT", source: "Local", sourceUrl: "", supports: false, added: "2026-01-01",
  liked: false, desc: "Sharp dice", folder: "/lib/dice", parts: [], extras: [],
  fileCount: 2, totalSize: 200, thumb: "/cache/dice.jpg",
});

beforeEach(() => {
  getModel.mockReset();
  useApp.setState({ details: {} });
});

describe("hydrateModel", () => {
  it("fetches the full model and resolves its thumbnail to an asset URL", async () => {
    getModel.mockResolvedValueOnce(fullModel("d"));
    await useApp.getState().hydrateModel("d");

    const cached = useApp.getState().details["d"];
    expect(getModel).toHaveBeenCalledWith("d");
    expect(cached?.folder).toBe("/lib/dice");      // heavy field hydrated
    expect(cached?.files).toHaveLength(1);
    expect(cached?.thumb).toBe("asset:///cache/dice.jpg"); // converted, not raw
  });

  it("is a no-op (no second fetch) when the model is already cached", async () => {
    getModel.mockResolvedValue(fullModel("d"));
    await useApp.getState().hydrateModel("d");
    await useApp.getState().hydrateModel("d");
    expect(getModel).toHaveBeenCalledTimes(1);
  });

  it("does not throw or cache when the backend returns nothing", async () => {
    getModel.mockResolvedValueOnce(null);
    await useApp.getState().hydrateModel("ghost");
    expect(useApp.getState().details["ghost"]).toBeUndefined();
  });
});
