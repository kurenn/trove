/* Detail.tsx — model detail: live viewer, specs, parts, folder actions, similar. */

import { useEffect, useState } from "react";
import { Icon, Avatar, Tag } from "../components/Icons";
import { Thumb, Viewer3D, type ViewerMode } from "../three/Viewer";
import { MiniCard } from "../components/cards";
import { useDataset, creatorById, collectionById, similar, modelDims, fmtDate, fmtSize, nModels } from "../data/dataset";
import { CollectionMenu } from "../components/CollectionMenu";
import { useApp } from "../lib/store";
import { isTauri, revealInManager, copyText } from "../lib/tauri";
import type { Creator, Model } from "../data/types";

const UNKNOWN_CREATOR: Creator = { id: "", name: "Unknown", handle: "", models: 0, blurb: "", tone: "var(--ink-3)" };

export function DetailScreen({ model }: { model: Model }) {
  const nav = useApp((s) => s.nav);
  const fav = useApp((s) => s.fav);
  const onFav = useApp((s) => s.toggleFav);
  const toast = useApp((s) => s.toast);
  useDataset(); // re-render if the dataset swaps

  const m = model;
  const creator = creatorById(m.creator) ?? UNKNOWN_CREATOR;
  const collection = collectionById(m.collection);
  const [mode, setMode] = useState<ViewerMode>("rotate");
  const [auto, setAuto] = useState(true);
  const [realDims, setRealDims] = useState<{ w: number; d: number; h: number } | null>(null);
  // The live interactive mesh is loaded on demand (it streams the full file off
  // disk/NAS — slow for big models). Until then we show the cached image poster,
  // so opening a model is instant. Resets to the poster on each new model.
  const [show3D, setShow3D] = useState(false);
  const parts = m.parts;
  // Default to an STL part if present — binary STLs load reliably; a .3mf (often
  // alphabetically first) can be slow/unparseable and would fall back to a shape.
  const stlIdx = Math.max(0, parts.findIndex((p) => (p.files[0]?.type || "").toLowerCase() === "stl"));
  const [sel, setSel] = useState(stlIdx);
  useEffect(() => { setSel(stlIdx); setRealDims(null); setShow3D(false); }, [m.id]);
  const part = parts[sel] || parts[0];
  const partFile = part.files[0];
  // Cached local image used as the instant poster (downscaled render / rendered thumb).
  const liveThumb = useApp((s) => s.thumbs[m.id]);
  const poster = liveThumb ?? m.thumb;
  // Real bounds from the loaded mesh take priority over the demo volume estimate.
  const dims = realDims ?? modelDims(m);
  const dimVal = (n: number) => (n ? n : "—");
  const isFav = fav.includes(m.id);
  const sims = similar(m);

  const HINTS: Record<ViewerMode, string> = { rotate: "drag to rotate · scroll to zoom", measure: "bounding box dimensions" };

  const openFolder = async () => {
    if (isTauri && partFile?.path) {
      try { await revealInManager(partFile.path); toast("Revealed in your file manager"); return; }
      catch (e) { toast(String(e)); return; }
    }
    toast("Revealed in your file manager");
  };
  const copyPath = async () => {
    try { await copyText(m.folder); toast("Path copied to clipboard"); }
    catch { toast("Path copied to clipboard"); }
  };

  return (
    <div className="content-inner fade-in">
      <div className="detail-top">
        <button className="btn btn-sm" onClick={() => nav({ name: "library" })}><Icon name="arrowLeft" size={16} /> Library</button>
        {collection && (
          <div className="crumb">
            <Icon name="chevronRight" size={14} style={{ color: "var(--ink-3)" }} />
            <a onClick={() => nav({ name: "collection", id: collection.id })} style={{ cursor: "pointer" }}>{collection.name}</a>
          </div>
        )}
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => onFav(m.id)}>
          <Icon name="heart" size={16} fill={isFav ? "var(--accent)" : "none"} style={{ color: isFav ? "var(--accent)" : "inherit" }} /> {isFav ? "Saved" : "Save"}
        </button>
        <button className="btn btn-sm" onClick={() => toast("Share link copied")}><Icon name="share" size={16} /> Share</button>
      </div>

      <div className="detail-grid">
        <div>
          <div className="viewer-shell">
            <div className="viewer-stage">
              {show3D || !partFile?.path ? (
                // Real file → on user request; no path (mock/demo) → instant procedural.
                <>
                  <Viewer3D
                    geometry={part.geometry}
                    color={part.color}
                    mode={mode}
                    autoRotate={auto && mode === "rotate"}
                    filePath={partFile?.path}
                    fileExt={partFile?.type}
                    onDims={setRealDims}
                  />
                  <div className="viewer-hint">{HINTS[mode]}</div>
                  {parts.length > 1 && <div className="viewer-part-label"><Icon name="cube" size={13} /> {part.name}</div>}
                  <div className="viewer-toolbar">
                    <button className={"vtool" + (mode === "rotate" ? " is-active" : "")} onClick={() => setMode("rotate")}><Icon name="refresh" size={16} /> Rotate</button>
                    <button className={"vtool" + (mode === "measure" ? " is-active" : "")} onClick={() => setMode("measure")}><Icon name="ruler" size={16} /> Measure</button>
                    {mode === "rotate" &&
                      <button className={"vtool" + (auto ? " is-active" : "")} onClick={() => setAuto(!auto)} title="Turntable"><Icon name="history" size={16} /></button>}
                  </div>
                </>
              ) : (
                // Instant poster (cached local image). The full mesh streams only
                // when the user opts in — keeps opening a model fast on a NAS.
                <button className="viewer-poster" onClick={() => partFile?.path && setShow3D(true)} disabled={!partFile?.path}>
                  {poster
                    ? <img src={poster} alt={part.name} draggable={false} />
                    : <span className="spool-thumb-ph-icon" style={{ color: part.color }}><Icon name="cube" size={48} /></span>}
                  {partFile?.path && <span className="viewer-load-cta"><Icon name="cube" size={16} /> View in 3D</span>}
                </button>
              )}
            </div>
          </div>
          <div className="dims-row">
            <div className="dim-chip"><div className="v">{dimVal(dims.w)}</div><div className="k">width mm</div></div>
            <div className="dim-chip"><div className="v">{dimVal(dims.d)}</div><div className="k">depth mm</div></div>
            <div className="dim-chip"><div className="v">{dimVal(dims.h)}</div><div className="k">height mm</div></div>
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><Icon name="info" size={18} /> About this model</div>
            <p style={{ color: "var(--ink-2)", fontSize: 14.5, lineHeight: 1.6, margin: 0 }}>{m.desc}</p>
            <div style={{ display: "flex", gap: 18, marginTop: 16, flexWrap: "wrap", fontSize: 13 }}>
              <span className="muted"><Icon name="globe" size={14} style={{ verticalAlign: "-2px" }} /> Source: <b style={{ color: "var(--ink)" }}>{m.source}</b></span>
              <span className="muted"><Icon name="lock" size={14} style={{ verticalAlign: "-2px" }} /> License: <b style={{ color: "var(--ink)" }}>{m.license}</b></span>
              <span className="muted"><Icon name="history" size={14} style={{ verticalAlign: "-2px" }} /> Added {fmtDate(m.added)}</span>
            </div>
          </div>
        </div>

        <div>
          <h1 className="page-title" style={{ fontSize: 26 }}>{m.name}</h1>
          <div className="creator-card" style={{ marginTop: 14, boxShadow: "none", cursor: "pointer" }} onClick={() => nav({ name: "creator", id: creator.id })}>
            <Avatar name={creator.name} tone={creator.tone} size={42} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{creator.name}</div>
              <div className="faint" style={{ fontSize: 12.5 }}>{creator.handle} · {nModels(creator.models)}</div>
            </div>
            <Icon name="chevronRight" size={18} style={{ color: "var(--ink-3)" }} />
          </div>

          <div className="panel" style={{ marginTop: 16, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <div className="file-ico" style={{ background: "var(--surface-2)" }}><Icon name="folder" size={18} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Stored in your library</div>
                <div className="file-sub" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.folder}</div>
              </div>
            </div>
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={openFolder}><Icon name="folder" size={17} /> Open folder</button>
            <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={copyPath}><Icon name="link" size={16} /> Copy path</button>
          </div>

          <div className="panel">
            <div className="panel-h"><Icon name="layers" size={18} /> Collections</div>
            <CollectionMenu model={m} />
          </div>

          <div className="panel">
            <div className="panel-h"><Icon name="cube" size={18} /> {parts.length > 1 ? "Parts" : "Part"} <span className="faint" style={{ fontWeight: 500, marginLeft: 4 }}>{parts.length}</span>
              {parts.length > 1 && <span className="faint" style={{ fontWeight: 500, fontSize: 12.5, marginLeft: "auto" }}>tap to view</span>}
            </div>
            {parts.map((p, i) =>
              <button key={p.id} className={"part-row" + (i === sel ? " active" : "")} onClick={() => setSel(i)}>
                <Thumb geometry={p.geometry} color={p.color} className="part-thumb" real={!!p.files[0]?.path} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="file-name">{p.name}</div>
                  <div className="file-sub">{p.files.map((fl) => fl.type.toUpperCase()).join(" · ")} · {fmtSize(p.files.reduce((n, fl) => n + fl.size, 0))}</div>
                </div>
                {i === sel && <Icon name="eye" size={17} style={{ color: "var(--accent)", flexShrink: 0 }} />}
              </button>
            )}
            {m.extras && m.extras.length > 0 &&
              <>
                <div className="faint" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", margin: "15px 0 9px" }}>Also in this folder</div>
                {m.extras.map((fl) =>
                  <div key={fl.name} className="file-row" style={{ cursor: "default" }}>
                    <div className="file-ico">{fl.type}</div>
                    <div style={{ flex: 1, minWidth: 0 }}><div className="file-name">{fl.name}</div><div className="file-sub">{fmtSize(fl.size)}</div></div>
                  </div>
                )}
              </>
            }
          </div>

          <div className="panel">
            <div className="autotag-banner"><Icon name="sparkles" size={17} /> Tagged automatically by Trove</div>
            <div className="card-tags" style={{ gap: 7 }}>
              {m.tags.map((t) => <Tag key={t} onClick={() => nav({ name: "search", tag: t })}>{t}</Tag>)}
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 38 }}>
        <div className="panel-h" style={{ fontSize: 18, marginBottom: 16 }}><Icon name="wand" size={19} /> Similar models</div>
        <div style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 8 }}>
          {sims.map((s) => <MiniCard key={s.id} m={s} onOpen={(mm) => nav({ name: "model", id: mm.id })} />)}
        </div>
      </div>
    </div>
  );
}
