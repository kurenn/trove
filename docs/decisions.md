# Decisions

Architecture and product decisions, with the reasoning and what was rejected.

`CLAUDE.md` says *what* the conventions are. This file says *why*, what we turned
down, and what we're still unsure about — the things that are expensive to
re-derive in six months and invisible in a diff.

**Entry format.** Newest first.

```
## YYYY-MM-DD — <the decision, stated as a claim>
**Decision:** what we do now.
**Because:** the forcing reason. Name the failure it avoids.
**Rejected:** the alternatives and why they lost. This field is the point —
an entry without it degrades into a list of things we like.
**Unsure about:** open doubt. Blank is suspicious; most decisions have some.
**Affects:** the surface it constrains.
```

Supersede rather than delete: write a new entry and say which one it replaces.

---

## 2026-08-31 — Thumbnails are generated natively at index time, not rendered lazily in the webview

**Decision:** the Rust scan rasterizes STL previews as a third pass in
`generate_image_thumbs`, alongside folder-image downscaling and `.3mf`/`.blend`
embedded extraction. The webview's Three.js renderer stays only as the OBJ fallback.
**Because:** the lazy path had produced **zero** thumbnails on a real 4,790-model
library. It fires only when a card scrolls into view, must `fetch()` the whole mesh
over SMB (9.4 GB total, largest single file 335 MB), and marks a model `attempted`
*before* rendering — so one transient failure blanks that card until the app restarts.
It also directly contradicted CLAUDE.md's "never stream meshes off a network share
while browsing."
**Rejected:** fixing the webview path in place (a size cap, retry on failure, a bigger
in-flight budget) — all of it still pulls full meshes across the network at browse
time, which is the thing the architecture forbids. Also rejected: storing images as
SQLite blobs; `thumb` stays a path into `app_cache_dir`.
**Unsure about:** 3MF-only models with no embedded plate image (9 on the real library)
still get nothing — closing that means rendering 3MF geometry, not just reading its
metadata.
**Affects:** `src-tauri/src/thumbgen.rs`, the third pass in `index.rs`,
`src/three/thumbs.ts` (now OBJ-only in practice).

## 2026-08-31 — No triangle decimation, ever

**Decision:** every triangle contributes to both the bounding box and the raster. Large
meshes are handled by streaming, never by sampling.
**Because:** a z-buffer is `O(size²)` — memory is bounded by the raster target, not the
mesh — so decimation was solving a problem that did not exist, and it cost the
silhouette. Keeping every Nth triangle paints ~`1/stride` of the shape: measured on a
UV sphere, 30.6% coverage at 1M triangles and **5.9% at 6.7M**. A 335 MB model rendered
as scattered dots on near-white, which CLAUDE.md rules out ("never a misleading shape").
**Rejected:** stride sampling above a `MAX_TRIS` budget — this was the original plan,
withdrawn after measurement. Also rejected: reservoir or spatially-aware sampling, which
would preserve components but is strictly more code than not sampling at all.
**Unsure about:** there is still no aggregate pixel-work budget, so a pathological mesh
(many overlapping frame-spanning triangles) can occupy a scan thread for a long time.
Cancellation is checked every 64k triangles, which bounds it loosely, not tightly.
**Affects:** `thumbgen.rs` — `stream_bbox`, `stream_binary`, `stream_ascii`.

## 2026-08-31 — One always-stream path, not a dual in-memory/streaming design

**Decision:** every STL is read by streaming twice — once to accumulate the bounding
box, once to rasterize. There is no separate small-file path.
**Because:** the dual design existed to save a second read on small files, but ASCII STL
carries no length field, so *choosing* the path required a full streaming vertex count
first. Real cost was binary 1–2 reads and **ASCII 2–3** — the optimization was a
pessimization for one of its two formats, over the exact network share it was meant to
spare. Collapsing it also deleted ~60–70 lines.
**Rejected:** keeping an in-memory path for ≤200k triangles — the saved read only ever
applied to small *binary* files, and a file just read is likely still in the page cache.
**Unsure about:** whether two passes over a 335 MB file on a cold SMB mount is
noticeably worse than one; it was never measured against a real slow share.
**Affects:** `thumbgen.rs::render_stl_thumb` and `detect`.

## 2026-08-31 — A failed render writes nothing at all

