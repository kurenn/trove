/* cards.tsx — ModelCard, ListRow, MiniCard, ModelResults. */

import { Icon, Avatar } from "./Icons";
import { Thumb } from "../three/Viewer";
import { VirtualGrid } from "./VirtualGrid";
import { creatorById, fmtSize } from "../data/dataset";
import type { Creator, Model } from "../data/types";

// Above this many cards, switch the grid to windowed rendering.
const VIRTUALIZE_THRESHOLD = 150;

const UNKNOWN_CREATOR: Creator = { id: "", name: "Unknown", handle: "", models: 0, blurb: "", tone: "var(--ink-3)" };

/** Card footer facts: print stats for demo data, file facts for real scans. */
function CardFoot({ m }: { m: Model }) {
  if (m.printTime != null) {
    return (
      <div className="card-foot">
        <span><Icon name="printer" size={14} /> {m.printTime}</span>
        <span><Icon name="scale" size={14} /> {m.filament}g</span>
        <span style={{ marginLeft: "auto" }}><Icon name="history" size={14} /> {m.makes}</span>
      </div>
    );
  }
  return (
    <div className="card-foot">
      <span><Icon name="cube" size={14} /> {m.fileCount ?? m.files.length} files</span>
      <span><Icon name="scale" size={14} /> {fmtSize(m.totalSize ?? m.files.reduce((n, f) => n + f.size, 0))}</span>
    </div>
  );
}

interface CardProps {
  m: Model;
  onOpen: (m: Model) => void;
  fav: boolean;
  onFav: (id: string) => void;
}

export function ModelCard({ m, onOpen, fav, onFav }: CardProps) {
  const creator = creatorById(m.creator) ?? UNKNOWN_CREATOR;
  // No per-card thumbnail fetch here — a single throttled background pass
  // (sweepThumbs, kicked from the store) renders missing thumbnails so scrolling
  // never streams meshes/images off a network share. Cards just show the cache.
  return (
    <div className="model-card" onClick={() => onOpen(m)}>
      <div className="thumb-wrap">
        <Thumb geometry={m.geometry} color={m.color} modelId={m.id} real={!!m.parts[0]?.files[0]?.path} />
        <button className={"card-fav" + (fav ? " is-fav" : "")} onClick={(e) => { e.stopPropagation(); onFav(m.id); }}>
          <Icon name="heart" size={16} fill={fav ? "currentColor" : "none"} />
        </button>
        <div className="card-badges">
          {!m.supports && <span className="card-badge"><Icon name="check" size={12} /> support-free</span>}
          {m.parts && m.parts.length > 1
            ? <span className="card-badge"><Icon name="cube" size={12} /> {m.parts.length} parts</span>
            : <span className="card-badge">{m.files.length} file{m.files.length > 1 ? "s" : ""}</span>}
        </div>
      </div>
      <div className="card-body">
        <div className="card-title">{m.name}</div>
        <div className="card-meta">
          <Avatar name={creator.name} tone={creator.tone} size={20} />
          {creator.name}
        </div>
        <div className="card-tags">
          {m.tags.slice(0, 3).map((t) => <span key={t} className="card-tag-mini">{t}</span>)}
        </div>
        <CardFoot m={m} />
      </div>
    </div>
  );
}

export function ListRow({ m, onOpen, fav, onFav }: CardProps) {
  const creator = creatorById(m.creator) ?? UNKNOWN_CREATOR;
  return (
    <div className="list-row" onClick={() => onOpen(m)}>
      <Thumb geometry={m.geometry} color={m.color} modelId={m.id} real={!!m.parts[0]?.files[0]?.path} />
      <div className="list-main">
        <div className="list-name">{m.name}</div>
        <div className="list-sub">{creator.name} · {m.tags.slice(0, 3).join(", ")}</div>
      </div>
      <div className="muted spool-mono" style={{ fontSize: 12.5, display: "flex", gap: 18 }}>
        {m.printTime != null
          ? <><span>{m.printTime}</span><span>{m.filament}g</span></>
          : <span>{fmtSize(m.totalSize ?? m.files.reduce((n, f) => n + f.size, 0))}</span>}
        <span>{m.fileCount ?? m.files.length} files</span>
      </div>
      <button className={"card-fav" + (fav ? " is-fav" : "")} style={{ position: "static", background: "var(--surface-2)" }}
              onClick={(e) => { e.stopPropagation(); onFav(m.id); }}>
        <Icon name="heart" size={16} fill={fav ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

export function MiniCard({ m, onOpen }: { m: Model; onOpen: (m: Model) => void }) {
  return (
    <div className="model-card" style={{ minWidth: 160 }} onClick={() => onOpen(m)}>
      <Thumb geometry={m.geometry} color={m.color} modelId={m.id} real={!!m.parts[0]?.files[0]?.path} />
      <div className="card-body" style={{ padding: 11, gap: 4 }}>
        <div className="card-title" style={{ fontSize: 13.5 }}>{m.name}</div>
        <div className="faint" style={{ fontSize: 11.5 }}>{m.printTime} · {m.filament}g</div>
      </div>
    </div>
  );
}

interface ResultsProps {
  models: Model[];
  view: "grid" | "list";
  onOpen: (m: Model) => void;
  fav: string[];
  onFav: (id: string) => void;
}

export function ModelResults({ models, view, onOpen, fav, onFav }: ResultsProps) {
  if (!models.length) return (
    <div className="empty">
      <Icon name="search" size={36} style={{ opacity: 0.4 }} />
      <p style={{ marginTop: 12, fontWeight: 600 }}>No models match those filters.</p>
      <p style={{ fontSize: 13 }}>Try removing a filter or two.</p>
    </div>
  );
  if (view === "list") return (
    <div className="model-list">
      {models.map((m) => <ListRow key={m.id} m={m} onOpen={onOpen} fav={fav.includes(m.id)} onFav={onFav} />)}
    </div>
  );
  if (models.length > VIRTUALIZE_THRESHOLD) {
    // --grid-min 240 (comfy) / --gap 18 — windowed for large libraries.
    return (
      <VirtualGrid
        items={models}
        keyOf={(m) => m.id}
        minCol={240}
        gap={18}
        render={(m) => <ModelCard m={m} onOpen={onOpen} fav={fav.includes(m.id)} onFav={onFav} />}
      />
    );
  }
  return (
    <div className="model-grid">
      {models.map((m) => <ModelCard key={m.id} m={m} onOpen={onOpen} fav={fav.includes(m.id)} onFav={onFav} />)}
    </div>
  );
}

export { fmtSize };
