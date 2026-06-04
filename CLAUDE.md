# CLAUDE.md — Trove

Trove is a self-hosted, cross-platform **desktop** app: a 3D-print model library. It
indexes folders of model files **in place** — strictly **read-only**, never moving,
modifying, uploading, or downloading the user's files — and shows them in an in-app
3D viewer with search, auto-tagging, collections, and a global Quick Find launcher.

Public: **github.com/kurenn/trove** · site **trove.spoolr.io** · MIT.

## Commands
```bash
npm install
npm run dev                 # web UI on mock data → http://localhost:1420
npm run tauri dev           # full desktop app against the real Rust index
TROVE_DEV_MOUNT="/path" npm run tauri dev   # auto-mount a folder for testing
cd src-tauri && cargo test  # indexer: grouping, incremental rescan, tagging
npx tsc --noEmit            # typecheck the frontend
npm run tauri build         # bundle (.app/.dmg, .msi, .AppImage…) — ask before releasing
```
Data lives at `~/Library/Application Support/io.spoolr.trove/trove.db`; thumbnail cache at
`~/Library/Caches/io.spoolr.trove/thumbs`. (Both shared by dev + the installed app — see DANGER below.)

## Stack
- **Shell:** Tauri v2. Two windows: `main` + a transparent always-on-top `launcher`
  (needs `app.macOSPrivateApi: true` + the `macos-private-api` cargo feature).
- **Backend:** Rust — `jwalk`/`walkdir` scan, `rusqlite` (SQLite WAL + FTS5 trigram),
  `notify` watcher, `image`/`zip`/`zstd`/`flate2` for thumbnails, plugins
  `opener` / `dialog` / `global-shortcut` / `updater` / `process`.
- **Frontend:** React 18 + TypeScript + Vite + Zustand. Three.js (STL / OBJ / 3MF;
  STEP via lazy `occt-import-js` WASM). STL/OBJ parse off-thread in a Web Worker.

## Architecture — the core idea
- **Native owns the filesystem** (scan, watch, SQLite index, OS handoff). **Web owns
  the UI + 3D + thumbnail rendering.** Model files & cached thumbnails stream into the
  webview via Tauri's **asset protocol** (`convertFileSrc`), not JSON IPC.
- **The dataset lives in the Zustand store**, so the UI runs on **mock fixtures** in a
  plain browser (`npm run dev`) and swaps to the **live Rust index** under Tauri with
  no call-site changes. Build/verify UI in the browser; verify real behavior in Tauri.
- **Browsing must be 100% local** — SQLite (metadata) + a local downscaled-image cache.
  NEVER stream full-resolution originals or meshes off a (network) share while browsing.

## Repo layout
- `src/` — `data/` (types, mock, dataset helpers) · `lib/` (Zustand store, tauri bridge,
  updater) · `three/` (Viewer3D, mesh worker, thumbs) · `components/` · `screens/` ·
  `Launcher.tsx` (Quick Find window).
- `src-tauri/src/` — `index.rs` (scan, grouping, dataset assembly, commands) · `db.rs`
  (schema) · `watch.rs` (file watching) · `quickfind.rs` (global shortcut + launcher
  window) · `lib.rs` (plugin registration, window events, run loop).

## Conventions & best practices (this codebase)
**Rust / Tauri**
- Read-only: never write inside a user's library. Cache → `app_cache_dir`; DB → `app_data_dir`.
- Scans run on a **background thread holding NO DB lock** during the walk; writes go in
  short batched transactions (lock released between). The DB mutex is global — long work
  under it freezes the whole app.
- Two-phase scan: `collect_tree` (parallel) → `group_models` → incremental upsert. A
  **model** = the shallowest directory holding a "model file" (printable OR `.blend`);
  a directory of only subfolders is a **container** (creator/tier). Bump `SCAN_VERSION`
  when grouping logic changes (forces a one-time rebuild on next scan).
