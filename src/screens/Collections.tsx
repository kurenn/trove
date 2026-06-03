/* Collections.tsx — collections grid + collection detail + new-collection flow. */

import { useState } from "react";
import { Icon } from "../components/Icons";
import { Thumb } from "../three/Viewer";
import { Toolbar } from "../components/filters";
import { ModelResults } from "../components/cards";
import { useDataset, collectionById, applyFilters, nModels } from "../data/dataset";
import { DEFAULT_FILTERS } from "../data/types";
import { useApp } from "../lib/store";
import type { Collection, Filters, Model } from "../data/types";

/** Models belonging to a collection — explicit membership for user collections,
    folder match for derived ones. */
function modelsOf(models: Model[], c: Collection): Model[] {
  return c.members ? models.filter((m) => c.members!.includes(m.id)) : models.filter((m) => m.collection === c.id);
}

function CollCover({ collection }: { collection: Collection }) {
  const S = useDataset();
  const ms = modelsOf(S.MODELS, collection).slice(0, 4);
  if (ms.length === 0) return <div className="coll-cover coll-cover-empty"><Icon name="layers" size={26} style={{ opacity: 0.35 }} /></div>;
  return (
    <div className="coll-cover">
      {ms.slice(0, 4).map((m) => (
        <Thumb key={m.id} geometry={m.geometry} color={m.color} modelId={m.id} real={!!m.parts[0]?.files[0]?.path} />
      ))}
    </div>
  );
}

/** Small centered dialog to name a new collection. */
function NewCollectionDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  const submit = () => { const n = name.trim(); if (n) onCreate(n); };
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title"><Icon name="layers" size={18} /> New collection</div>
        <p className="muted" style={{ fontSize: 13, margin: "2px 0 14px" }}>Group models from anywhere in your library. Add models from any model's page.</p>
        <input
          className="input" autoFocus value={name} placeholder="Collection name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); else if (e.key === "Escape") onClose(); }}
          aria-label="Collection name"
        />
        <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={submit}><Icon name="plus" size={16} /> Create</button>
        </div>
      </div>
    </div>
  );
}

export function CollectionsScreen() {
  const nav = useApp((s) => s.nav);
  const createCollection = useApp((s) => s.createCollection);
  const toast = useApp((s) => s.toast);
  const S = useDataset();
  const [creating, setCreating] = useState(false);

  const create = async (name: string) => {
    setCreating(false);
    try {
      const id = await createCollection(name);
      toast(`Created “${name}”`);
      if (id) nav({ name: "collection", id });
    } catch (e) { toast(String(e)); }
  };

  return (
    <div className="content-inner fade-in">
      <div className="page-head">
        <div><h1 className="page-title">Collections</h1><p className="page-sub">{S.COLLECTIONS.length} curated groups</p></div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={17} /> New collection</button>
      </div>
      {S.COLLECTIONS.length === 0 ? (
        <div className="empty">
          <Icon name="layers" size={36} style={{ opacity: 0.4 }} />
          <p style={{ marginTop: 12, fontWeight: 600 }}>No collections yet.</p>
          <p style={{ fontSize: 13 }}>Create one to group models from anywhere in your library.</p>
        </div>
      ) : (
        <div className="tile-grid">
          {S.COLLECTIONS.map((c) => (
            <div key={c.id} className="coll-card" onClick={() => nav({ name: "collection", id: c.id })}>
              <CollCover collection={c} />
              <div className="coll-info">
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ width: 11, height: 11, borderRadius: 3, background: c.tone }} />
                  <span className="card-title" style={{ fontSize: 16 }}>{c.name}</span>
                </div>
                {c.blurb && <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{c.blurb}</p>}
                <div className="faint" style={{ fontSize: 12.5, marginTop: 10, fontWeight: 600 }}>{nModels(c.count ?? 0)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {creating && <NewCollectionDialog onClose={() => setCreating(false)} onCreate={create} />}
    </div>
  );
}

export function CollectionDetail({ id }: { id: string }) {
  const nav = useApp((s) => s.nav);
  const fav = useApp((s) => s.fav);
  const onFav = useApp((s) => s.toggleFav);
  const deleteCollection = useApp((s) => s.deleteCollection);
  const toast = useApp((s) => s.toast);
  const S = useDataset();
  const c = collectionById(id);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [f] = useState<Filters>(DEFAULT_FILTERS);
  if (!c) { nav({ name: "collections" }); return null; }
  const isUser = c.members !== undefined;
  const models = applyFilters(modelsOf(S.MODELS, c), "", f);
  const onOpen = (m: Model) => nav({ name: "model", id: m.id });

  const remove = async () => {
    if (!isUser) return;
    try { await deleteCollection(c.id); toast("Collection deleted"); nav({ name: "collections" }); }
    catch (e) { toast(String(e)); }
  };

  return (
    <div className="content-inner fade-in">
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={() => nav({ name: "collections" })}><Icon name="arrowLeft" size={16} /> Collections</button>
      <div className="page-head">
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ width: 60, height: 60, borderRadius: "var(--r-lg)", background: c.tone, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><Icon name="layers" size={28} /></div>
          <div><h1 className="page-title">{c.name}</h1><p className="page-sub">{nModels(models.length)}{isUser ? " · your collection" : ""}</p></div>
        </div>
        {isUser && <button className="btn btn-sm" onClick={remove}><Icon name="trash" size={15} /> Delete</button>}
      </div>
      <Toolbar view={view} setView={setView} count={models.length} hideFilterToggle />
      {isUser && models.length === 0 ? (
        <div className="empty">
          <Icon name="layers" size={36} style={{ opacity: 0.4 }} />
          <p style={{ marginTop: 12, fontWeight: 600 }}>This collection is empty.</p>
          <p style={{ fontSize: 13 }}>Open any model and use “Add to collection” to add it here.</p>
        </div>
      ) : (
        <ModelResults models={models} view={view} onOpen={onOpen} fav={fav} onFav={onFav} />
      )}
    </div>
  );
}
