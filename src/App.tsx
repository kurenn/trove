/* App.tsx — root: phase + routing, theme wiring, ⌘K, toast, shell. */

import { useEffect, useRef } from "react";
import { Icon } from "./components/Icons";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { SearchModal } from "./components/SearchModal";
import { Viewer3D } from "./three/Viewer";
import { LibraryScreen } from "./screens/Library";
import { SearchScreen } from "./screens/Search";
import { FavoritesScreen } from "./screens/Favorites";
import { CollectionsScreen, CollectionDetail } from "./screens/Collections";
import { CreatorsScreen, CreatorDetail } from "./screens/Creators";
import { DetailScreen } from "./screens/Detail";
import { StorageScreen } from "./screens/Storage";
import { SettingsScreen } from "./screens/Settings";
import { SetupWizard } from "./screens/Setup";
import { UpdateBanner } from "./components/UpdateBanner";
import { modelById } from "./data/dataset";
import { useApp, inkFor } from "./lib/store";
import { isTauri } from "./lib/tauri";
import { checkForUpdate } from "./lib/updater";

// Dev-only: render a single mesh file fullscreen (for headless QA screenshots).
function MeshTest({ mesh, ext }: { mesh: string; ext: string }) {
  return <Viewer3D geometry="cube" color="#c2693d" mode="rotate" autoRotate={false} filePath={mesh} fileExt={ext} />;
}

function Screen() {
  const route = useApp((s) => s.route);
  const nav = useApp((s) => s.nav);
  switch (route.name) {
    case "library": return <LibraryScreen />;
    case "search": return <SearchScreen route={route} />;
    case "favorites": return <FavoritesScreen />;
    case "collections": return <CollectionsScreen />;
    case "collection": return <CollectionDetail id={route.id} />;
    case "creators": return <CreatorsScreen />;
    case "creator": return <CreatorDetail id={route.id} />;
    case "model": {
      const m = modelById(route.id);
      if (!m) { nav({ name: "library" }); return null; }
      return <DetailScreen model={m} />;
    }
    case "storage": return <StorageScreen route={route} />;
    case "settings": return <SettingsScreen />;
    default: return <LibraryScreen />;
  }
}

