// thumbgen.rs — software STL rasterizer used by the indexer's third thumbnail
// pass (index.rs `generate_image_thumbs`). Pure: no DB, no Tauri, no writes —
// reads one STL path, hands back a rendered image + bbox dims in memory. The
// `image` crate here is codec-only (see Cargo.toml), so the rasterizer below
// (projection, z-buffer, shading) is hand-rolled against `RgbImage`.
//
// Camera + background are hand-matched to the webview's Three.js renderer
// (`src/three/thumbs.ts`) so native and webview-rendered thumbnails read the
// same on a mixed grid:
//   - `renderToPng` sets `obj.rotation.y = -0.5` on the (already-normalized,
//     origin-centered) mesh, then a PerspectiveCamera(fov 34) sits at
//     (2.4, 1.9, 3.0) looking at the origin. Composing the camera position
//     with that -0.5 rad object yaw (i.e. viewing the *un-rotated* mesh from
//     `Ry(0.5) * (2.4,1.9,3.0)`) gives the fixed eye direction used below —
//     an orthographic stand-in for the same framing.
//   - The renderer is constructed with `alpha: true` and `scene.background`
//     is never set, so three.js's default clear alpha for an alpha-context
//     canvas is 0 (transparent) — the PNG composites over the card's
//     `var(--surface)` (`#fffdfa` in the light theme, this app's default).
//     `RgbImage` has no alpha channel, so that surface tone is baked in as a
//     flat background instead of true transparency.
// Lighting itself isn't specified by the plan (three.js's hemi + 2 directional
// lights + PBR material aren't reproducible with flat shading anyway) — picked
// a single fixed key light + ambient, loosely in the same direction as the
// webview's key light, and a neutral filament-gray material.
//
// Rendered at 2x `size` and box-downscaled at the end (SUPERSAMPLE) to match
// the webview's `antialias: true`.

use image::{Rgb, RgbImage};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

/// Bounding-box dimensions in model units, rounded — matches what the webview
/// stores via `save_thumb` (w = x, d = z, h = y).
pub struct Dims {
    pub w: u32,
    pub d: u32,
    pub h: u32,
}

/// Meshes at or below this triangle count are read once into memory (kept as
/// a `Vec<Tri>`, a few MB at most) and rasterized directly — the common case.
/// Above it, the file is streamed twice instead: pass 1 computes only the
/// bounding box (no triangle retained), pass 2 re-reads and rasterizes
/// straight into the z-buffer. Either way peak memory is bounded by the
/// framebuffer, not the mesh — a z-buffer is O(size²) regardless of triangle
/// count, so there is no need to decimate triangles at all. (An earlier
/// version strided the triangle set down above this threshold; that made
/// large meshes render as a stipple of scattered facets instead of a filled
/// silhouette — see PLAN.md AMENDMENT 1.)
const MAX_IN_MEMORY_TRIS: usize = 200_000;

/// A single line in an ASCII STL is never legitimately this long. `take(..)`
/// actually bounds the read (rather than checking length after `read_line`
/// has already grown the buffer without limit), so an unterminated/malformed
/// line aborts the parse instead of growing memory without bound.
const MAX_ASCII_LINE: u64 = 4096;

/// Render at 2x `size` and downscale — matches the webview's `antialias: true`.
const SUPERSAMPLE: u32 = 2;

#[derive(Clone, Copy)]
struct V3 {
    x: f32,
    y: f32,
    z: f32,
}

impl V3 {
    fn sub(self, o: V3) -> V3 {
        V3 { x: self.x - o.x, y: self.y - o.y, z: self.z - o.z }
    }
    fn dot(self, o: V3) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    fn cross(self, o: V3) -> V3 {
        V3 {
            x: self.y * o.z - self.z * o.y,
            y: self.z * o.x - self.x * o.z,
            z: self.x * o.y - self.y * o.x,
        }
    }
    fn scale(self, s: f32) -> V3 {
        V3 { x: self.x * s, y: self.y * s, z: self.z * s }
    }
    fn len(self) -> f32 {
        self.dot(self).sqrt()
    }
    fn norm(self) -> V3 {
        let l = self.len();
        if l > 1e-9 { self.scale(1.0 / l) } else { self }
    }
}

type Tri = [V3; 3];

#[derive(Clone, Copy)]
enum Format {
    Binary,
    Ascii,
}

