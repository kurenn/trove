/* VirtualGrid.tsx — windowed rendering for the model grid so very large
   libraries (10k+) only mount the cards near the viewport. Falls back to a plain
   grid below a threshold so small libraries are byte-for-byte unchanged. */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

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
    const width = wrap.clientWidth;
    const c = Math.max(1, Math.floor((width + gap) / (minCol + gap)));
    if (c !== cols) setCols(c);
    const rows = Math.ceil(items.length / c);
    const wrapTop = wrap.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const viewTop = scroller.scrollTop - wrapTop;
    const startRow = Math.max(0, Math.floor(viewTop / rowH) - overscanRows);
    const visRows = Math.ceil(scroller.clientHeight / rowH) + overscanRows * 2;
    const start = startRow * c;
    const end = Math.min(items.length, (startRow + visRows) * c);
    setRange({ start, end, padTop: startRow * rowH });
    // keep the wrapper tall enough to preserve scroll length
    wrap.style.height = rows * rowH + "px";
  };

  // Locate the scroll container once.
  useEffect(() => {
    scrollerRef.current = findScroller(wrapRef.current);
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(recompute); };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => recompute());
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