export default function App() {
  const phase = useApp((s) => s.phase);
  const setPhase = useApp((s) => s.setPhase);
  const route = useApp((s) => s.route);
  const nav = useApp((s) => s.nav);
  const tweaks = useApp((s) => s.tweaks);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const setSidebarOpen = useApp((s) => s.setSidebarOpen);
  const setSearchOpen = useApp((s) => s.setSearchOpen);
  const toastMsg = useApp((s) => s.toastMsg);
  const contentRef = useRef<HTMLDivElement>(null);

  // apply theme tokens to <html>
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = tweaks.dark ? "dark" : "light";
    el.dataset.direction = "hearth";
    el.style.setProperty("--accent", tweaks.accent);
    el.style.setProperty("--accent-ink", inkFor(tweaks.accent));
  }, [tweaks]);

  // Under Tauri, load the real index on boot and refresh when the file watcher
  // reports a change in any mounted folder.
  useEffect(() => {
    if (!isTauri) return;
    useApp.getState().refresh();
    // Silent auto-check for a newer signed release; surfaces a dismissible banner.
    checkForUpdate().then((v) => { if (v) useApp.getState().setUpdateVersion(v); }).catch(() => {});
    // Reflect the backend-registered Quick Find shortcut in the UI.
    import("./lib/tauri").then(({ api }) =>
      api.getQuickfindShortcut().then((acc) => { if (acc) useApp.setState({ quickfindShortcut: acc }); }).catch(() => {})
    );
    const unlisteners: Array<() => void> = [];
    // Throttle refreshes: a big scan emits dataset-changed often, and each
    // refresh rebuilds the whole dataset (holding the DB lock). Coalesce to
    // ~1/sec with a trailing call so the final state always lands.
    let lastRefresh = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const throttledRefresh = () => {
      const since = Date.now() - lastRefresh;
      clearTimeout(refreshTimer);
      if (since >= 1000) { lastRefresh = Date.now(); useApp.getState().refresh(); }
      else { refreshTimer = setTimeout(() => { lastRefresh = Date.now(); useApp.getState().refresh(); }, 1000 - since); }
    };
    import("@tauri-apps/api/event").then(async ({ listen }) => {
      unlisteners.push(await listen("dataset-changed", throttledRefresh));
      // Live per-library scan progress (counts + status) without a full reload.
      unlisteners.push(await listen("scan-progress", (e) => {
        const p = e.payload as import("./lib/store").ScanProgress;
        useApp.getState().applyScanProgress(p);
      }));
    });
    return () => { unlisteners.forEach((fn) => fn()); };
  }, []);

  // Fade out the instant boot splash (index.html) once the first dataset is ready
  // — instantly in the browser/mock, after the first index load under Tauri. A
  // safety timeout guarantees we never strand the user behind it.
  useEffect(() => {
    const boot = document.getElementById("boot");
    if (!boot) return;
    let done = false;
    const remove = () => {
      if (done) return;
      done = true;
      boot.classList.add("is-hidden");
      setTimeout(() => boot.remove(), 320);
    };
    if (useApp.getState().ready) { remove(); return; }
    const unsub = useApp.subscribe((s) => { if (s.ready) remove(); });
    const safety = setTimeout(remove, 15000);
    return () => { unsub(); clearTimeout(safety); };
  }, []);

  // scroll content to top on route change
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; }, [route]);

  // Dev-only deep-link (for screenshots / QA): ?s=model&id=m4&dark=1&search=1&phase=setup
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const p = new URLSearchParams(window.location.search);
    // Idempotent direct sets (StrictMode double-invokes this effect in dev).
    if (p.get("dark") === "1") useApp.setState((s) => ({ tweaks: { ...s.tweaks, dark: true } }));
    if (p.get("phase") === "setup") setPhase("setup");
    if (p.get("onboarded") === "1") setPhase("app"); // skip onboarding for QA/screenshots
    const s = p.get("s");
    if (s) {
      const id = p.get("id") || "";
      nav({ name: s as never, id } as never);
    }
    if (p.get("search") === "1") setSearchOpen(true);
    // Dev-only: preview the sidebar indexing indicator (?scan=scanning|previews).
    const sc = p.get("scan");
    if (sc) useApp.setState({ scan: { libId: "dev", phase: sc, files: 1240, models: 86 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌘K / Ctrl-K → palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (phase === "app") setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, setSearchOpen]);

  // Dev-only mesh loader test: ?mesh=/sample-cube.stl&ext=stl
  if (import.meta.env.DEV) {
    const p = new URLSearchParams(window.location.search);
    const mesh = p.get("mesh");
    if (mesh) {
      const ext = p.get("ext") || mesh.split(".").pop() || "stl";
      return (
        <div style={{ width: "100vw", height: "100vh", background: "var(--surface-2)" }}>
          <div className="viewer-stage" style={{ position: "absolute", inset: 0, aspectRatio: "auto" }}>
            <MeshTest mesh={mesh} ext={ext} />
          </div>
        </div>
      );
    }
  }

  if (phase === "setup") {
    return (
      <SetupWizard
        onDone={(name) => useApp.getState().completeOnboarding(name)}
        onSkip={() => useApp.getState().skipOnboarding()}
      />
    );
  }

  return (
    <>
      <div className="app-bg" />
      <div className="app-shell">
        <div className={"scrim" + (sidebarOpen ? " show" : "")} onClick={() => setSidebarOpen(false)} />
        <Sidebar />
        <div className="main-col">
          <Topbar />
          <UpdateBanner />
          <div className="content" ref={contentRef}><Screen /></div>
        </div>
      </div>
      <SearchModal />
      {toastMsg && <div className="toast fade-in"><Icon name="check" size={17} style={{ color: "var(--accent)" }} /> {toastMsg}</div>}
    </>
  );
}
