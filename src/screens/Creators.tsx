/* Creators.tsx — creators grid + creator detail. */

import { useState } from "react";
import { Icon, Avatar } from "../components/Icons";
import { ModelResults } from "../components/cards";
import { useDataset, creatorById, nModels } from "../data/dataset";
import { useApp } from "../lib/store";
import type { Model } from "../data/types";

export function CreatorsScreen() {
  const nav = useApp((s) => s.nav);
  const S = useDataset();
  return (
    <div className="content-inner fade-in">
      <div className="page-head"><div><h1 className="page-title">Creators</h1><p className="page-sub">{S.CREATORS.length} designers in your library</p></div></div>
      <div className="tile-grid">
        {S.CREATORS.map((c) => (
          <div key={c.id} className="creator-card" onClick={() => nav({ name: "creator", id: c.id })}>
            <Avatar name={c.name} tone={c.tone} size={56} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="card-title" style={{ fontSize: 16 }}>{c.name}</div>
              <div className="faint" style={{ fontSize: 12.5 }}>{c.handle}</div>
              <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{c.blurb}</p>
              <div className="faint" style={{ fontSize: 12.5, marginTop: 8, fontWeight: 600 }}>{nModels(c.models)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CreatorDetail({ id }: { id: string }) {
  const nav = useApp((s) => s.nav);
  const fav = useApp((s) => s.fav);
  const onFav = useApp((s) => s.toggleFav);
  const renameCreator = useApp((s) => s.renameCreator);
  const toast = useApp((s) => s.toast);
  const S = useDataset();
  const c = creatorById(id);
  const [view] = useState<"grid" | "list">("grid");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const models = S.MODELS.filter((m) => m.creator === id);
  const onOpen = (m: Model) => nav({ name: "model", id: m.id });
  if (!c) { nav({ name: "creators" }); return null; }

  const startEdit = () => { setDraft(c.name); setEditing(true); };
  const commit = async () => {
    const name = draft.trim();
    setEditing(false);
    if (!name || name === c.name) return;
    try { await renameCreator(id, name); toast("Creator renamed"); }
    catch (e) { toast(String(e)); }
  };

  return (
    <div className="content-inner fade-in">
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={() => nav({ name: "creators" })}><Icon name="arrowLeft" size={16} /> Creators</button>
      <div className="creator-card" style={{ alignItems: "flex-start", marginBottom: 24 }}>
        <Avatar name={c.name} tone={c.tone} size={72} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input
              className="inline-name-edit"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commit(); }
                else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
              }}
              aria-label="Creator name"
            />
          ) : (
            <h1 className="page-title editable-name" style={{ fontSize: 26 }} onDoubleClick={startEdit} title="Double-click to rename">
              {c.name}
              <button className="name-edit-btn" onClick={startEdit} aria-label="Rename creator"><Icon name="edit" size={15} /></button>
            </h1>
          )}
          <div className="faint" style={{ fontSize: 13, marginTop: 2 }}>{c.handle}</div>
          <p className="muted" style={{ fontSize: 14, marginTop: 8, maxWidth: 520 }}>{c.blurb}</p>
        </div>
      </div>
      <ModelResults models={models} view={view} onOpen={onOpen} fav={fav} onFav={onFav} />
    </div>
  );
}
