/* Launcher.tsx — Trove Quick Find: the global, frosted-glass launcher rendered
   in its own transparent always-on-top window. Searches the real index via the
   FTS-backed quick_search command, with a live preview and real file actions. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, TroveMark } from "./components/Icons";
import { Thumb } from "./three/Viewer";
import { useApp, inkFor } from "./lib/store";
import { api, isTauri, openPath, revealInManager, copyText, loadConvert } from "./lib/tauri";
import { MOCK_DATASET } from "./data/mock";
import type { QuickFile, QuickFolder, QuickResults, GeometryKey } from "./data/types";

const fmtSize = (b: number) => (b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " KB");

/** Browser-dev mock of quick_search over MOCK_DATASET (so the launcher previews
    without a Tauri backend). The real path uses the FTS-backed command. */
function mockQuickSearch(query: string): QuickResults {
  const q = query.trim().toLowerCase();
  const S = MOCK_DATASET;
  const allFiles: QuickFile[] = S.MODELS.flatMap((m) =>
    m.files.map((f) => ({
      name: f.name, type: f.type, size: f.size,
      path: `${m.folder}/${f.name}`, modelId: m.id, modelName: m.name,
      color: m.color, geometry: m.geometry, thumb: m.thumb,
    })));
  const toFolder = (m: typeof S.MODELS[number]): QuickFolder => ({
    id: m.id, name: m.name, color: m.color, geometry: m.geometry, thumb: m.thumb,
    folder: m.folder, files: m.files.length,
    fileTypes: [...new Set(m.files.map((f) => f.type))], tags: m.tags,
  });
  if (!q) {
    return {
      files: allFiles.filter((f) => f.type === "stl").slice(0, 4),
      folders: S.MODELS.slice(0, 3).map(toFolder),
    };
  }
  const files = allFiles.filter((f) => f.name.toLowerCase().includes(q))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) || Number(b.type === "stl") - Number(a.type === "stl"))
    .slice(0, 7);
  const folders = S.MODELS.filter((m) => m.name.toLowerCase().includes(q) || m.tags.some((t) => t.includes(q))).slice(0, 5).map(toFolder);
  return { files, folders };
}

