/* Detail.tsx — model detail: live viewer, specs, parts, folder actions, similar. */

import { useEffect, useState } from "react";
import { Icon, Avatar, Tag } from "../components/Icons";
import { Thumb, Viewer3D, type ViewerMode } from "../three/Viewer";
import { MiniCard } from "../components/cards";
import { useDataset, creatorById, collectionById, similar, modelDims, fmtDate, fmtSize, nModels, slicerFile, printStatusOf, PRINT_STATUSES, slicerId, slicerButtonName, canSplit, folderName, fileCount, cadFile, formatsOf, plateProject, plateLabel, versionFiles, type SlicerId } from "../data/dataset";
import { CollectionMenu } from "../components/CollectionMenu";
import { useApp } from "../lib/store";
import { isTauri, api, revealInManager, copyText, loadConvert } from "../lib/tauri";
import type { Creator, Library, Model, ModelFile, PrintStatus, Plate } from "../data/types";

const UNKNOWN_CREATOR: Creator = { id: "", name: "Unknown", handle: "", models: 0, blurb: "", tone: "var(--ink-3)" };

// Show this many parts before the list scrolls / collapses (big multi-part models
// otherwise turn the page into an endless scroll).
const PART_CAP = 10;

// Editable / project / bundle files worth surfacing on their own (Blender scenes,
// 3MF projects, slicer projects, archives) — distinct from the printable meshes.
const SOURCE_TYPES = ["blend", "3mf", "chitubox", "lys", "zip"];