/// Read an STL (binary or ASCII) and rasterize a shaded `size`x`size` preview.
/// Streams the file; a mesh over `MAX_IN_MEMORY_TRIS` never has its triangles
/// held in memory — see that constant's doc. Returns `None` for unreadable/
/// empty/degenerate meshes.
pub fn render_stl_thumb(path: &Path, size: u32) -> Option<(RgbImage, Dims)> {
    if size == 0 {
        return None;
    }
    let (fmt, count) = detect(path)?;
    if count == 0 {
        return None;
    }
    let render_size = size.saturating_mul(SUPERSAMPLE);

    let (img, dims) = if count > MAX_IN_MEMORY_TRIS {
        // Two streaming passes, no triangle Vec retained at any point.
        let (min, max) = stream_bbox(path, fmt)?;
        let (dims, frame, mut img, mut depth) = setup(min, max, render_size)?;
        let file = File::open(path).ok()?;
        let draw = |t: Tri| draw_tri(&mut img, &mut depth, render_size, &frame, t);
        match fmt {
            Format::Binary => stream_binary(file, draw)?,
            Format::Ascii => stream_ascii(file, draw)?,
        }
        (img, dims)
    } else {
        let tris = read_all(path, fmt)?;
        if tris.is_empty() {
            return None;
        }
        let (min, max) = bbox(&tris);
        let (dims, frame, mut img, mut depth) = setup(min, max, render_size)?;
        for &t in &tris {
            draw_tri(&mut img, &mut depth, render_size, &frame, t);
        }
        (img, dims)
    };

    let img = if render_size == size {
        img
    } else {
        image::imageops::resize(&img, size, size, image::imageops::FilterType::Triangle)
    };
    Some((img, dims))
}

// ── STL parsing ─────────────────────────────────────────────────────────────

/// Detect format + triangle count without reading any geometry. Binary iff
/// `file_len == 84 + count*50` (80-byte header + u32 count, read up front) —
/// NOT by sniffing a leading "solid", which binary files can carry too. ASCII
/// carries no length field, so its count comes from a lightweight streaming
/// vertex-count pass instead.
fn detect(path: &Path) -> Option<(Format, usize)> {
    let mut file = File::open(path).ok()?;
    let file_len = file.metadata().ok()?.len();
    let mut header = [0u8; 84];
    if file_len >= 84 && file.read_exact(&mut header).is_ok() {
        // header[80..84] is always exactly 4 bytes — try_into can't fail here.
        let count = u32::from_le_bytes(header[80..84].try_into().unwrap());
        if file_len == 84 + count as u64 * 50 {
            return Some((Format::Binary, count as usize));
        }
    }
    let count = count_ascii_vertices(path)? / 3;
    Some((Format::Ascii, count))
}

/// Read every triangle in the file into memory (used by the in-memory render
/// path and by tests).
fn read_all(path: &Path, fmt: Format) -> Option<Vec<Tri>> {
    let file = File::open(path).ok()?;
    let mut tris = Vec::new();
    match fmt {
        Format::Binary => stream_binary(file, |t| tris.push(t))?,
        Format::Ascii => stream_ascii(file, |t| tris.push(t))?,
    }
    Some(tris)
}

/// Detect format then read every triangle into memory in one call.
#[cfg(test)]
fn read_stl(path: &Path) -> Option<Vec<Tri>> {
    let (fmt, _count) = detect(path)?;
    read_all(path, fmt)
}

/// Stream the file once, calling `f` per triangle without retaining any, and
/// fold the world-space bounding box.
fn stream_bbox(path: &Path, fmt: Format) -> Option<(V3, V3)> {
    let file = File::open(path).ok()?;
    let mut min = V3 { x: f32::MAX, y: f32::MAX, z: f32::MAX };
    let mut max = V3 { x: f32::MIN, y: f32::MIN, z: f32::MIN };
    let mut any = false;
    let acc = |t: Tri| {
        any = true;
        for v in t {
            min.x = min.x.min(v.x); min.y = min.y.min(v.y); min.z = min.z.min(v.z);
            max.x = max.x.max(v.x); max.y = max.y.max(v.y); max.z = max.z.max(v.z);
        }
    };
    match fmt {
        Format::Binary => stream_binary(file, acc)?,
        Format::Ascii => stream_ascii(file, acc)?,
    };
    if any { Some((min, max)) } else { None }
}

