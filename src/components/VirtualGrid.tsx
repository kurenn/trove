/* VirtualGrid.tsx — windowed rendering for the model grid so very large
   libraries (10k+) only mount the cards near the viewport. Falls back to a plain
   grid below a threshold so small libraries are byte-for-byte unchanged. */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { columnsFor, computeWindow } from "./virtual";

interface VirtualGridProps<T> {
  items: T[];
  /** unique key per item */
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  minCol: number; // matches --grid-min
  gap: number; // matches --gap
  overscanRows?: number;
}

function findScroller(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement || null;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll") return p;
    p = p.parentElement;
  }
  return null;
}

export function VirtualGrid<T>({ items, keyOf, render, minCol, gap, overscanRows = 3 }: VirtualGridProps<T>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [cols, setCols] = useState(1);
  const [rowH, setRowH] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 60, padTop: 0 });

  const recompute = () => {
    const wrap = wrapRef.current;
    const scroller = scrollerRef.current;
    if (!wrap || !scroller || rowH <= 0) return;
    const c = columnsFor(wrap.clientWidth, minCol, gap);
    if (c !== cols) setCols(c);
    const wrapTop = wrap.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const viewTop = scroller.scrollTop - wrapTop;
    const { start, end, padTop, rows } = computeWindow({
      itemCount: items.length, cols: c, rowH, viewTop,
      viewportH: scroller.clientHeight, overscanRows,
    });
    setRange({ start, end, padTop });
    // keep the wrapper tall enough to preserve scroll length
    wrap.style.height = rows * rowH + "px";
  };

  // The scroll/resize listeners are bound once (below), so they'd otherwise close
  // over the first render's `recompute` — where rowH is still 0 and every call
  // early-returns, so scrolling never advanced the window. Keep a ref pointing at
  // the latest closure so those listeners always see current rowH/cols/scroll.
  const recomputeRef = useRef(recompute);
  recomputeRef.current = recompute;

  // Locate the scroll container once.
  useEffect(() => {
    scrollerRef.current = findScroller(wrapRef.current);
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => recomputeRef.current()); };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => recomputeRef.current());
    ro.observe(scroller);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => { scroller.removeEventListener("scroll", onScroll); ro.disconnect(); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Measure one card's height (thumb is square → height depends on column width),
  // then compute the window.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const firstCard = wrap.querySelector<HTMLElement>("[data-vcard]");
    if (firstCard) {
      const h = firstCard.offsetHeight + gap;
      if (h > 0 && Math.abs(h - rowH) > 1) { setRowH(h); return; }
    }
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, rowH, cols]);

  // Recompute when the item set changes.
  useEffect(() => { recompute(); /* eslint-disable-next-line */ }, [items.length, rowH]);

  const visible = items.slice(range.start, range.end);
  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <div
        style={{
          position: "absolute", top: range.padTop, left: 0, right: 0,
          display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap,
        }}>
        {visible.map((it) => (
          <div data-vcard key={keyOf(it)}>{render(it)}</div>
        ))}
      </div>
    </div>
  );
}
