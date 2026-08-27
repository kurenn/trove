# Changelog

All notable changes to Trove. This project uses [semantic versioning](https://semver.org).
The section for each version becomes that version's GitHub release notes.

## [Unreleased]
### Fixed
- **Search finds what you meant.** Six separate defects in how models are indexed and searched:
  - **Quick Find now matches your words in any order.** It quoted your whole query as one phrase, so "helmet batman" found nothing while "batman helmet" worked. The library search already did this; the two now agree.
  - **Results are ordered by relevance.** Quick Find took an arbitrary 200 matches in database order with no ranking, so on a large library the model you wanted could be dropped for no reason. Matches are now ranked best-first.
  - **Your library's own folder path no longer matches everything.** The full path on disk was indexed, so a library in `~/Dropbox/3D Prints/` made every model match "dropbox" and "prints", burying real results. Only the path inside your library is indexed now — in both Quick Find and the library search.
  - **Models named after a generic subfolder now show their real name.** A model shipped as `Batman Helmet/STLs/*.stl` was listed as "STLs", because the innermost folder holding the files wins. It now walks up to the meaningful folder name.
  - **Project and source files are searchable.** `.blend` files, slicer projects and archives were left out of the Quick Find index entirely, so you couldn't find them by name.
  - **Quick Find was dropping every file match.** A type mismatch reading the search index meant file results were discarded before they reached you — for any query of 3 characters or more, Quick Find could only ever return folders. Fixed.
- **The library search now uses the real search index.** Searching on the Library, Search and Quick Search screens goes through the same index Quick Find uses, so it finds models by **file name** and returns them **best match first** — previously it only matched a model's name, tags, creator, collection and folder, and could not see file names at all.
- **More folder names recognized as containers.** Models shipped inside `Presupported/`, `Supported/`, `Unsupported/`, `FDM/`, `ChiTuBox/`, `GCode/` or `Sliced/` folders now show the model's real name instead of the bucket's.
- **Network libraries are no longer auto-watched on Linux.** The "never watch a share"
  protection added in 2.0.7 was macOS-only, so a NAS indexed on Linux was treated as a
  local folder and watched — the same phantom-event rescan loop that fix was written for.
  Linux now reads the real filesystem type from `/proc/self/mountinfo`, which also catches
  shares mounted through GVFS (a NAS added via Files' "Connect to Server" reports as
  generic FUSE, so a filesystem-magic check would miss it). Libraries already registered
  as watched repair themselves on the next launch. Windows still assumes local.

## [2.1.0]
### Added
- **Buy Me a Coffee** support link — in **Settings → Advanced** and on the project page.
- An instant **boot splash** with an animated logo and rotating loading messages while your library loads, so launching no longer shows a blank window.

### Changed
- **Much faster on large libraries (3,000+ models).** The grid now loads a slim, card-only dataset and fetches a model's full details only when you open it, and the underlying database queries are batched — dramatically cutting first-load time and memory.

### Fixed
- **Search now finds models by their folder name.** A prop or helmet whose STL files (and innermost folder) are generically named is now findable by the descriptive folder that contains it — e.g. searching "Batman Helmet" matches `…/Batman Helmet/part1.stl`. Works in both the library search and Quick Find, and the library search now matches your words in **any order** ("helmet batman" finds "Batman Helmet").
- **List view** now only renders what's on screen (it previously mounted every row, which could freeze big libraries).
- The windowed grid/list now **keeps loading rows as you scroll** instead of stopping after the first screenful.
- **Search and filter counts** no longer rescan the whole library on every keystroke.

## [2.0.9]
### Fixed
- A real model with no renderable mesh (e.g. a Blender `.blend`) now shows its cached thumbnail (or a neutral BLEND tile) in the viewer instead of a misleading procedural placeholder shape.
- Slicer-project `.3mf` files (Bambu/Orca, which reference the mesh externally) showed "Couldn't render a preview" in the 3D viewer; they now fall back to the embedded plate render instead.
- Folders that contain a Blender `.blend` file but no printable mesh are now indexed as models (previously skipped, so the .blend was invisible).

### Added
- `.blend` thumbnail previews now work for Blender's compressed saves (zstd/gzip), not just uncompressed files.

## [2.0.7]
### Added
- Previews now come from embedded thumbnails too: `.3mf` slicer/project files (reliable) and `.blend` files (best-effort), cached locally — so 3mf/blend-only models show a real preview without rendering a mesh.

### Added
- Model detail now has a "Project & source files" section (Blender `.blend`, `.3mf` projects, slicer projects, archives) under the About card, with reveal-in-folder.

### Fixed
- Network-mounted libraries (NAS) are no longer auto-watched — FSEvents over SMB/NFS was firing phantom events that looped the indexer endlessly. They refresh via manual Reindex. No-op rescans are now silent (no "Indexed N" toast unless something changed).

### Changed
- Model detail "Parts" list is capped with its own scroll + a "Show all N parts" toggle, so models with many files no longer turn the page into an endless scroll.


## [2.0.6]
### Fixed
- Libraries now **auto-rebuild once** after a grouping-logic update. Models whose
  printables live in a subfolder (e.g. STLs in an `STLs/` folder) no longer show
  stale or partial files after updating — no manual reindex required.

## [2.0.5]
### Added
- **Live indexing indicator** in the sidebar: file/model counts, a progress bar, a
  "Building previews…" phase, a **Stop** button, and an "Indexed N models" toast
  when a scan finishes — visible from any screen.

## [2.0.4]
### Changed
- **Smarter model grouping.** A model is recognized by its whole folder subtree:
  nested `STLs/` and variant subfolders become parts of one model, any image in the
  subtree becomes its preview, and folders that only contain other models
  (creator/tier folders) expand into one model each. Fixes models fragmenting into
  "STLs"/"Life Sized" entries or going missing entirely.
- The first scan after updating rebuilds the index (model IDs change), so
  thumbnails and collections refresh once.

## [2.0.3]
### Changed
- **Opening a model is instant.** The detail page shows the cached image
  immediately and loads the interactive 3D only when you click **View in 3D** — no
  more waiting on a large mesh to stream from a network share.

## [2.0.2]
### Changed
- **Network libraries are fast to browse.** The scanner caches a downscaled copy of
  each model's image locally, the grid reads only local data, and thumbnails render
  in a background pass — so browsing a NAS no longer streams full-size files on
  every scroll.

## [2.0.1]
- First public release. A self-hosted desktop 3D-print library: read-only folder
  indexing, an in-app 3D viewer (STL / OBJ / 3MF, STEP via WASM), auto-tagging,
  faceted + ⌘K search, a global Quick Find launcher, collections, light/dark,
  background mode, and signed in-app auto-updates.