**Decision:** `render_stl_thumb` returns `None` when the rasterized image is uniformly
background, and the pass then writes neither a file nor a DB row.
**Because:** presence of `models.thumb` is the "already done" signal for *both* the Rust
candidate query (`thumb IS NULL OR thumb=''`) and the webview's `requestThumb`
(`if (m.thumb) return`). A persisted blank is therefore permanent — no rescan
regenerates it and no fallback fires. This is not theoretical: a real 128 MB file on the
test library has junk vertices at ±3.4e38 mixed into valid geometry, which blows the
bbox out and pushes every real triangle sub-pixel.
**Rejected:** writing the blank and relying on a later pass to notice — nothing
distinguishes "blank because it failed" from "blank because that's the model" once the
bytes are on disk.
**Unsure about:** a mesh that legitimately rasterizes to near-nothing (an extremely thin
plate viewed edge-on) would also be declined. No such case observed, but the guard can't
tell them apart.
**Affects:** `thumbgen.rs` blank check, and any future cache keyed on presence-of-value.

## 2026-08-31 — The rasterizer is hand-written; no new dependency

**Decision:** ~430 lines of orthographic z-buffer rasterizer in `thumbgen.rs`, drawing
into an `image::RgbImage`. `image` stays `default-features = false` with codecs only.
**Because:** the crate is already present for encode/decode, and a flat-shaded preview
at 512px needs a triangle loop and a depth buffer — not a rendering library. Pulling one
in would add build time, a supply-chain surface, and a transitive tree, to an app whose
selling point is that it touches nothing it doesn't have to.
**Rejected:** a software renderer crate (`tiny-skia`, `euc`, `raqote`) — less code to
write, more code to trust and maintain. Also rejected: reusing the webview's WebGL
renderer from Rust, which reintroduces the dependency on browsing that this whole change
removes.
**Unsure about:** quality ceiling. It is flat-shaded with a fixed key light and a neutral
material, versus the webview's PBR and per-part colour. Fine while every tile on the
grid comes from this path; revisit if the two ever render side by side.
**Affects:** `thumbgen.rs`, `src-tauri/Cargo.toml` (unchanged, deliberately).

## 2026-08-31 — Network mounts are detected by mount type, never by `statfs` magic

**Decision:** on Linux, `is_network_path` resolves the path and walks
`/proc/self/mountinfo` for the longest matching mount point, then matches the filesystem
type against a network list (cifs/smb3/nfs/9p/…) plus FUSE backends
(gvfsd-fuse/sshfs/rclone/davfs/s3fs/…). Network libraries are never auto-watched.
**Because:** `statfs.f_type` cannot see it — a NAS reached through GVFS reports the
generic FUSE magic number, indistinguishable from any local FUSE mount. Auto-watching an
SMB share makes FSEvents-style phantom events loop the scanner.
**Rejected:** `statfs` magic numbers (the macOS approach) — wrong answer for the most
common Linux case. Also rejected: watching anyway with debouncing — the phantom events
are indistinguishable from real ones.
**Unsure about:** Windows is still unimplemented (`GetDriveTypeW == DRIVE_REMOTE` plus a
UNC check is the likely shape). The FUSE-backend list is a denylist and will drift.
**Affects:** `index.rs::is_network_path`, `add_library`, `watch.rs::start_all`.

## 2026-08-31 — FTS rows index the library-relative path, not the absolute one

**Decision:** `rebuild_fts` strips the library root prefix from `m.folder` before
indexing, and indexes project/source files rather than only `is_part=1` rows.
**Because:** absolute paths put the mount plumbing into every single row. On a
GVFS-mounted share, searching `gvfs`, `share`, or `server` matched **all 4,701 models** —
each one a perfect-looking hit carrying zero information.
**Rejected:** stop-wording the offending tokens — the noise is installation-specific
(mount path, server name, share name), so a fixed list can't cover it.
**Unsure about:** nothing pressing; measured at 0 rows for each of those tokens after
the change, with `run`/`smb`/`user` surviving only as genuine content matches.
**Affects:** `index.rs::rebuild_fts`, `FTS_VERSION`.

## 2026-08-31 — A multi-word query is AND-of-quoted-words, not one quoted phrase

