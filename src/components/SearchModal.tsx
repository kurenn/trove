/* SearchModal.tsx — ⌘K command palette over a dimmed backdrop. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, Tag, Avatar } from "./Icons";
import { Thumb } from "../three/Viewer";
import { useDataset, applyFilters, creatorById, nModels } from "../data/dataset";
import { DEFAULT_FILTERS } from "../data/types";
import { useApp } from "../lib/store";
import type { Model, Creator, Collection } from "../data/types";

type FlatItem =
  | { k: "model"; item: Model }
  | { k: "creator"; item: Creator }
  | { k: "collection"; item: Collection };

export function SearchModal() {
  const open = useApp((s) => s.searchOpen);
  const query = useApp((s) => s.query);
  const setQuery = useApp((s) => s.setQuery);
  const setSearchOpen = useApp((s) => s.setSearchOpen);
  const nav = useApp((s) => s.nav);
  const S = useDataset();
  const onClose = () => setSearchOpen(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const [sel, setSel] = useState(0);
  const q = query.trim().toLowerCase();

  const results = useMemo(() => (open ? applyFilters(S.MODELS, query, DEFAULT_FILTERS).slice(0, 7) : []), [open, query]);
  const creators = q ? S.CREATORS.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 3) : [];
  const collections = q ? S.COLLECTIONS.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 2) : [];
  const flat: FlatItem[] = [
    ...results.map((m): FlatItem => ({ k: "model", item: m })),
    ...creators.map((c): FlatItem => ({ k: "creator", item: c })),
    ...collections.map((c): FlatItem => ({ k: "collection", item: c })),
  ];
  const suggestions = ["support-free", "articulated", "vase-mode", "functional", "low-poly"];

  const go = (x: FlatItem) => {
    if (x.k === "model") nav({ name: "model", id: x.item.id });
    else if (x.k === "creator") nav({ name: "creator", id: x.item.id });
    else nav({ name: "collection", id: x.item.id });
    onClose();
  };

  useEffect(() => {
    if (open) { setSel(0); const t = setTimeout(() => inputRef.current?.focus(), 40); return () => clearTimeout(t); }
  }, [open]);
  useEffect(() => { setSel(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(flat.length - 1, s + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
      else if (e.key === "Enter") { const x = flat[sel]; if (x) go(x); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, flat, sel]);

  if (!open) return null;
  const seeAll = () => { nav({ name: "search" }); onClose(); };
  let idx = -1;

  return (
    <div className="cmdk-scrim" onMouseDown={onClose}>
      <div className="cmdk fade-in" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <Icon name="search" size={20} style={{ color: "var(--ink-3)" }} />
          <input ref={inputRef} className="cmdk-input" placeholder="Search models, tags, creators…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="btn btn-icon btn-sm" onClick={() => setQuery("")}><Icon name="x" size={16} /></button>}
        </div>

        <div className="cmdk-results">
          {!q && (
            <div className="cmdk-suggest">
              <span className="faint" style={{ fontSize: 12.5, fontWeight: 600 }}>Try a tag</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 8 }}>
                {suggestions.map((s) => <Tag key={s} onClick={() => setQuery(s)}>{s}</Tag>)}
              </div>
            </div>
          )}
          {results.length > 0 && <div className="cmdk-section">Models</div>}
          {results.map((m) => { idx++; const i = idx; return (
            <button key={m.id} className={"cmdk-row" + (i === sel ? " active" : "")} onMouseEnter={() => setSel(i)} onClick={() => go({ k: "model", item: m })}>
              <Thumb geometry={m.geometry} color={m.color} thumb={m.thumb} className="cmdk-thumb" />
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div className="list-name" style={{ fontSize: 14 }}>{m.name}</div>
                <div className="list-sub">{creatorById(m.creator)?.name ?? "Unknown"} · {m.tags.slice(0, 3).join(", ")}</div>
              </div>
              {m.parts.length > 1 && <span className="card-tag-mini">{m.parts.length} parts</span>}
              <Icon name="arrowRight" size={16} style={{ color: "var(--ink-3)" }} />
            </button>
          ); })}
          {creators.length > 0 && <div className="cmdk-section">Creators</div>}
          {creators.map((c) => { idx++; const i = idx; return (
            <button key={c.id} className={"cmdk-row" + (i === sel ? " active" : "")} onMouseEnter={() => setSel(i)} onClick={() => go({ k: "creator", item: c })}>
              <Avatar name={c.name} tone={c.tone} size={34} />
              <div style={{ flex: 1, textAlign: "left" }}><div className="list-name" style={{ fontSize: 14 }}>{c.name}</div><div className="list-sub">{nModels(c.models)}</div></div>
            </button>
          ); })}
          {collections.length > 0 && <div className="cmdk-section">Collections</div>}
          {collections.map((c) => { idx++; const i = idx; return (
            <button key={c.id} className={"cmdk-row" + (i === sel ? " active" : "")} onMouseEnter={() => setSel(i)} onClick={() => go({ k: "collection", item: c })}>
              <span style={{ width: 34, height: 34, borderRadius: 9, background: c.tone, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0 }}><Icon name="layers" size={17} /></span>
              <div style={{ flex: 1, textAlign: "left" }}><div className="list-name" style={{ fontSize: 14 }}>{c.name}</div><div className="list-sub">{nModels(c.count ?? 0)}</div></div>
            </button>
          ); })}
          {q && flat.length === 0 && (
            <div className="cmdk-empty"><Icon name="search" size={30} style={{ opacity: 0.4 }} /><p style={{ marginTop: 10, fontWeight: 600 }}>No matches for “{query}”</p></div>
          )}
        </div>

        <div className="cmdk-foot">
          <span className="faint"><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> open <kbd>esc</kbd> close</span>
          <button className="cmdk-all" onClick={seeAll}>Advanced search <Icon name="arrowRight" size={14} /></button>
        </div>
      </div>
    </div>
  );
}
