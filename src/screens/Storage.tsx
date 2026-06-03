/* Storage.tsx — Libraries (mounted folders) manager.
   Under Tauri it drives the real Rust scanner; in a plain browser it falls back
   to the simulated behavior so the screen still demos. */

import { useEffect, useState } from "react";
import { Icon } from "../components/Icons";
import { useApp } from "../lib/store";
import { isTauri, api, pickFolder } from "../lib/tauri";
import type { Library, LibSourceType, LibStatus, Route } from "../data/types";

const LIB_SOURCES: { id: LibSourceType; ico: string; t: string; d: string }[] = [
  { id: "local", ico: "folder", t: "Local folder", d: "A directory on this machine." },
  { id: "smb", ico: "server", t: "Network share", d: "SMB or NFS over the network." },
];
const libIco = (t: LibSourceType) => (t === "smb" ? "server" : t === "s3" ? "globe" : "folder");
const libType = (t: LibSourceType) => (t === "smb" ? "Network share" : t === "s3" ? "Cloud bucket" : "Local folder");

function StatusPill({ status }: { status: LibStatus }) {
  if (status === "scanning") return <span className="lib-status scanning"><Icon name="refresh" size={13} style={{ animation: "spin 1s linear infinite" }} /> scanning…</span>;
  if (status === "watching") return <span className="lib-status watching"><span className="dot" /> watching</span>;
  if (status === "error") return <span className="lib-status error"><Icon name="info" size={13} /> can't read</span>;
  return <span className="lib-status idle"><span className="dot" /> idle</span>;
}

interface Draft {
  source: LibSourceType;
  path: string;
  organize: boolean;
  tags: boolean;
  thumbs: boolean;
  watch: boolean;
}

const MOCK_LIBS: Library[] = [
  { id: "l1", name: "Main library", type: "local", path: "/srv/3d-models", models: 8, files: 14, status: "watching", last: "2 minutes ago" },
  { id: "l2", name: "NAS archive", type: "smb", path: "//nas.local/prints", models: 4, files: 10, status: "idle", last: "yesterday" },
];