**Decision:** `fts_query` splits on whitespace, quotes each word of 3+ characters, and
joins with `AND`; it falls back to quoting the whole phrase only when every word is too
short for the trigram tokenizer.
**Because:** quoting the whole input made word order load-bearing — `coaster gold` found
nothing for a model named "Aztec Gold Drink Coaster". Nobody types folder names in order.
**Rejected:** OR-joining the words — recall goes up, but on a 4,790-model library
precision collapses and the ranking can't recover it.
**Unsure about:** the 3-character floor is the trigram tokenizer's minimum, so 1–2
character terms silently contribute nothing to a multi-word query.
**Affects:** `index.rs::fts_query`, `quick_search`, `search_model_ids`.


---

## Reconstructed from CLAUDE.md and the codebase — reasoning stated, dates unknown

These were real decisions whose rationale survived in CLAUDE.md. Recorded here so
they're arguable; the dates are unknown and the `Rejected` fields are partly
inferred — correct them when you know better.

### Read-only, forever

**Decision:** Trove indexes model folders strictly in place. It never moves,
modifies, uploads, or downloads a user's files.
**Because:** it's a library over someone's irreplaceable model collection. A tool
that reorganizes files has to be trusted absolutely or not used at all; read-only
makes the trust question disappear rather than answering it.
**Rejected:** a managed library that owns file layout (the Photos/iTunes model) —
better UX for organizing, but one bug destroys user data and the blast radius is
unbounded.
**Unsure about:** whether this holds if users ask for organizing features. The
stance is load-bearing for trust, so breaking it should be a deliberate product
decision, not a feature request.
**Affects:** everything under `src-tauri/`. Cache → `app_cache_dir`, DB →
`app_data_dir`, never inside the library.

### Native owns the filesystem, web owns the pixels

**Decision:** Rust does scan, watch, SQLite index, and OS handoff. The webview
does UI, 3D, and thumbnail rendering. Files stream in over Tauri's asset protocol
(`convertFileSrc`), not JSON IPC.
**Because:** shipping mesh and image bytes through JSON IPC doesn't survive real
library sizes.
**Rejected:** IPC for file content — dies on large models.
**Unsure about:** where STEP/`occt-import-js` should live long-term; it's WASM in
the webview today, which keeps the split clean but pays a lazy-load cost.
**Affects:** the `index.rs` ↔ Zustand store seam.

### The dataset lives in the Zustand store, so the UI runs without Tauri

**Decision:** the whole dataset sits in the store, letting the UI run on mock
fixtures in a plain browser (`npm run dev`) and swap to the live Rust index under
Tauri with no call-site changes.
**Because:** you cannot headless-screenshot the native Tauri window. Without a
browser-runnable UI there is no fast visual verification loop at all.
**Rejected:** driving the UI directly off Tauri commands — simpler data flow, but
it makes every UI change require a native build and manual inspection.
**Unsure about:** how far this scales — the whole dataset in memory is fine at
current library sizes; unclear where it breaks.
**Affects:** `src/lib/` store, `src/data/mock`, the entire verification workflow.

### Unnotarized macOS builds, deliberately

**Decision:** ship macOS builds unnotarized and document the `xattr -dr
com.apple.quarantine` workaround.
**Because:** notarization needs a paid Apple Developer account, and the project is
MIT/self-hosted.
**Rejected:** paying for notarization — the real fix, deferred on cost.
**Unsure about:** the trigger to revisit. Every macOS user hits a "damaged"
dialog on first download, which is the worst possible first impression for a
trust-dependent app. Worth revisiting on any real adoption signal.
**Affects:** `.github/workflows/release.yml`, install docs, first-run UX.

---

## Open — decided in someone's head, never written down

Reasoning not recoverable from the repo. Fill these in when the context is fresh:

- **Tauri over Electron** — bundle size? Rust backend? memory?
- **SQLite + FTS5 trigram** for search — what else was considered, and what does
  trigram buy over FTS5 defaults for filename-shaped queries?
- **Zustand over Redux / Context** — and does that still hold as the store grows?
- **Two windows** (`main` + transparent always-on-top `launcher`) requiring
  `macOSPrivateApi: true` — what did that private API buy, and what's the fallback
  if Apple closes it?
- **A model = the shallowest directory holding a model file** — this grouping rule
  drives `SCAN_VERSION` rebuilds. What did it beat?