/// Streaming binary parse: 50 bytes/triangle (u16 attr byte-count trailer read
/// and discarded, never interpreted). Calls `f` once per triangle without
/// retaining any — `BufReader`, never `read_to_end`. A truncated file yields
/// whatever was streamed before the cut.
fn stream_binary<F: FnMut(Tri)>(file: File, mut f: F) -> Option<()> {
    let mut r = BufReader::new(file);
    let mut header = [0u8; 84];
    r.read_exact(&mut header).ok()?;
    let count = u32::from_le_bytes(header[80..84].try_into().ok()?) as usize;
    let mut buf = [0u8; 50];
    for _ in 0..count {
        if r.read_exact(&mut buf).is_err() {
            break; // truncated file — use what was streamed so far
        }
        let g = |o: usize| f32::from_le_bytes(buf[o..o + 4].try_into().unwrap());
        // buf[0..12] is the stored facet normal — recomputed from the vertices
        // in draw_tri instead, so a zeroed/bogus normal in the file can't
        // matter. Layout: normal@0 (12B), v1@12, v2@24, v3@36 (12B each), attr@48 (2B).
        let v = |o: usize| V3 { x: g(o), y: g(o + 4), z: g(o + 8) };
        f([v(12), v(24), v(36)]);
    }
    Some(())
}

/// Read one line, bounded to `MAX_ASCII_LINE` bytes via `BufRead::take` — the
/// read itself is capped, not just checked after the fact. `None` at true EOF
/// with nothing left to read; `Some(None)` never occurs, only used internally.
fn read_bounded_line(r: &mut BufReader<File>) -> Option<Option<String>> {
    let mut buf = Vec::new();
    let n = r.by_ref().take(MAX_ASCII_LINE).read_until(b'\n', &mut buf).ok()?;
    if n == 0 {
        return Some(None); // EOF
    }
    if buf.len() as u64 >= MAX_ASCII_LINE && !buf.ends_with(b"\n") {
        return None; // hit the bound without a line terminator — malformed
    }
    Some(Some(String::from_utf8(buf).ok()?))
}

/// Streaming line-oriented ASCII parse over `BufReader`. Calls `f` once per
/// completed triangle without retaining any.
fn stream_ascii<F: FnMut(Tri)>(file: File, mut f: F) -> Option<()> {
    let mut r = BufReader::new(file);
    let mut verts: Vec<V3> = Vec::with_capacity(3);
    loop {
        let line = match read_bounded_line(&mut r)? {
            Some(l) => l,
            None => break,
        };
        let mut it = line.split_whitespace();
        if it.next().map(|t| t.eq_ignore_ascii_case("vertex")) != Some(true) {
            continue;
        }
        let (x, y, z) = match (it.next(), it.next(), it.next()) {
            (Some(x), Some(y), Some(z)) => (x.parse::<f32>(), y.parse::<f32>(), z.parse::<f32>()),
            _ => return None,
        };
        let (Ok(x), Ok(y), Ok(z)) = (x, y, z) else { return None };
        verts.push(V3 { x, y, z });
        if verts.len() == 3 {
            f([verts[0], verts[1], verts[2]]);
            verts.clear();
        }
    }
    Some(())
}

/// Streaming pass over an ASCII file: count `vertex` lines (÷3 = triangle
/// count) so the caller can choose the in-memory vs. streaming path before
/// touching any geometry.
fn count_ascii_vertices(path: &Path) -> Option<usize> {
    let mut r = BufReader::new(File::open(path).ok()?);
    let mut n = 0usize;
    loop {
        let line = match read_bounded_line(&mut r)? {
            Some(l) => l,
            None => break,
        };
        if line.split_whitespace().next().map(|t| t.eq_ignore_ascii_case("vertex")) == Some(true) {
            n += 1;
        }
    }
    Some(n)
}

fn bbox(tris: &[Tri]) -> (V3, V3) {
    let mut min = tris[0][0];
    let mut max = tris[0][0];
    for t in tris {
        for v in t {
            min.x = min.x.min(v.x); min.y = min.y.min(v.y); min.z = min.z.min(v.z);
            max.x = max.x.max(v.x); max.y = max.y.max(v.y); max.z = max.z.max(v.z);
        }
    }
    (min, max)
}

// ── camera (fixed — see module doc for how these were derived) ─────────────

