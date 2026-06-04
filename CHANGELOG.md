# Changelog

All notable changes to Trove. This project uses [semantic versioning](https://semver.org).
The section for each version becomes that version's GitHub release notes.

## [Unreleased]

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
