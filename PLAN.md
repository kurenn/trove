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