- **Network mounts (SMB/NFS): never auto-watch** — FSEvents over SMB fires phantom
  events that loop the scanner. Detect via `statfs` (`is_network_path`).
- Thumbnails: downscale folder images + extract embedded thumbnails from `.3mf` (zip →
  `Metadata/plate_*.png`) and `.blend` (TEST block; handles zstd/gzip). Bound file reads
  (don't slurp a 400 MB blend). Cache as local JPEG; the grid only ever shows local.
- **opener gotcha:** `open_path`/`open_url` are scope-gated — the capability needs
  explicit `allow` path entries; `reveal_item_in_dir` is NOT gated.
- Mutating commands (rename creator, collection edits) return the rebuilt `Dataset`.

**React / TS / Zustand**
- Per-id `thumbs` map so one thumbnail completion re-renders only its card.
- Grid is **cache-only** (`thumb`/live), never the remote original; virtualize >150 cards.
- **Procedural geometry is ONLY for mock/browser data.** A real on-disk model with no
  renderable mesh shows its cached thumbnail or a neutral tile — never a misleading shape.
- Detail viewer: instant **poster** (cached image) + **"View in 3D"** loads the mesh on
  demand; on load failure, fall back to the cached image (slicer `.3mf` can't render).

**Verification**
- Browser/mock UI: local headless Chrome (`--headless=new --enable-unsafe-swiftshader`)
  + DEV deep-links (`?onboarded=1&s=model&id=…`, `?dark=1`, `?scan=scanning|previews`).
  The cloud browser-harness CANNOT reach `localhost`.
- You CANNOT headless-screenshot the native Tauri window — verify Tauri behavior via the
  DB + stderr logs + `TROVE_DEV_MOUNT="/path" npm run tauri dev`.
- **DANGER:** `npm run tauri dev` and the installed app share the SAME data dir
  (`io.spoolr.trove`). Deleting `trove.db` in a test WIPES the user's real library. Don't
  `rm` the prod DB casually — use a throwaway mount and warn the user.

## Releasing — ASK FIRST
- **Never build, tag, or publish a release without asking the user.** (Standing preference.)
- Cut a release: add a `## [x.y.z]` section to `CHANGELOG.md`; bump the version in
  `tauri.conf.json` + `package.json` + `Cargo.toml` (+ `cargo update -p trove --precise x.y.z`);
  commit; `git tag vX.Y.Z && git push origin vX.Y.Z`.
- CI (`.github/workflows/release.yml`) is **two-job** (create-release once → matrix uploads
  via `releaseId`) to avoid the multi-job create race. Release notes are auto-built from the
  CHANGELOG section + `.github/release-footer.md`; the notes step needs `shell: bash`
  (Windows runners default to PowerShell). The repo Actions token must be **write**.
- CI publishes a **draft**; go live with `gh release edit vX.Y.Z --draft=false --latest`
  — only after the user OKs. Signed updater artifacts + `latest.json` are produced
  automatically (signing keys live in repo Actions secrets — losing them breaks updates).
- macOS builds are **unnotarized** → "damaged" on download; document
  `xattr -dr com.apple.quarantine /Applications/Trove.app`. Real fix = notarization (paid).

## The learning loop — run this on every task
Before calling a piece of work "done," do one **rate → improve → re-rate** pass:
1. **Rate v1 (1–10)** across: **Correctness**, **UX/clarity**, **Robustness** (edge cases),
   **Code fit** (matches surrounding patterns), **Performance**. Call out the weakest.
2. **Improve** — one focused pass addressing the weakest dimension(s). One solid pass; don't gold-plate.
3. **Re-rate v2** and report the delta, e.g.
   *"Parts list 6/10 → 8/10 — added a contained scroll + cap so big models don't blow out the page (Robustness/UX)."*
Keep it honest and brief — the goal is a visible, compounding quality bump, not ceremony.
If v1 is already strong (≥8) and improving isn't worth it, say so and skip the second pass.
