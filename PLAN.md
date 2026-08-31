# PLAN — Rust-side STL thumbnail rasterizer

## Problem

Model previews come from two stages:

1. **Rust, during indexing** (`generate_image_thumbs`, `index.rs:1171`) — downscales
   folder images, extracts embedded thumbnails from `.3mf`/`.blend`. Writes
   `{id}.jpg` to the thumb cache, sets `models.thumb`.
2. **Webview, lazily while browsing** (`src/three/thumbs.ts`) — renders an STL/OBJ
   mesh with Three.js for models that got nothing from stage 1.

On a real 4,790-model library stage 2 has produced **zero** thumbnails
(`thumb cache: 3744 jpg, 0 png` — `save_thumb` writes `.png`, none exist). 1,048
models sit blank. Stage 2 must `fetch()` + `arrayBuffer()` the whole mesh over SMB —
**9.4 GB**, two at a time, largest single file **335 MB** — and it only fires when a
card is scrolled into view. A transient failure marks the id in `attempted` before
rendering and never retries within the session.

It also contradicts CLAUDE.md: *"NEVER stream full-resolution originals or meshes off
a (network) share while browsing."*

## Goal

Generate STL thumbnails **during indexing**, in Rust, as a third pass — streaming,
memory-bounded, persisted. Stage 2 then self-disables for STL (`requestThumb` already
no-ops when `m.thumb` is set) and remains the fallback for OBJ.

## Scope

**In:** binary + ASCII STL parsing, a software rasterizer, a third pass in
`generate_image_thumbs`, unit tests.
**Out:** OBJ (stays in the webview), STEP, changes to `thumbs.ts`, new dependencies,
`SCAN_VERSION` bump (grouping unchanged; the pass selects `thumb IS NULL` so existing
libraries are picked up on the next scan), parallelism (sequential like the sibling
passes; note as follow-up if slow).

## Constraint: no new crates

`image = { version = "0.25", default-features = false, features = ["jpeg","png","gif","webp"] }`
is codec-only — no drawing primitives. The rasterizer is written by hand against an
`RgbImage`. **Do not add a dependency.** If you believe one is unavoidable, stop and
say so in your report rather than adding it.

## API contract (both agents code against this)

New module `src-tauri/src/thumbgen.rs`:

```rust
/// Bounding-box dimensions in model units, rounded — matches what the webview
/// stores via `save_thumb` (w = x, d = z, h = y).
pub struct Dims { pub w: u32, pub d: u32, pub h: u32 }

/// Read an STL (binary or ASCII) and rasterize a shaded `size`x`size` preview.
/// Streams the file; never loads more than the triangle budget into memory.
/// Returns `None` for unreadable/empty/degenerate meshes.
pub fn render_stl_thumb(path: &std::path::Path, size: u32) -> Option<(image::RgbImage, Dims)>;
```

## Work split

### Agent A — `src-tauri/src/thumbgen.rs` (new file, pure; no DB, no Tauri)

- **Format detection:** binary STL iff `file_len == 84 + count*50` (read the 80-byte
  header + `u32` count first). Anything else → ASCII path. Do **not** trust a leading
  `"solid"`, binary files carry it too.
- **Binary parse:** `BufReader`, 50 bytes/triangle (12 `f32` LE + 2 attr bytes).
  Never `read_to_end`.
- **ASCII parse:** line-oriented over `BufReader`, `vertex x y z` triples. Bound the
  work (cap lines/triangles) so a malformed file can't spin.
- **Triangle budget:** `const MAX_TRIS: usize = 200_000`. When the count exceeds it,
  keep every Nth triangle (stride = `count / MAX_TRIS + 1`). Bounds memory and makes
  the 335 MB file cheap. Compute the bbox from the *kept* set.
- **Rasterizer:** orthographic, z-buffer, flat shading from a fixed directional light
  plus ambient. Fit the mesh to the frame with a small margin.
- **Match the existing look:** read `src/three/thumbs.ts` (`renderToPng`, `normalize`,
  `makeMaterial`) and mirror its camera angle and background colour so Rust-generated
  and webview-generated thumbnails are visually consistent on the same grid.