// Eye direction: `Ry(0.5) * (2.4, 1.9, 3.0)`, normalized — see module doc.
const EYE: V3 = V3 { x: 0.8272, y: 0.4434, z: 0.3459 };
const CAM_RIGHT: V3 = V3 { x: 0.3858, y: 0.0, z: -0.9226 };
const CAM_UP: V3 = V3 { x: -0.4091, y: 0.8967, z: -0.1711 };
// Fixed key light, roughly the webview's key light direction (3,5,4); ambient
// keeps faces pointed away from it from going pure black.
const LIGHT: V3 = V3 { x: 0.4243, y: 0.7071, z: 0.5657 };
const AMBIENT: f32 = 0.4;
// Neutral filament-gray material — this pass has no DB access, so it can't
// read the model's actual color the way the webview does.
const MATERIAL: (f32, f32, f32) = (0.66, 0.62, 0.57);
// Background: bakes in the light theme's `--surface` (#fffdfa) — the tone the
// webview's transparent-PNG thumbnails actually composite onto in the app's
// default theme (RgbImage has no alpha channel to leave this transparent).
const BG: Rgb<u8> = Rgb([255, 253, 250]);
// Object fills this fraction of the frame — matches the webview's headroom.
const FILL: f32 = 0.86;

/// Everything needed to project a world-space vertex to a `(pixel_x, pixel_y,
/// depth)` triple for one fixed camera + framing.
struct Frame {
    center: V3,
    scale: f32,
    mid_x: f32,
    mid_y: f32,
    px_per_unit: f32,
    half: f32,
}

impl Frame {
    fn project(&self, v: V3) -> (f32, f32, f32) {
        let l = v.sub(self.center).scale(self.scale);
        let (sx, sy, sd) = (l.dot(CAM_RIGHT), l.dot(CAM_UP), l.dot(EYE));
        let px = (sx - self.mid_x) * self.px_per_unit + self.half;
        let py = self.half - (sy - self.mid_y) * self.px_per_unit;
        (px, py, sd)
    }
}

/// Fit the mesh to the frame with margin `FILL`. The screen-space extent used
/// for that fit comes from the 8 corners of the world-space bbox rather than
/// a pass over every triangle: an orthographic projection is a linear map, so
/// its extremes over a box are exactly attained at the box's own corners.
/// That keeps the streaming path (large meshes) to two file passes total —
/// bbox, then rasterize — with no third pass to find the screen extent.
fn compute_frame(min: V3, max: V3, max_dim: f32, size: u32) -> Frame {
    let center = V3 { x: (min.x + max.x) / 2.0, y: (min.y + max.y) / 2.0, z: (min.z + max.z) / 2.0 };
    let scale = 2.0 / max_dim; // largest raw dimension → span 2.0, matching `normalize()` in loaders.ts
    let project2d = |v: V3| {
        let l = v.sub(center).scale(scale);
        (l.dot(CAM_RIGHT), l.dot(CAM_UP))
    };
    let (mut lo_x, mut lo_y, mut hi_x, mut hi_y) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for &x in &[min.x, max.x] {
        for &y in &[min.y, max.y] {
            for &z in &[min.z, max.z] {
                let (sx, sy) = project2d(V3 { x, y, z });
                lo_x = lo_x.min(sx); hi_x = hi_x.max(sx);
                lo_y = lo_y.min(sy); hi_y = hi_y.max(sy);
            }
        }
    }
    let span = (hi_x - lo_x).max(hi_y - lo_y).max(1e-6);
    Frame {
        center,
        scale,
        mid_x: (lo_x + hi_x) / 2.0,
        mid_y: (lo_y + hi_y) / 2.0,
        px_per_unit: size as f32 * FILL / span,
        half: size as f32 / 2.0,
    }
}

/// Bbox → dims + camera frame + a fresh blank framebuffer/z-buffer pair, or
/// `None` for degenerate (single-point / coincident) geometry.
fn setup(min: V3, max: V3, size: u32) -> Option<(Dims, Frame, RgbImage, Vec<f32>)> {
    let extent = max.sub(min);
    let max_dim = extent.x.max(extent.y).max(extent.z);
    if !(max_dim > 1e-6) {
        return None;
    }
    let dims = Dims {
        w: extent.x.max(0.0).round() as u32,
        d: extent.z.max(0.0).round() as u32,
        h: extent.y.max(0.0).round() as u32,
    };
    let frame = compute_frame(min, max, max_dim, size);
    let img = RgbImage::from_pixel(size, size, BG);
    let depth = vec![f32::NEG_INFINITY; size as usize * size as usize];
    Some((dims, frame, img, depth))
}

