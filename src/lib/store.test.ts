import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Model } from "../data/types";

// Pretend we're under Tauri and stub the bridge: getModel returns a full record
// with a raw thumb path; loadConvert turns paths into asset URLs (as in the app);
// searchModelIds stubs the backend FTS search behind `setQuery`'s debounce.
const { getModel, searchModelIds } = vi.hoisted(() => ({ getModel: vi.fn(), searchModelIds: vi.fn() }));
vi.mock("./tauri", () => ({
  isTauri: true,
  api: { getModel, searchModelIds },
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

describe("setQuery — debounced backend search (searchIds)", () => {
  beforeEach(() => {
    searchModelIds.mockReset();
    useApp.setState({ query: "", searchIds: null });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a query under 3 chars skips the backend and clears searchIds to null (not [])", async () => {
    // Below the trigram FTS floor, the Rust command would return an EMPTY
    // array, not null — which applyFilters reads as "nothing matches" and
    // would wipe the grid. Must resolve to null (substring fallback) instead.
    useApp.getState().setQuery("v2");
    expect(useApp.getState().searchIds).toBeNull();
    await vi.runAllTimersAsync();
    expect(searchModelIds).not.toHaveBeenCalled();
  });

  it("debounces: rapid keystrokes fire only one backend call, for the LAST value", async () => {
    searchModelIds.mockResolvedValue(["a"]);
    useApp.getState().setQuery("b");
    useApp.getState().setQuery("ba");
    useApp.getState().setQuery("bat");
    await vi.runAllTimersAsync();
    expect(searchModelIds).toHaveBeenCalledTimes(1);
    expect(searchModelIds).toHaveBeenCalledWith("bat");
    expect(useApp.getState().searchIds).toEqual(["a"]);
  });

  it("clearing the query resets searchIds to null immediately, without a backend call", async () => {
    searchModelIds.mockResolvedValue(["a"]);
    useApp.getState().setQuery("bat");
    await vi.runAllTimersAsync();
    expect(useApp.getState().searchIds).toEqual(["a"]);

    searchModelIds.mockClear();
    useApp.getState().setQuery("");
    expect(useApp.getState().searchIds).toBeNull(); // synchronous — no debounce wait needed
    await vi.runAllTimersAsync();
    expect(searchModelIds).not.toHaveBeenCalled();
  });

  it("a slow response for an earlier query does not clobber a faster, newer response", async () => {
    let resolveBat!: (ids: string[]) => void;
    const batPromise = new Promise<string[]>((res) => { resolveBat = res; });
    searchModelIds.mockImplementation((q: string) => (q === "bat" ? batPromise : Promise.resolve(["batman-id"])));

    useApp.getState().setQuery("bat");
    await vi.advanceTimersByTimeAsync(200); // "bat"'s debounced request goes out, still pending

    useApp.getState().setQuery("batman");
    await vi.advanceTimersByTimeAsync(200); // "batman"'s debounced request goes out AND resolves first
    expect(useApp.getState().searchIds).toEqual(["batman-id"]);

    // "bat"'s slow response finally lands — must be ignored, not overwrite "batman"'s.
    resolveBat(["bat-id"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(useApp.getState().searchIds).toEqual(["batman-id"]);
  });
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