- **Tests** (`#[cfg(test)]`, in-file, no fixtures on disk — build STLs in a temp dir):
  1. binary cube parses to the expected triangle count and correct `Dims`
  2. ASCII cube produces the same `Dims` as the binary cube
  3. rendered image is **not** uniform background (something was actually drawn)
  4. a mesh over `MAX_TRIS` is strided down and still renders
  5. truncated/garbage input returns `None` rather than panicking

### Agent B — integration in `src-tauri/src/index.rs` + `src-tauri/src/lib.rs`

- `mod thumbgen;` in `lib.rs` next to the existing module declarations.
- Third pass appended to `generate_image_thumbs`, **after** the embedded-thumbnail
  pass, before the closing `eprintln!`. Mirror the two existing passes exactly:
  - select one candidate per model: models in this library with
    `(thumb IS NULL OR thumb='')`, joined to `files` where `type='stl' AND is_part=1`,
    choosing the **smallest** such file — this matches `workablePart` in `thumbs.ts`
    so both paths pick the same mesh
  - `if cancel.load(Ordering::SeqCst) { break; }` each iteration
  - write `{id}.jpg` into the same `dir`
  - **hold the DB mutex only for the `UPDATE`**, never across the render — the mutex
    is global and long work under it freezes the app
  - `UPDATE models SET thumb=?2, dim_w=?3, dim_d=?4, dim_h=?5 WHERE id=?1` (store the
    dims, same as `save_thumb` does)
  - emit `dataset-changed` + `emit_progress(..., "previews", 0)` every 24
- Extend the final log line to report the third count alongside folder-image and
  embedded totals.
- **Test:** a `#[test]` that writes a small binary STL into a temp library, runs the
  pass (or its query + render step), and asserts `models.thumb` is populated and the
  file exists on disk.

## Acceptance criteria

- [ ] STL-part models with no folder image and no embedded thumb get a cached preview at index time
- [ ] Zero new cargo dependencies
- [ ] Streaming read — a 335 MB STL never lands in memory whole
- [ ] Triangle budget enforced with stride sampling
- [ ] Binary **and** ASCII STL handled; malformed input returns `None`, no panic
- [ ] `{id}.jpg` written to the thumb cache; `models.thumb` + `dim_w/d/h` updated
- [ ] Cancel flag respected; DB lock held only for the UPDATE
- [ ] Progress events every 24, consistent with the sibling passes
- [ ] `cd src-tauri && cargo test` green (27 existing + new)
- [ ] `npm test` green (47), `npx tsc --noEmit` clean — no frontend change expected
- [ ] Visual consistency with webview-rendered thumbnails

## Critical path

None declared in CLAUDE.md. Closest risk is the **read-only guarantee** — this pass
reads user files and writes only to `app_cache_dir`. Any write outside the cache dir
is an automatic fail.

---

# AMENDMENT 1 — the stride was a planning error

Phase 4 measured what `MAX_TRIS` stride sampling actually does. Keeping every Nth
triangle without enlarging anything means the rasterizer paints ~`1/stride` of the
silhouette:

```
   57,600 tris -> stride  1 -> 152,228 px = 100.0%  (reference)
  360,000 tris -> stride  2 -> 114,314 px =  75.1%
1,000,000 tris -> stride  6 ->  46,584 px =  30.6%
6,760,000 tris -> stride 34 ->   8,926 px =   5.9%  <- the 335 MB file
```

The original plan's headline case renders as a stipple cloud. That violates CLAUDE.md
("never a misleading shape") and fails this plan's own "cached preview" and "visual
consistency" criteria. **The stride is withdrawn.**

## Replacement approach

A z-buffer is `O(size²)` — 512×512 — regardless of triangle count. Memory is bounded
by the *raster target*, not the mesh, so no decimation is needed at all:

- **≤ MAX_IN_MEMORY_TRIS (200_000)** — unchanged: read once, keep triangles in memory
  (≤7 MB), compute bbox, rasterize. This is the common case (~975 of the 1,048 models).
