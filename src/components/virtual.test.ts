import { describe, it, expect } from "vitest";
import { columnsFor, computeWindow } from "./virtual";

describe("columnsFor", () => {
  it("fits as many columns as the width allows", () => {
    // (1000 + 18) / (240 + 18) = 3.9 → 3 columns
    expect(columnsFor(1000, 240, 18)).toBe(3);
  });
  it("never returns fewer than one column", () => {
    expect(columnsFor(50, 240, 18)).toBe(1);
    expect(columnsFor(0, 240, 18)).toBe(1);
  });
  it("forces a single column for the list view's huge minCol", () => {
    expect(columnsFor(1400, 100000, 8)).toBe(1);
  });
});

describe("computeWindow", () => {
  const base = { itemCount: 1000, cols: 4, rowH: 300, viewportH: 900, overscanRows: 3 };

  it("renders only a window of items, not the whole list", () => {
    const r = computeWindow({ ...base, viewTop: 0 });
    expect(r.start).toBe(0);
    expect(r.rows).toBe(250); // ceil(1000 / 4)
    expect(r.end).toBeLessThan(base.itemCount); // windowed, not all 1000
  });

  it("advances the window as the viewport scrolls down (the regression guard)", () => {
    const top = computeWindow({ ...base, viewTop: 0 });
    const mid = computeWindow({ ...base, viewTop: 6000 }); // ~20 rows down
    expect(mid.start).toBeGreaterThan(top.start);
    expect(mid.padTop).toBeGreaterThan(top.padTop);
    // padTop keeps the slice pinned to its scroll offset (multiple of rowH).
    expect(mid.padTop % base.rowH).toBe(0);
  });

  it("keeps overscan rows above the viewport", () => {
    // viewTop = 10 rows down; startRow = 10 - 3 overscan = 7 → start = 7*cols
    const r = computeWindow({ ...base, viewTop: 3000 });
    expect(r.start).toBe(7 * base.cols);
  });

  it("clamps the end to the item count near the bottom", () => {
    const r = computeWindow({ ...base, viewTop: 300000 });
    expect(r.end).toBe(base.itemCount);
  });

  it("returns an empty window before the row height is measured", () => {
    expect(computeWindow({ ...base, rowH: 0, viewTop: 0 })).toEqual({ start: 0, end: 0, padTop: 0, rows: 0 });
  });
});