export function StorageScreen({ route }: { route: Extract<Route, { name: "storage" }> }) {
  const toast = useApp((s) => s.toast);
  const refresh = useApp((s) => s.refresh);
  const storeLibs = useApp((s) => s.libraries);

  // In the browser we keep local mock state; under Tauri the store holds real libs.
  const [mockLibs, setMockLibs] = useState<Library[]>(MOCK_LIBS);
  const libs = isTauri ? storeLibs : mockLibs;

  const [adding, setAdding] = useState(!!route.openAdd);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>({ source: "local", path: "", organize: true, tags: true, thumbs: true, watch: true });

  useEffect(() => { if (isTauri) refresh(); }, [refresh]);

  const placeholder = draft.source === "smb" ? "//nas.local/prints" : "/srv/3d-models";

  const browse = async () => {
    const p = await pickFolder();
    if (p) setDraft((d) => ({ ...d, path: p }));
  };

  const mount = async () => {
    if (isTauri) {
      if (!draft.path) { toast("Choose a folder first"); return; }
      setBusy(true);
      try {
        // Returns immediately with the library in 'scanning' state; the walk runs
        // in the background and streams progress via scan-progress events.
        const updated = await api.addLibrary(draft.path, null, {
          organize: draft.organize, tags: draft.tags, thumbs: draft.thumbs, watch: draft.watch,
        });
        useApp.getState().setLibraries(updated);
        toast("Indexing in the background…");
        setAdding(false);
        setDraft((d) => ({ ...d, path: "" }));
      } catch (e) {
        toast(String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    // browser fallback: simulate
    const id = "l" + Date.now();
    setMockLibs((l) => [...l, { id, name: libType(draft.source), type: draft.source, path: draft.path || placeholder, models: 0, files: 0, status: "scanning", last: "now" }]);
    setAdding(false);
    setTimeout(() => {
      setMockLibs((l) => l.map((x) => x.id === id ? { ...x, status: draft.watch ? "watching" : "idle", models: 5, files: 9, last: "just now" } : x));
      toast("Folder mounted · 5 models indexed");
    }, 2600);
  };

  const rescan = async (id: string) => {
    if (isTauri) {
      const updated = await api.rescanLibrary(id);
      useApp.getState().setLibraries(updated);
      toast("Rescanning…");
      return;
    }
    setMockLibs((l) => l.map((x) => x.id === id ? { ...x, status: "scanning" } : x));
    toast("Rescanning…");
    setTimeout(() => setMockLibs((l) => l.map((x) => x.id === id ? { ...x, status: "watching", last: "just now" } : x)), 1800);
  };

  const toggleWatch = async (id: string) => {
    if (isTauri) {
      const lib = libs.find((x) => x.id === id);
      const updated = await api.setWatch(id, lib?.status !== "watching");
      useApp.getState().setLibraries(updated);
      return;
    }
    setMockLibs((l) => l.map((x) => x.id === id ? { ...x, status: x.status === "watching" ? "idle" : "watching" } : x));
  };

  const eject = async (id: string) => {
    if (isTauri) {
      const updated = await api.ejectLibrary(id);
      useApp.getState().setLibraries(updated);
      await refresh();
      toast("Folder ejected");
      return;
    }
    setMockLibs((l) => l.filter((x) => x.id !== id));
    toast("Folder ejected");
  };

  const totalModels = libs.reduce((n, x) => n + x.models, 0);

  return (
    <div className="content-inner fade-in" style={{ maxWidth: 880 }}>
      <div className="page-head">
        <div><h1 className="page-title">Libraries</h1><p className="page-sub">Mounted folders Trove watches &amp; indexes · {libs.length} mounted · {totalModels} models</p></div>
        {!adding && <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={17} /> Mount folder</button>}
      </div>

      {adding && (
        <div className="panel fade-in" style={{ marginBottom: 20 }}>
          <div className="panel-h"><Icon name="folder" size={18} /> Mount a folder</div>
          <p className="muted" style={{ fontSize: 13.5, marginTop: -6, marginBottom: 14 }}>Point Trove at a location. Files are read in place — never moved or modified.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
            {LIB_SOURCES.map((s) => (
              <button key={s.id} className={"source-card" + (draft.source === s.id ? " sel" : "")}
                      style={{ flexDirection: "column", alignItems: "flex-start", gap: 8, padding: 14 }}
                      onClick={() => setDraft((d) => ({ ...d, source: s.id }))}>
                <div className="source-ico"><Icon name={s.ico} size={22} /></div>
                <div><div style={{ fontWeight: 700, fontSize: 14 }}>{s.t}</div><div className="muted" style={{ fontSize: 12 }}>{s.d}</div></div>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <label className="label">{draft.source === "smb" ? "Share path" : "Folder path"}</label>
            <div style={{ display: "flex", gap: 10 }}>
              <input className="input spool-mono" value={draft.path} placeholder={placeholder} onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))} style={{ flex: 1 }} />
              <button className="btn" onClick={browse}>Browse…</button>
            </div>
            {draft.source === "smb" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                <div><label className="label">Username</label><input className="input" placeholder="guest" /></div>
                <div><label className="label">Password</label><input className="input" type="password" placeholder="••••" /></div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 16 }}>
            {([["organize", "Auto-organize"], ["tags", "Smart tags"], ["thumbs", "3D thumbnails"], ["watch", "Watch for changes"]] as const).map(([k, t]) => (
              <label key={k} className="check" style={{ fontSize: 13.5, color: "var(--ink)" }}>
                <input type="checkbox" checked={draft[k]} onChange={() => setDraft((d) => ({ ...d, [k]: !d[k] }))} />
                <span className="box"><Icon name="check" size={13} /></span>{t}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
            <button className="btn" onClick={() => setAdding(false)} disabled={busy}>Cancel</button>
            <button className="btn btn-primary" onClick={mount} disabled={busy}>
              {busy ? <><Icon name="refresh" size={16} style={{ animation: "spin 1s linear infinite" }} /> Scanning…</> : <><Icon name="server" size={16} /> Mount &amp; scan</>}
            </button>
          </div>
        </div>
      )}

      {libs.length === 0 && !adding && (
        <div className="empty">
          <Icon name="server" size={36} style={{ opacity: 0.4 }} />
          <p style={{ marginTop: 12, fontWeight: 600 }}>No folders mounted</p>
          <p style={{ fontSize: 13 }}>Mount a folder to start indexing your models.</p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {libs.map((lib) => (
          <div key={lib.id} className="lib-card fade-in">
            <div className="source-ico" style={{ width: 46, height: 46 }}><Icon name={libIco(lib.type)} size={22} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="list-name">{lib.name}</span>
                <StatusPill status={lib.status} />
              </div>
              <div className="file-sub" style={{ marginTop: 3 }}>{libType(lib.type)} · {lib.path}</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 6, display: "flex", gap: 16 }}>
                <span><Icon name="cube" size={13} style={{ verticalAlign: "-2px" }} /> {lib.models} models</span>
                <span>{lib.files} files</span>
                <span className="faint">scanned {lib.last}</span>
              </div>
              {lib.status === "error" && (
                <div className="muted" style={{ fontSize: 12, marginTop: 6, color: "#b5604f" }}>
                  Couldn't read this folder. On macOS, grant Trove access under System Settings → Privacy &amp; Security → Files and Folders (or Full Disk Access) for external/network volumes, then Rescan.
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button className="btn btn-sm" disabled={lib.status === "scanning"} onClick={() => rescan(lib.id)}><Icon name="refresh" size={15} /> Rescan</button>
              <button className="btn btn-sm" onClick={() => toggleWatch(lib.id)} title="Toggle watch"><Icon name={lib.status === "watching" ? "eye" : "eyeOff"} size={15} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => eject(lib.id)} title="Eject"><Icon name="trash" size={15} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="autotag-banner" style={{ marginTop: 18 }}>
        <Icon name="info" size={17} /> Trove indexes files in place. Ejecting a folder removes it from the library but never deletes your files.
      </div>
    </div>
  );
}