- **Above it** — two streaming passes over the file: pass 1 accumulates the bbox only
  (no triangle retained), pass 2 re-reads and rasterizes straight into the z-buffer.
  Peak memory is the framebuffer. Binary STL carries the count in its header, so the
  path is chosen before any geometry is read.

Roughly 73 models take the two-pass path and are read twice — a one-time index-time
cost, and the correct trade against shipping unusable tiles. **Codex's bbox finding
dissolves here**: the bbox now comes from every triangle by construction.

## Amended acceptance criteria

- [ ] No triangle decimation; every triangle contributes to both bbox and raster
- [ ] Peak memory bounded by the framebuffer, not the mesh, for any input size
- [ ] Silhouette coverage is size-independent: a mesh tessellated at ~57k and at ~1M
      triangles renders within ~20% of the same non-background pixel count
- [ ] `MAX_ASCII_LINE` genuinely bounds the read (`take(..).read_until(..)`, not a
      length check after `read_line` has already grown the String)
- [ ] The stale-write race is closed: the `UPDATE` is conditional on the row still
      lacking a thumb
- [ ] Supersample (render 2x, downscale) to match the webview's `antialias: true`

## Deliberately not doing

- **Per-part colour.** The rater noted `files.color` could be plumbed through. Skipped:
  the webview path has generated zero thumbnails, so every tile on the grid is
  Rust-generated and a uniform neutral gray is already self-consistent. Revisit only if
  the OBJ fallback starts producing coloured tiles beside these.

---

# AMENDMENT 2 — final round

Round 2 rating: correctness 8, simplicity 7, test coverage 6, naming 8, performance
risk 7, security risk 9, plan fidelity 9. **Gate FAIL** (overall 7.7, coverage 6 < 7).

## Blocking

1. **A blank render is persisted permanently.** `render_stl_thumb` returns `Some` for
   any mesh with `max_dim > 1e-6` even when nothing was drawn — every triangle
   sub-pixel or off-frame, which one stray far-away vertex produces. The pass writes a
   blank JPEG and sets `models.thumb`; both the Rust candidate query and `requestThumb`
   key off `thumb` being set, so it is unrecoverable. Violates "never a misleading
   shape". Guard: return `None` when the raster is uniformly background.
2. **The `VmHWM` memory assertion cannot fail.** It samples a since-process-start
   high-water mark *after* the test already peaked at ~88 MB building its fixture, so
   the 43 MB regression it names can never move it. Round 1 was failed for a vacuous
   assertion; do not ship another. Delete it or make it real.
3. **The conditional `UPDATE` added in round 1 is executed by no test.** The existing
   integration test runs a plain unconditional UPDATE instead.

## Also taking (deletions and one-liners)

4. **Collapse the dual path.** `detect` has no length field for ASCII so it calls
   `count_ascii_vertices` — a full streaming read — purely to choose a path. Real reads
   today: binary 1/2, **ASCII 2/3**. The dual path saves a read only for small binary
   and costs ASCII a third pass over SMB. Always-stream deletes `count_ascii_vertices`,
   `read_all`, `read_stl`, `bbox`, `MAX_IN_MEMORY_TRIS`, and the branch — ~60-70 lines.
5. `read_bounded_line`'s doc contract is backwards: `Some(None)` **is** the EOF signal,
   bare `None` is the error case.
6. Infinite coordinates saturate to `u32::MAX` in `dim_w/d/h` — clamp.
7. Bound the raster loop (Codex [high], rated medium-low): thread the cancel flag into
   the render and check periodically, so an eject actually stops it.

## Explicitly deferred to a follow-up PR

- The thumbnail-**file** race (row is protected; window is microseconds between two
  deterministic renders; orphan case shared with the sibling passes).
- `stl_thumb_candidates`' BTreeMap dedup — expressible as `MIN(f.size) ... GROUP BY`,
  but it mirrors the sibling embedded pass, and code-fit wins.
- Dark-theme tile background (JPEG forces opaque; siblings are opaque too).
