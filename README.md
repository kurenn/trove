# Trove

A self-hosted, **desktop** 3D-print model library. Point it at folders of model
files (local or network-mounted) and it indexes them **in place** — never moving,
modifying, uploading, or downloading your files. Browse with a real in-app 3D
viewer, auto-tagging, fast faceted + command-palette search, and a global
Spotlight-style launcher, then jump straight to any model's folder.

Built from the `design_handoff_trove` reference, recreated as a native app.

## Highlights

- **Read-only indexer** — scans your folders with a parallel walker; incremental
  rescans skip unchanged directories. Your files are never touched.
- **Real 3D previews** — Three.js viewer for STL / OBJ / 3MF (STEP via lazy
  `occt-import-js` WASM). Thumbnails render off the main thread in a Web Worker,
  and folder render images (e.g. `Renders/`) are used as previews when present.
- **Quick Find** — a frameless, frosted-glass global launcher (default
  `⌘/Ctrl+Shift+Space`, configurable) that floats over the desktop and searches
  files + folders via an FTS index, with live preview and one-click "open folder".
- **Collections** — group models from anywhere in your library (independent of
  folder structure); rename creators inline.
- **Runs in the background** — closing the main window keeps Trove resident on
  macOS so the global hotkey stays live (click the dock icon to bring it back).
- **Scales** — SQLite/WAL index + on-disk thumbnail cache + a virtualized grid
  keep multi-thousand-model libraries on slow network shares responsive.

## Stack

- **Shell:** Tauri v2 (Rust) — small native bundle, native dialogs + OS handoff
- **Backend:** Rust — `jwalk`/`walkdir` scan, `rusqlite` (SQLite/WAL + FTS5)
  index, `notify` file-watching, `tauri-plugin-global-shortcut`
- **Frontend:** React 18 + TypeScript + Vite + Zustand
- **3D:** Three.js (STL / OBJ / 3MF loaders; STEP via lazy `occt-import-js` WASM)

## Architecture

The native side owns the filesystem (scan, watch, SQLite index, Finder handoff).
The web side owns the UI, Three.js mesh loading, and thumbnail rendering
(offscreen canvas → PNG, cached to disk by Rust). Model files and cached
thumbnails are streamed into the webview via Tauri's asset protocol, not JSON IPC.

The dataset lives in the Zustand store, so the UI runs on mock fixtures in a plain
browser (`npm run dev`) and swaps to the live Rust index under Tauri with no
call-site changes.

```
src/                     React/TS frontend
  data/      types, mock fixtures, reactive dataset helpers
  lib/       store (Zustand), Tauri bridge
  three/     geometries, Viewer3D, mesh loaders, Web Worker, thumbnail generator
  components/ Sidebar, Topbar, SearchModal (⌘K), cards, filters, icons
  screens/   Library, Detail, Search, Collections, Creators, Favorites, Storage, Settings, Setup
  Launcher.tsx  the Quick Find global launcher (its own window)
src-tauri/               Rust backend
  src/index.rs     scan walker, auto-tagging, dataset assembly, commands
  src/db.rs        SQLite schema
  src/watch.rs     debounced file watching
  src/quickfind.rs global shortcut + launcher window control
```

## Install

Grab a build from the [Releases](../../releases) page (macOS `.dmg`), or build it
yourself (below). Trove is unsigned, so on first launch macOS may require
right-click → **Open**.

## Develop

```bash
npm install
npm run dev            # web UI on mock data (http://localhost:1420)
npm run tauri dev      # full desktop app against the real index
```

Dev helpers (gated on `import.meta.env.DEV`):
- Deep-link any screen for QA: `?s=model&id=m4`, `?dark=1`, `?search=1`, `?phase=setup`
- Render a single mesh file: `?mesh=/path.stl&ext=stl`
- Auto-mount a folder at boot: `TROVE_DEV_MOUNT="/path/to/library" npm run tauri dev`
- Replay onboarding: `VITE_FORCE_ONBOARDING=1 npm run tauri dev`

## Build

```bash
npm run tauri build    # → src-tauri/target/release/bundle/ (.app + .dmg on macOS)
```

## Tests

```bash
cd src-tauri && cargo test    # indexer scan, incremental rescan, tagging, helpers
```

## Out of scope for v1

ActivityPub federation and a public library page; the four visual "directions"
from the prototype (ships the Hearth direction only, with light/dark); print-time /
filament estimation (Trove never slices — real models show file-derived facts).

## License

[MIT](LICENSE) © Spoolr.