function HL({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<span className="lz-hl">{text.slice(i, i + q.length)}</span>{text.slice(i + q.length)}</>;
}

type Flat =
  | { k: "file"; item: QuickFile }
  | { k: "folder"; item: QuickFolder };

export function Launcher() {
  const dark = useApp((s) => s.tweaks.dark);
  const accent = useApp((s) => s.tweaks.accent);

  const [query, setQuery] = useState(
    import.meta.env.DEV ? new URLSearchParams(window.location.search).get("q") || "" : ""
  );
  const [results, setResults] = useState<QuickResults>({ files: [], folders: [] });
  const [sel, setSel] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const convRef = useRef<((p: string) => string) | null>(null);

  const q = query.trim().toLowerCase();
  const skin = dark ? "dark" : "warm";

  // Mark the window transparent (no data-theme → no opaque var(--bg) body fill;
   // the launcher gets its colors from the glass skin, not the app theme).
  useEffect(() => {
    document.documentElement.classList.add("lz-window");
    loadConvert().then((c) => { convRef.current = c; });
    const t = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(t);
  }, []);

  // Debounced search (FTS-backed under Tauri; mock over MOCK_DATASET in the browser).
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (!isTauri) { setResults(mockQuickSearch(query)); setSel(0); return; }
      api.quickSearch(query).then((r) => { if (!cancelled) { setResults(r); setSel(0); } }).catch(() => {});
    }, 70);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const flat: Flat[] = useMemo(() => [
    ...results.files.map((f): Flat => ({ k: "file", item: f })),
    ...results.folders.map((f): Flat => ({ k: "folder", item: f })),
  ], [results]);
  const cur = flat[sel] || flat[0] || null;

  const showToast = (msg: string) => { setToast(msg); window.clearTimeout((window as any).__lzT); (window as any).__lzT = window.setTimeout(() => setToast(null), 1800); };
  const dismiss = () => { api.hideLauncher(); };

  const doOpenFile = async (f: QuickFile) => { try { await openPath(f.path); } catch { /* */ } dismiss(); };
  const doRevealFile = async (f: QuickFile) => { try { await revealInManager(f.path); } catch { /* */ } dismiss(); };
  // Open the folder itself (show its contents) — NOT revealItemInDir, which
  // would select it inside its parent (looks like "opens the parent folder").
  const doOpenFolder = async (f: QuickFolder) => { try { if (f.folder) await openPath(f.folder); } catch { /* */ } dismiss(); };
  const doCopy = async (p: string) => { try { await copyText(p); } catch { /* */ } showToast("Path copied"); };
  const openCur = () => { if (!cur) return; if (cur.k === "file") doOpenFile(cur.item); else doOpenFolder(cur.item); };

  // Focus on mount + when re-summoned; reset query on summon.
  useEffect(() => {
    inputRef.current?.focus();
    let un: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen("launcher-show", () => { setQuery(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); })
        .then((fn) => { un = fn; })
    );
    // Hide when the window loses focus (standard launcher behavior).
    let unFocus: (() => void) | undefined;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().onFocusChanged(({ payload: focused }) => { if (!focused) api.hideLauncher(); })
        .then((fn) => { unFocus = fn; });
    });
    return () => { un?.(); unFocus?.(); };
  }, []);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); dismiss(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(flat.length - 1, s + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); openCur(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, sel, cur]);

  const thumbUrl = (raw?: string) => (raw && convRef.current ? convRef.current(raw) : undefined);

  let idx = -1;
  const showingFiles = results.files.length > 0;
  const showingFolders = results.folders.length > 0;

  return (
    <div className={"lz lz-standalone" + (open ? " open" : "")} data-skin={skin}
         style={{ ["--accent" as any]: accent, ["--accent-ink" as any]: inkFor(accent) }}>
      {/* dim + blur the real desktop behind the transparent overlay; click = dismiss */}
      <div className="lz-scrim" onMouseDown={dismiss} />
      <div className="lz-wrap">
      <div className="lz-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="lz-search">
          <Icon name="search" size={24} className="mag" />
          <input ref={inputRef} className="lz-input" value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="Search your library — files, folders, tags" aria-label="Quick find" />
          <span className="lz-esc">esc</span>
        </div>

        <div className="lz-body">
          <div className="lz-results">
            {flat.length === 0 && (
              <div className="lz-noresult"><Icon name="search" size={28} style={{ opacity: 0.4 }} />
                <p style={{ marginTop: 10, fontWeight: 600 }}>{q ? `No matches for “${query}”` : "Start typing to search"}</p>
              </div>
            )}
            {showingFiles && <div className="lz-sect">{q ? "Files" : "Recent STL files"}</div>}
            {results.files.map((x) => { idx++; const i = idx; return (
              <button key={x.path} className={"lz-row" + (i === sel ? " active" : "")}
                      onMouseEnter={() => setSel(i)} onClick={() => setSel(i)} onDoubleClick={() => doOpenFile(x)}>
                <span className="lz-ftype" style={{ background: x.color }}>{x.type}</span>
                <span className="grow">
                  <div className="nm mono"><HL text={x.name} q={q} /></div>
                  <div className="sub"><Icon name="folder" size={12} style={{ opacity: 0.6 }} /> {x.modelName} · {fmtSize(x.size)}</div>
                </span>
              </button>
            ); })}
            {showingFolders && <div className="lz-sect">Folders</div>}
            {results.folders.map((m) => { idx++; const i = idx; return (
              <button key={m.id} className={"lz-row" + (i === sel ? " active" : "")}
                      onMouseEnter={() => setSel(i)} onClick={() => setSel(i)} onDoubleClick={() => doOpenFolder(m)}>
                <span className="lz-folder-ico" style={{ background: m.color }}><Icon name="folder" size={19} /></span>
                <span className="grow">
                  <div className="nm"><HL text={m.name} q={q} /></div>
                  <div className="sub">{m.files} file{m.files === 1 ? "" : "s"}{m.tags.length ? " · " + m.tags.slice(0, 2).join(", ") : ""}</div>
                </span>
                <Icon name="chevronRight" size={16} style={{ opacity: 0.4 }} />
              </button>
            ); })}
          </div>

          <div className="lz-preview">
            {cur ? (
              cur.k === "file" ? (
                <>
                  <div className="lz-pv-thumb" style={{ background: `radial-gradient(120% 100% at 50% 18%, ${cur.item.color}33, ${cur.item.color}11)` }}>
                    <Thumb geometry={cur.item.geometry as GeometryKey} color={cur.item.color} preview={thumbUrl(cur.item.preview)} thumb={thumbUrl(cur.item.thumb)} real={isTauri} />
                    <span className="lz-pv-badge">{cur.item.type}</span>
                  </div>
                  <div className="lz-pv-name"><HL text={cur.item.name} q={q} /></div>
                  <div className="lz-pv-path"><Icon name="folder" size={13} style={{ opacity: 0.6 }} /> {cur.item.path}</div>
                  <div className="lz-pv-meta">
                    <div><div className="k">Type</div><div className="v">{cur.item.type.toUpperCase()}</div></div>
                    <div><div className="k">Size</div><div className="v">{fmtSize(cur.item.size)}</div></div>
                    <div style={{ gridColumn: "1 / -1" }}><div className="k">Folder</div><div className="v" style={{ fontSize: 12 }}>{cur.item.modelName}</div></div>
                  </div>
                  <div className="lz-pv-spacer" />
                  <div className="lz-actions">
                    <button className="lz-btn primary" onClick={() => doOpenFile(cur.item)}><Icon name="printer" size={16} /> Open</button>
                    <button className="lz-btn lz-iconbtn" title="Reveal in folder" onClick={() => doRevealFile(cur.item)}><Icon name="folder" size={16} /></button>
                    <button className="lz-btn lz-iconbtn" title="Copy path" onClick={() => doCopy(cur.item.path)}><Icon name="link" size={16} /></button>
                  </div>
                </>
              ) : (
                <>
                  <div className="lz-pv-thumb" style={{ background: `radial-gradient(120% 100% at 50% 18%, ${cur.item.color}33, ${cur.item.color}11)` }}>
                    <Thumb geometry={cur.item.geometry as GeometryKey} color={cur.item.color} preview={thumbUrl(cur.item.preview)} thumb={thumbUrl(cur.item.thumb)} real={isTauri} />
                    <span className="lz-pv-badge">{cur.item.files} files</span>
                  </div>
                  <div className="lz-pv-name" style={{ fontFamily: "var(--font-display)" }}><HL text={cur.item.name} q={q} /></div>
                  <div className="lz-pv-path"><Icon name="folder" size={13} style={{ opacity: 0.6 }} /> {cur.item.folder}</div>
                  <div className="lz-pv-meta">
                    <div><div className="k">Files</div><div className="v">{cur.item.fileTypes.join(", ").toUpperCase()}</div></div>
                    <div><div className="k">Count</div><div className="v">{cur.item.files}</div></div>
                  </div>
                  {cur.item.tags.length > 0 && (
                    <div className="lz-pv-tags">{cur.item.tags.slice(0, 5).map((tg) => <span key={tg} className="lz-pv-tag">{tg}</span>)}</div>
                  )}
                  <div className="lz-pv-spacer" />
                  <div className="lz-actions">
                    <button className="lz-btn primary" onClick={() => doOpenFolder(cur.item)}><Icon name="folder" size={16} /> Open folder</button>
                    <button className="lz-btn lz-iconbtn" title="Copy path" onClick={() => doCopy(cur.item.folder)}><Icon name="link" size={16} /></button>
                  </div>
                </>
              )
            ) : (
              <div className="lz-pv-empty"><Icon name="cube" size={34} style={{ opacity: 0.35 }} /><p style={{ marginTop: 12, fontWeight: 600 }}>Type to search<br />your 3D library</p></div>
            )}
          </div>
        </div>

        <div className="lz-foot">
          <span className="keys"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> dismiss</span></span>
          <span className="ct">{flat.length} result{flat.length === 1 ? "" : "s"}</span>
        </div>
      </div>
      </div>

      {toast && <div className="lz-toast"><Icon name="check" size={16} /> {toast}</div>}
      <span style={{ position: "fixed", top: -999 }} aria-hidden><TroveMark size={1} /></span>
    </div>
  );
}