/// Orthographic, z-buffered, flat-shaded scan-conversion of one triangle.
fn draw_tri(img: &mut RgbImage, depth: &mut [f32], size: u32, frame: &Frame, t: Tri) {
    let sz = size as usize;
    let (a, b, c) = (frame.project(t[0]), frame.project(t[1]), frame.project(t[2]));

    let normal = t[1].sub(t[0]).cross(t[2].sub(t[0])).norm();
    let shade = (AMBIENT + (1.0 - AMBIENT) * normal.dot(LIGHT).abs()).clamp(0.0, 1.0);
    let color = Rgb([
        (MATERIAL.0 * shade * 255.0) as u8,
        (MATERIAL.1 * shade * 255.0) as u8,
        (MATERIAL.2 * shade * 255.0) as u8,
    ]);

    let min_x = a.0.min(b.0).min(c.0).floor().max(0.0) as usize;
    let max_x = (a.0.max(b.0).max(c.0).ceil() as isize).clamp(0, size as isize) as usize;
    let min_y = a.1.min(b.1).min(c.1).floor().max(0.0) as usize;
    let max_y = (a.1.max(b.1).max(c.1).ceil() as isize).clamp(0, size as isize) as usize;
    if min_x >= max_x || min_y >= max_y {
        return; // degenerate or fully off-frame
    }
    let edge = |x0: f32, y0: f32, x1: f32, y1: f32, px: f32, py: f32| (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0);
    let area = edge(a.0, a.1, b.0, b.1, c.0, c.1);
    if area.abs() < 1e-6 {
        return; // zero-area triangle (edge-on to the camera)
    }
    for y in min_y..max_y.min(sz) {
        for x in min_x..max_x.min(sz) {
            let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
            let w0 = edge(b.0, b.1, c.0, c.1, px, py) / area;
            let w1 = edge(c.0, c.1, a.0, a.1, px, py) / area;
            let w2 = edge(a.0, a.1, b.0, b.1, px, py) / area;
            if w0 < 0.0 || w1 < 0.0 || w2 < 0.0 {
                continue; // outside the triangle
            }
            let d = w0 * a.2 + w1 * b.2 + w2 * c.2;
            let idx = y * sz + x;
            if d > depth[idx] {
                depth[idx] = d;
                img.put_pixel(x as u32, y as u32, color);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A 2x3x4 unit box (x,y,z half-extents 1,1.5,2), 12 triangles, written as
    /// binary STL — the reference geometry for tests 1-2.
    fn cube_tris() -> Vec<Tri> {
        let (hx, hy, hz) = (1.0f32, 1.5f32, 2.0f32);
        let mut verts = Vec::new();
        for &s in &[-hx, hx] {
            // faces perpendicular to X
            verts.push((s, -hy, -hz)); verts.push((s, hy, -hz)); verts.push((s, hy, hz));
            verts.push((s, -hy, -hz)); verts.push((s, hy, hz)); verts.push((s, -hy, hz));
        }
        for &s in &[-hy, hy] {
            verts.push((-hx, s, -hz)); verts.push((hx, s, -hz)); verts.push((hx, s, hz));
            verts.push((-hx, s, -hz)); verts.push((hx, s, hz)); verts.push((-hx, s, hz));
        }
        for &s in &[-hz, hz] {
            verts.push((-hx, -hy, s)); verts.push((hx, -hy, s)); verts.push((hx, hy, s));
            verts.push((-hx, -hy, s)); verts.push((hx, hy, s)); verts.push((-hx, hy, s));
        }
        verts.chunks(3).map(|ch| [
            V3 { x: ch[0].0, y: ch[0].1, z: ch[0].2 },
            V3 { x: ch[1].0, y: ch[1].1, z: ch[1].2 },
            V3 { x: ch[2].0, y: ch[2].1, z: ch[2].2 },
        ]).collect()
    }

    /// UV sphere of radius `r` centered at the origin: `stacks` latitude bands
    /// x `slices` longitude bands -> exactly `2*stacks*slices` triangles (a
    /// handful of zero-area slivers at the two poles, which `draw_tri` already
    /// skips). Same generator at different (stacks, slices) reproduces
    /// identical geometry at different tessellation density — the property
    /// the size-independence test below needs.
    fn uv_sphere(stacks: usize, slices: usize, r: f32) -> Vec<Tri> {
        use std::f32::consts::{FRAC_PI_2, PI};
        let pt = |i: usize, j: usize| -> V3 {
            let phi = PI * i as f32 / stacks as f32 - FRAC_PI_2; // -pi/2..pi/2
            let theta = 2.0 * PI * j as f32 / slices as f32;
            V3 { x: r * phi.cos() * theta.cos(), y: r * phi.sin(), z: r * phi.cos() * theta.sin() }
        };
        let mut tris = Vec::with_capacity(2 * stacks * slices);
        for i in 0..stacks {
            for j in 0..slices {
                let (p00, p10, p11, p01) = (pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1));
                tris.push([p00, p10, p11]);
                tris.push([p00, p11, p01]);
            }
        }
        tris
    }

    fn write_binary_stl(path: &Path, tris: &[Tri]) {
        // Built as one in-memory buffer + a single write — writing this file
        // one small `write_all` at a time is fine for a dozen triangles but
        // far too slow (millions of syscalls) for the ~1M-triangle mesh the
        // size-independence test below needs.
        let mut buf = Vec::with_capacity(84 + tris.len() * 50);
        buf.extend_from_slice(&[0u8; 80]);
        buf.extend_from_slice(&(tris.len() as u32).to_le_bytes());
        for t in tris {
            let n = t[1].sub(t[0]).cross(t[2].sub(t[0])).norm();
            for comp in [n.x, n.y, n.z] {
                buf.extend_from_slice(&comp.to_le_bytes());
            }
            for v in t {
                for comp in [v.x, v.y, v.z] {
                    buf.extend_from_slice(&comp.to_le_bytes());
                }
            }
            buf.extend_from_slice(&[0u8; 2]);
        }
        std::fs::write(path, &buf).unwrap();
    }

    fn write_ascii_stl(path: &Path, tris: &[Tri]) {
        let mut f = File::create(path).unwrap();
        writeln!(f, "solid test").unwrap();
        for t in tris {
            writeln!(f, "facet normal 0 0 0").unwrap();
            writeln!(f, "outer loop").unwrap();
            for v in t {
                writeln!(f, "vertex {} {} {}", v.x, v.y, v.z).unwrap();
            }
            writeln!(f, "endloop").unwrap();
            writeln!(f, "endfacet").unwrap();
        }
        writeln!(f, "endsolid test").unwrap();
    }

    /// Peak resident set size (kB) since process start, from `/proc/self/status`.
    /// Linux-only (dev/CI env for this task); used only as a coarse memory
    /// growth signal, not exact accounting.
    #[cfg(target_os = "linux")]
    fn vm_hwm_kb() -> u64 {
        let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
        for line in status.lines() {
            if let Some(rest) = line.strip_prefix("VmHWM:") {
                return rest.trim().trim_end_matches("kB").trim().parse().unwrap_or(0);
            }
        }
        0
    }

    #[test]
    fn binary_cube_parses_expected_tris_and_dims() {
        let dir = std::env::temp_dir().join(format!("trove-thumbgen-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cube_bin.stl");
        let tris = cube_tris();
        assert_eq!(tris.len(), 12);
        write_binary_stl(&path, &tris);

        let parsed = read_stl(&path).unwrap();
        assert_eq!(parsed.len(), 12);

        let (_img, dims) = render_stl_thumb(&path, 64).unwrap();
        assert_eq!((dims.w, dims.h, dims.d), (2, 3, 4)); // w=x, h=y, d=z
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn ascii_cube_matches_binary_dims() {
        let dir = std::env::temp_dir().join(format!("trove-thumbgen-test-ascii-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin_path = dir.join("cube_bin.stl");
        let ascii_path = dir.join("cube_ascii.stl");
        let tris = cube_tris();
        write_binary_stl(&bin_path, &tris);
        write_ascii_stl(&ascii_path, &tris);

        let (_bin_img, bin_dims) = render_stl_thumb(&bin_path, 64).unwrap();
        let (_ascii_img, ascii_dims) = render_stl_thumb(&ascii_path, 64).unwrap();
        assert_eq!((bin_dims.w, bin_dims.d, bin_dims.h), (ascii_dims.w, ascii_dims.d, ascii_dims.h));
        let _ = std::fs::remove_file(&bin_path);
        let _ = std::fs::remove_file(&ascii_path);
    }

    #[test]
    fn rendered_image_is_not_uniform_background() {
        let dir = std::env::temp_dir().join(format!("trove-thumbgen-test-render-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cube.stl");
        write_binary_stl(&path, &cube_tris());

        let (img, _dims) = render_stl_thumb(&path, 128).unwrap();
        let drawn = img.pixels().any(|p| *p != BG);
        assert!(drawn, "expected at least one non-background pixel");
        let _ = std::fs::remove_file(&path);
    }

    /// Replaces the old `over_budget_mesh_is_strided_and_still_renders`, which
    /// built MAX_TRIS+5000 *identical* triangles — a test that passed even if
    /// stride sampling kept exactly one triangle, since every kept triangle
    /// looked the same. That masked the actual bug (PLAN.md AMENDMENT 1):
    /// stride sampling paints only ~1/stride of a mesh's silhouette, so
    /// coverage collapsed as triangle count grew even though the underlying
    /// shape didn't change. This test tessellates the *same* sphere at two
    /// very different densities and asserts near-identical rendered coverage
    /// — the size-independence property a triangle budget must preserve.
    ///
    /// Must fail against the old stride code (coverage collapses at the high
    /// density) and pass after removing it.
    #[test]
    fn coverage_is_size_independent_across_tessellation_density() {
        let dir = std::env::temp_dir().join(format!("trove-thumbgen-test-sphere-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let small_path = dir.join("sphere_57k.stl");
        let big_path = dir.join("sphere_1m.stl");

        // Same sphere (radius 1, centered at the origin), two tessellation
        // densities: 57,600 tris (well under MAX_IN_MEMORY_TRIS -> in-memory
        // path) and 1,000,000 tris (well over -> two-pass streaming path).
        let small = uv_sphere(120, 240, 1.0);
        assert_eq!(small.len(), 57_600);
        let big = uv_sphere(500, 1000, 1.0);
        assert_eq!(big.len(), 1_000_000);
        write_binary_stl(&small_path, &small);
        write_binary_stl(&big_path, &big);
        drop(small);
        drop(big);

        #[cfg(target_os = "linux")]
        let hwm_before = vm_hwm_kb();

        let (small_img, _) = render_stl_thumb(&small_path, 128).expect("small sphere should render");
        let (big_img, _) = render_stl_thumb(&big_path, 128).expect("big sphere should render");

        #[cfg(target_os = "linux")]
        {
            let grew_kb = vm_hwm_kb().saturating_sub(hwm_before);
            // A retained Vec<Tri> for the 1M-triangle mesh would be ~36 MB
            // (36 bytes/tri); the streaming path's only sustained allocation
            // is the framebuffer + z-buffer (a few hundred KB at this size).
            // Comfortably under that bound means no triangle Vec was kept
            // around for the big mesh.
            assert!(
                grew_kb < 20_000,
                "peak RSS grew {grew_kb} kB rendering both spheres — looks like \
                 the streaming path retained a triangle Vec (a 1M-tri Vec is ~36 MB)"
            );
        }

        let non_bg = |img: &RgbImage| img.pixels().filter(|p| **p != BG).count();
        let small_px = non_bg(&small_img);
        let big_px = non_bg(&big_img);
        let ratio = big_px as f64 / small_px as f64;
        eprintln!(
            "[coverage] 57,600 tris = {small_px} px, 1,000,000 tris = {big_px} px, ratio = {ratio:.3}"
        );
        assert!(
            (0.8..=1.2).contains(&ratio),
            "coverage not size-independent: {small_px} px @ 57,600 tris vs {big_px} px \
             @ 1,000,000 tris (ratio {ratio:.3}, want 0.8..=1.2)"
        );

        let _ = std::fs::remove_file(&small_path);
        let _ = std::fs::remove_file(&big_path);
    }

    #[test]
    fn garbage_input_returns_none_not_panic() {
        let dir = std::env::temp_dir().join(format!("trove-thumbgen-test-garbage-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("garbage.stl");
        std::fs::write(&path, b"not an stl file at all, just some bytes\x00\x01\x02").unwrap();

        assert!(render_stl_thumb(&path, 64).is_none());

        // Also: a nonexistent path must not panic.
        assert!(render_stl_thumb(&dir.join("does-not-exist.stl"), 64).is_none());
        let _ = std::fs::remove_file(&path);
    }
}
