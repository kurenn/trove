/* virtual.ts — pure windowing math for VirtualGrid, split out so it can be unit
   tested without a DOM/layout. The component owns the effects (scroll listener,
   measurement); these functions own the arithmetic. */

/** Columns that fit `width`, honoring the min column width + gap (≥1). */
export function columnsFor(width: number, minCol: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (minCol + gap)));
}

export interface WindowInput {
  itemCount: number;
  cols: number;
  rowH: number;
  /** Scroll offset of the viewport relative to the grid's top (px). */
  viewTop: number;
  /** Visible viewport height (px). */
  viewportH: number;
  overscanRows: number;
}

export interface WindowRange {
  start: number;
  end: number;
  /** Top padding (px) that positions the rendered slice at its scroll offset. */
  padTop: number;
  /** Total rows — used to keep the wrapper tall enough to preserve scroll length. */
  rows: number;
}

/** Given scroll position and measured row height, the slice of items to render
    (plus overscan) and where to place it. As `viewTop` grows the window advances —
    the property the scroll handler must preserve (regression: it once didn't). */
export function computeWindow(i: WindowInput): WindowRange {
  if (i.rowH <= 0 || i.cols <= 0) return { start: 0, end: 0, padTop: 0, rows: 0 };
  const rows = Math.ceil(i.itemCount / i.cols);
  const startRow = Math.max(0, Math.floor(i.viewTop / i.rowH) - i.overscanRows);
  const visRows = Math.ceil(i.viewportH / i.rowH) + i.overscanRows * 2;
  const start = startRow * i.cols;
  const end = Math.min(i.itemCount, (startRow + visRows) * i.cols);
  return { start, end, padTop: startRow * i.rowH, rows };
}