export function DetailScreen({ model }: { model: Model }) {
  const nav = useApp((s) => s.nav);
  const fav = useApp((s) => s.fav);
  const onFav = useApp((s) => s.toggleFav);
  const toast = useApp((s) => s.toast);
  const setPrintStatus = useApp((s) => s.setPrintStatus);
  useDataset(); // re-render if the dataset swaps
  // Which slicer the button starts (Settings → Libraries → Slicer) — it names
  // the button; the backend reads the same setting when it launches.
  const [slicer, setSlicer] = useState<SlicerId>("bambu");
  useEffect(() => {
    if (!isTauri) return;
    api.getSetting("slicer_app").then((v) => setSlicer(slicerId(v))).catch(() => {});
  }, []);
  // The CAD program "Edit in …" starts, or null when there is none (button hidden).
  const [cadName, setCadName] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    api.cadName().then(setCadName).catch(() => {});
  }, []);

  // The grid ships slim models; pull the on-demand-hydrated full record (files,
  // parts, folder, desc) and fetch it on open. Until it lands the poster + identity
  // render instantly from the slim model; the heavy panels fill in when ready.
  const full = useApp((s) => s.details[model.id]);
  useEffect(() => { if (isTauri) useApp.getState().hydrateModel(model.id); }, [model.id]);
  const m = full ?? model;
  const hydrating = isTauri && !full;
  const creator = creatorById(m.creator) ?? UNKNOWN_CREATOR;
  const collection = collectionById(m.collection);
  const [mode, setMode] = useState<ViewerMode>("rotate");
  const [auto, setAuto] = useState(true);
  const [realDims, setRealDims] = useState<{ w: number; d: number; h: number } | null>(null);
  // The live interactive mesh is loaded on demand (it streams the full file off
  // disk/NAS — slow for big models). Until then we show the cached image poster,
  // so opening a model is instant. Resets to the poster on each new model.
  const [show3D, setShow3D] = useState(false);
  const [showAllParts, setShowAllParts] = useState(false);
  // Before hydration the slim model has no parts — fall back to a single poster
  // part (from the card-level geometry/color) so the viewer shows the cached image.
  const parts = m.parts.length
    ? m.parts
    : [{ id: m.id + "-p0", name: m.name, geometry: m.geometry, color: m.color, files: [] as ModelFile[] }];
  const partCount = m.partsCount ?? parts.length;
  // Default to an STL part if present — binary STLs load reliably; a .3mf (often
  // alphabetically first) can be slow/unparseable and would fall back to a shape.
  const stlIdx = Math.max(0, parts.findIndex((p) => (p.files[0]?.type || "").toLowerCase() === "stl"));
  const [sel, setSel] = useState(stlIdx);
  // Which version of the selected part is in view (0 = newest). Everything below
  // — viewer, slicer, CAD, plates — works on that version's files.
  const [ver, setVer] = useState(0);
  // Re-init selection on model change AND when hydration swaps in the real parts.
  useEffect(() => { setSel(stlIdx); setVer(0); setRealDims(null); setShow3D(false); setShowAllParts(false); }, [m.id, full]);
  const part = parts[sel] || parts[0];
  const partFiles = versionFiles(part, ver);
  const partFile = partFiles[0];
  const pickPart = (i: number) => { setSel(i); setVer(0); setRealDims(null); };
  const pickVersion = (i: number) => { setVer(i); setRealDims(null); setShow3D(false); };
  // Project/source files anywhere in this model's folder tree (Blender, 3MF, etc.).
  const sourceFiles = m.files.filter((f) => SOURCE_TYPES.includes((f.type || "").toLowerCase()));
  // Cached local image used as the instant poster (downscaled render / rendered thumb).
  const liveThumb = useApp((s) => s.thumbs[m.id]);
  const poster = liveThumb ?? m.thumb;
  // Whether the selected part is a loadable mesh, and whether to show the demo
  // procedural shape. Procedural is ONLY for mock/browser data — a real on-disk
  // model with no renderable mesh (e.g. a .blend) shows its cached image instead.
  const renderable = !!partFile?.path;
  const procedural = !isTauri && !renderable;
  const blendOnly = !renderable && sourceFiles.some((f) => f.type === "blend");
  // Real bounds from the loaded mesh take priority over the demo volume estimate.
  const dims = realDims ?? modelDims(m);
  const dimVal = (n: number) => (n ? n : "—");
  const isFav = fav.includes(m.id);
  const sims = similar(m);

  const HINTS: Record<ViewerMode, string> = { rotate: "drag to rotate · scroll to zoom", measure: "bounding box dimensions" };

  const revealFile = async (path?: string) => {
    if (isTauri && path) {
      try { await revealInManager(path); toast("Revealed in your file manager"); return; }
      catch (e) { toast(String(e)); return; }
    }
    toast("Revealed in your file manager");
  };

  const openFolder = async () => {
    if (isTauri && partFile?.path) {
      try { await revealInManager(partFile.path); toast("Revealed in your file manager"); return; }
      catch (e) { toast(String(e)); return; }
    }
    toast("Revealed in your file manager");
  };
  // The slim grid row always carries the current status; the hydrated record is
  // patched by the store on change, so either source is fresh.
  const status = printStatusOf(m);
  const changeStatus = async (next: PrintStatus) => {
    try { await setPrintStatus(m.id, next); }
    catch (e) { toast(String(e)); }
  };
  // What the slicer gets: the selected part if it's sliceable, else the model's
  // best sliceable file (a 3MF project before a bare mesh).
  const toSlice = slicerFile(m, partFiles);
  // CAD gets the part's most editable format: a native design or STEP before a mesh.
  const toEdit = cadFile(m, partFiles);
  const openInCad = async () => {
    if (!toEdit?.path) return;
    try { await api.openInCad(toEdit.path); toast(`Opening ${toEdit.name} in ${cadName}…`); }
    catch (e) { toast(String(e)); }
  };
  const formats = formatsOf(m);
  // Plates of the slicer project in view, loaded on demand (the backend reads the
  // project once, then serves from its cache). Listed only for multi-plate
  // projects — for a single plate the model's print status says it all.
  const project = plateProject(m, partFiles);
  const projectPath = project?.path;
  const [plates, setPlates] = useState<Plate[]>([]);
  useEffect(() => {
    setPlates([]);
    if (!isTauri || !projectPath) return;
    let stale = false;
    Promise.all([api.getPlates(projectPath), loadConvert()])
      .then(([ps, conv]) => { if (!stale) setPlates(ps.map((p) => ({ ...p, thumb: p.thumb ? conv(p.thumb) : undefined }))); })
      .catch(() => {});
    return () => { stale = true; };
  }, [projectPath]);
  const platesDone = plates.filter((p) => p.printed).length;
  const togglePlate = async (p: Plate) => {
    if (!projectPath) return;
    const printed = !p.printed;
    // Optimistic: flip now, put it back if the write fails.
    const flip = (v: boolean) => setPlates((ps) => ps.map((x) => (x.index === p.index ? { ...x, printed: v } : x)));
    flip(printed);
    try { await api.setPlatePrinted(projectPath, p.index, printed); }
    catch (e) { flip(!printed); toast(String(e)); }
  };
  const slicerName = slicerButtonName(slicer);
  const openInSlicer = async () => {
    if (!toSlice?.path) return;
    if (!isTauri) { toast(`Opening in ${slicerName}…`); return; }
    try { await api.openInSlicer(toSlice.path); toast(`Opening ${toSlice.name} in ${slicerName}…`); }
    catch (e) { toast(String(e)); }
  };
  // Folder grouping is the user's call below the library root: split a category
  // folder into its models, or put a split folder back together. Index-only —
  // nothing moves on disk. Both start a rescan, after which this model's id is
  // gone (split) or its siblings are (regroup), so leave for the library.
  const regroup = async (start: () => Promise<Library[]>, msg: string) => {
    try {
      useApp.getState().setLibraries(await start());
      toast(msg);
      nav({ name: "library" });
    } catch (e) { toast(String(e)); }
  };
  const split = () => regroup(() => api.splitFolder(m.id), `Splitting “${m.name}” into separate models…`);
  const unsplit = () => m.splitParent && regroup(() => api.unsplitFolder(m.splitParent!), `Regrouping “${folderName(m.splitParent)}”…`);
  // A loose file next to a folder of the same name: offer to move it in. This is
  // the one action that changes files on disk, so it takes a second, explicit click.
  const [confirmMove, setConfirmMove] = useState(false);
  useEffect(() => { setConfirmMove(false); }, [m.id]);
  const moveIn = () => m.belongsTo && regroup(() => api.moveIntoFolder(m.id), `Moved into “${folderName(m.belongsTo)}”`);
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
              {procedural || (show3D && renderable) ? (
                // Mock/demo data (procedural shape) OR a real mesh on user request.
                <>
                  <Viewer3D
                    geometry={part.geometry}
                    color={part.color}
                    mode={mode}
                    autoRotate={auto && mode === "rotate"}
                    filePath={partFile?.path}
                    fileExt={partFile?.type}
                    onDims={setRealDims}
                    fallbackImage={poster}
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
                // Real on-disk model: show the cached image instantly (never a
                // misleading procedural shape). A loadable mesh gets "View in 3D";
                // a .blend / non-mesh with no thumbnail shows a neutral tile.
                <button className="viewer-poster" onClick={() => renderable && setShow3D(true)} disabled={!renderable}>
                  {poster
                    ? <img src={poster} alt={part.name} draggable={false} />
                    : blendOnly
                      ? <span className="viewer-typetile">BLEND</span>
                      : <span className="spool-thumb-ph-icon" style={{ color: part.color }}><Icon name="cube" size={48} /></span>}
                  {renderable && <span className="viewer-load-cta"><Icon name="cube" size={16} /> View in 3D</span>}
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

          {sourceFiles.length > 0 &&
            <div className="panel">
              <div className="panel-h"><Icon name="folder" size={18} /> Project &amp; source files <span className="faint" style={{ fontWeight: 500, marginLeft: 4 }}>{sourceFiles.length}</span></div>
              {sourceFiles.map((f) =>
                <button key={f.path || f.name} className="part-row" onClick={() => revealFile(f.path)} title="Reveal in folder">
                  <div className="file-ico">{f.type.toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="file-name">{f.name}</div>
                    <div className="file-sub">{f.type.toUpperCase()} · {fmtSize(f.size)}</div>
                  </div>
                  <Icon name="folder" size={16} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
                </button>
              )}
            </div>
          }
        </div>

        <div>
          <h1 className="page-title" style={{ fontSize: 26 }}>{m.name}</h1>
          {formats.length > 0 &&
            <div className="format-row" title="Formats this model is available in">
              {formats.map((t) => <span key={t} className="format-chip">{t}</span>)}
            </div>}
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
                <div className="file-sub" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.folder || (hydrating ? "Loading…" : "")}</div>
              </div>
            </div>
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={openInSlicer} disabled={hydrating || !toSlice}
                    title={toSlice ? toSlice.name : "No file in this model that a slicer can open"}>
              <Icon name="printer" size={17} /> Open in {slicerName}
            </button>
            {cadName && toEdit &&
              <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={openInCad} disabled={hydrating} title={toEdit.name}>
                <Icon name="wand" size={17} /> Edit in {cadName}
              </button>}
            <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={openFolder} disabled={hydrating}><Icon name="folder" size={17} /> Open folder</button>
            <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={copyPath} disabled={hydrating}><Icon name="link" size={16} /> Copy path</button>
          </div>

          <div className="panel">
            <div className="panel-h"><Icon name="printer" size={18} /> Print status</div>
            <div className="status-seg" role="group" aria-label="Print status">
              <button className={status === "" ? "is-active" : ""} onClick={() => changeStatus("")}>None</button>
              {PRINT_STATUSES.map((s) =>
                <button key={s.id} className={(status === s.id ? "is-active " : "") + "st-" + s.id} onClick={() => changeStatus(s.id)}>{s.label}</button>
              )}
            </div>
          </div>

          {plates.length > 1 &&
            <div className="panel">
              <div className="panel-h"><Icon name="layers" size={18} /> Plates
                <span className="faint" style={{ fontWeight: 500, marginLeft: 4 }}>{platesDone} of {plates.length} printed</span>
              </div>
              <div className="file-sub" style={{ margin: "-4px 0 8px" }}>{project?.name}</div>
              <div className="plate-list">
                {plates.map((p) =>
                  <button key={p.index} className={"plate-row" + (p.printed ? " is-printed" : "")} onClick={() => togglePlate(p)}
                          title={p.printed ? "Printed — click to undo" : "Mark this plate as printed"}>
                    {p.thumb ? <img src={p.thumb} alt="" draggable={false} /> : <span className="plate-noimg"><Icon name="cube" size={18} /></span>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="file-name">{plateLabel(p)}</div>
                      <div className="file-sub">Plate {p.index}</div>
                    </div>
                    <span className="plate-check"><Icon name="check" size={14} /></span>
                  </button>
                )}
              </div>
            </div>
          }

          {isTauri && !hydrating && m.belongsTo &&
            <div className="panel hint-panel">
              <div className="panel-h"><Icon name="folder" size={18} /> Belongs in “{folderName(m.belongsTo)}”?</div>
              <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
                This loose file sits right next to a folder of the same name. Moving it in keeps the project together — it then shows up as a part (or a new version) of that model.
              </p>
              {!confirmMove
                ? <button className="btn" style={{ width: "100%" }} onClick={() => setConfirmMove(true)}><Icon name="folder" size={16} /> Move into “{folderName(m.belongsTo)}”…</button>
                : <>
                    <p style={{ fontSize: 13, margin: "0 0 10px" }}>
                      Move {fileCount(m)} file{fileCount(m) === 1 ? "" : "s"} on disk into <b>{m.belongsTo}</b>? Nothing is overwritten: a file whose name is already taken there is added as “name (2)”.
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-primary" style={{ flex: 1 }} onClick={moveIn}>Move files</button>
                      <button className="btn" style={{ flex: 1 }} onClick={() => setConfirmMove(false)}>Cancel</button>
                    </div>
                  </>}
            </div>
          }

          {isTauri && !hydrating && (canSplit(m) || m.splitParent) &&
            <div className="panel">
              <div className="panel-h"><Icon name="folder" size={18} /> Folder grouping</div>
              {canSplit(m) && <>
                <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
                  Is this folder a category rather than one model? Split it: each loose file becomes its own model and each subfolder stays one. Nothing moves on disk.
                </p>
                <button className="btn" style={{ width: "100%" }} onClick={split}><Icon name="grid" size={16} /> Split into separate models</button>
              </>}
              {m.splitParent && <>
                <p className="muted" style={{ fontSize: 13, margin: canSplit(m) ? "14px 0 10px" : "0 0 10px" }}>
                  Split out of “{folderName(m.splitParent)}”.
                </p>
                <button className="btn" style={{ width: "100%" }} onClick={unsplit}><Icon name="layers" size={16} /> Regroup “{folderName(m.splitParent)}” into one model</button>
              </>}
            </div>
          }

          <div className="panel">
            <div className="panel-h"><Icon name="layers" size={18} /> Collections</div>
            <CollectionMenu model={m} />
          </div>

          <div className="panel">
            <div className="panel-h"><Icon name="cube" size={18} /> {partCount > 1 ? "Parts" : "Part"} <span className="faint" style={{ fontWeight: 500, marginLeft: 4 }}>{partCount}</span>
              {partCount > 1 && !hydrating && <span className="faint" style={{ fontWeight: 500, fontSize: 12.5, marginLeft: "auto" }}>tap to view</span>}
            </div>
            <div className="part-list">
              {/* Cap the rows so a 100+ part model doesn't turn the page into an
                  endless scroll; the selected part is always kept visible. */}
              {hydrating ? (
                <div className="file-sub" style={{ padding: "10px 2px" }}>Loading parts…</div>
              ) : parts.slice(0, showAllParts ? parts.length : Math.max(PART_CAP, sel + 1)).map((p, i) =>
                <button key={p.id} className={"part-row" + (i === sel ? " active" : "")} onClick={() => pickPart(i)}>
                  <Thumb geometry={p.geometry} color={p.color} className="part-thumb" real={!!p.files[0]?.path} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="file-name">{p.name}</div>
                    <div className="file-sub">
                      {p.versions && <>{p.versions[0].label} · {p.versions.length} versions · </>}
                      {p.files.map((fl) => fl.type.toUpperCase()).join(" · ")} · {fmtSize(p.files.reduce((n, fl) => n + fl.size, 0))}
                    </div>
                  </div>
                  {i === sel && <Icon name="eye" size={17} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                </button>
              )}
            </div>
            {part.versions &&
              <div className="version-row" title="Versions of this part, from its file names">
                <span className="faint">Version</span>
                {part.versions.map((v, i) =>
                  <button key={v.label} className={"version-chip" + (i === ver ? " is-active" : "")} onClick={() => pickVersion(i)}
                          title={v.files.map((fl) => fl.name).join(", ")}>
                    {v.label}{i === 0 ? " · newest" : ""}
                  </button>
                )}
              </div>
            }
            {parts.length > PART_CAP &&
              <button className="btn btn-sm" style={{ width: "100%", marginTop: 8 }} onClick={() => setShowAllParts((v) => !v)}>
                {showAllParts ? "Show fewer" : `Show all ${parts.length} parts`}
              </button>
            }
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
