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

use image::{Rgb, RgbImage};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

/// Bounding-box dimensions in model units, rounded — matches what the webview
/// stores via `save_thumb` (w = x, d = z, h = y).
pub struct Dims {
    pub w: u32,
    pub d: u32,
    pub h: u32,
}

/// Triangle budget: bounds memory (kept triangles are the only thing retained)
/// and rasterization time regardless of source file size. Meshes over this are
/// strided down — kept, not truncated, so the sampled set still spans the
/// whole model rather than just its first N triangles.
const MAX_TRIS: usize = 200_000;

/// A single line in an ASCII STL is never legitimately this long — anything
/// longer is treated as malformed rather than grown without bound.
const MAX_ASCII_LINE: usize = 4096;

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

/// Read an STL (binary or ASCII) and rasterize a shaded `size`x`size` preview.
/// Streams the file; never loads more than the triangle budget into memory.
/// Returns `None` for unreadable/empty/degenerate meshes.
pub fn render_stl_thumb(path: &Path, size: u32) -> Option<(RgbImage, Dims)> {
    if size == 0 {
        return None;
    }
    let tris = read_stl(path)?;
    if tris.is_empty() {
        return None;
    }
    let (min, max) = bbox(&tris);
    let extent = max.sub(min);
    let max_dim = extent.x.max(extent.y).max(extent.z);
    if !(max_dim > 1e-6) {
        return None; // single point / coincident geometry — nothing to render
    }
    let dims = Dims {
        w: extent.x.max(0.0).round() as u32,
        d: extent.z.max(0.0).round() as u32,
        h: extent.y.max(0.0).round() as u32,
    };
    let img = rasterize(&tris, min, max, max_dim, size);
    Some((img, dims))
}

// ── STL parsing ─────────────────────────────────────────────────────────────

/// Binary iff `file_len == 84 + count*50` (80-byte header + u32 count, read up
/// front) — NOT by sniffing a leading "solid", which binary files can carry too.
fn read_stl(path: &Path) -> Option<Vec<Tri>> {
    let mut file = File::open(path).ok()?;
    let file_len = file.metadata().ok()?.len();
    let mut header = [0u8; 84];
    let is_binary = file_len >= 84
        && file.read_exact(&mut header).is_ok()
        && {
            // header[80..84] is always exactly 4 bytes — try_into can't fail here.
            let count = u32::from_le_bytes(header[80..84].try_into().unwrap());
            file_len == 84 + count as u64 * 50
        };
    file.seek(SeekFrom::Start(0)).ok()?;
    if is_binary {
        read_binary(file)
    } else {
        read_ascii(file)
    }
}

/// Streaming binary parse: 50 bytes/triangle (u16 attr byte-count trailer is
/// read and discarded, never interpreted). `BufReader` — never `read_to_end`.
fn read_binary(file: File) -> Option<Vec<Tri>> {
    let mut r = BufReader::new(file);
    let mut header = [0u8; 84];
    r.read_exact(&mut header).ok()?;
    let count = u32::from_le_bytes(header[80..84].try_into().ok()?) as usize;
    if count == 0 {
        return None;
    }
    let stride = if count > MAX_TRIS { count / MAX_TRIS + 1 } else { 1 };
    let mut kept = Vec::with_capacity(count.min(MAX_TRIS) + 1);
    let mut buf = [0u8; 50];
    for i in 0..count {
        if r.read_exact(&mut buf).is_err() {
            break; // truncated file — render whatever was decoded so far
        }
        if i % stride != 0 {
            continue;
        }
        let f = |o: usize| f32::from_le_bytes(buf[o..o + 4].try_into().unwrap());
        // buf[0..12] is the stored facet normal — recomputed from the vertices
        // below instead, so a zeroed/bogus normal in the file can't matter.
        // Layout: normal@0 (12B), v1@12, v2@24, v3@36 (12B each), attr@48 (2B).
        let v = |o: usize| V3 { x: f(o), y: f(o + 4), z: f(o + 8) };
        kept.push([v(12), v(24), v(36)]);
    }
    Some(kept)
}

/// Line-oriented ASCII parse over `BufReader`. Two passes: the first counts
/// `vertex` lines (÷3 = triangle count) so the exact same stride formula as
/// the binary path applies; the second collects the kept triangles. Bounded —
/// an overlong single line (no legitimate STL line is anywhere near 4KB) aborts
/// the parse rather than growing a line buffer without limit.
fn read_ascii(file: File) -> Option<Vec<Tri>> {
    let mut file = file;
    let count = count_ascii_vertices(&mut file)? / 3;
    if count == 0 {
        return None;
    }
    file.seek(SeekFrom::Start(0)).ok()?;
    let stride = if count > MAX_TRIS { count / MAX_TRIS + 1 } else { 1 };

    let mut r = BufReader::new(file);
    let mut line = String::new();
    let mut verts: Vec<V3> = Vec::with_capacity(3);
    let mut kept = Vec::with_capacity(count.min(MAX_TRIS) + 1);
    let mut tri_idx = 0usize;
    loop {
        line.clear();
        let n = r.read_line(&mut line).ok()?;
        if n == 0 {
            break; // EOF
        }
        if line.len() > MAX_ASCII_LINE {
            return None; // not a real STL line — malformed input
        }
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
            if tri_idx % stride == 0 {
                kept.push([verts[0], verts[1], verts[2]]);
            }
            verts.clear();
            tri_idx += 1;
        }
    }
    Some(kept)
}

/// First pass of the ASCII reader: just count `vertex` lines, bounded the same
/// way as the real pass, so the caller can compute the stride upfront.
fn count_ascii_vertices(file: &mut File) -> Option<usize> {
    file.seek(SeekFrom::Start(0)).ok()?;
    let mut r = BufReader::new(&mut *file);
    let mut line = String::new();
    let mut n = 0usize;
    loop {
        line.clear();
        let read = r.read_line(&mut line).ok()?;
        if read == 0 {
            break;
        }
        if line.len() > MAX_ASCII_LINE {
            return None;
        }
        // Same tokenization as the real pass below, so the count it produces
        // lines up exactly with what that pass will actually collect.
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

/// Orthographic, z-buffered, flat-shaded rasterizer. `min`/`max` and `max_dim`
/// are the bbox of the *kept* triangles (post-stride), matching `render_stl_thumb`.
fn rasterize(tris: &[Tri], min: V3, max: V3, max_dim: f32, size: u32) -> RgbImage {
    let center = V3 { x: (min.x + max.x) / 2.0, y: (min.y + max.y) / 2.0, z: (min.z + max.z) / 2.0 };
    let scale = 2.0 / max_dim; // largest raw dimension → span 2.0, matching `normalize()` in loaders.ts
    let to_local = |v: V3| v.sub(center).scale(scale);
    let project = |v: V3| {
        let l = to_local(v);
        (l.dot(CAM_RIGHT), l.dot(CAM_UP), l.dot(EYE))
    };

    // Pass 1: projected 2D extent, so the frame fits the mesh regardless of
    // viewing angle (a cube's silhouette diagonal is wider than its edge).
    let (mut lo_x, mut lo_y, mut hi_x, mut hi_y) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for t in tris {
        for &v in t {
            let (sx, sy, _) = project(v);
            lo_x = lo_x.min(sx); hi_x = hi_x.max(sx);
            lo_y = lo_y.min(sy); hi_y = hi_y.max(sy);
        }
    }
    let span = (hi_x - lo_x).max(hi_y - lo_y).max(1e-6);
    let px_per_unit = size as f32 * FILL / span;
    let (mid_x, mid_y) = ((lo_x + hi_x) / 2.0, (lo_y + hi_y) / 2.0);
    let half = size as f32 / 2.0;
    let to_pixel = |sx: f32, sy: f32| ((sx - mid_x) * px_per_unit + half, half - (sy - mid_y) * px_per_unit);

    let sz = size as usize;
    let mut img = RgbImage::from_pixel(size, size, BG);
    let mut depth = vec![f32::NEG_INFINITY; sz * sz];

    for t in tris {
        let p: Vec<(f32, f32, f32)> = t.iter().map(|&v| {
            let (sx, sy, sd) = project(v);
            let (px, py) = to_pixel(sx, sy);
            (px, py, sd)
        }).collect();
        let (a, b, c) = (p[0], p[1], p[2]);

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
            continue; // degenerate or fully off-frame
        }
        let edge = |x0: f32, y0: f32, x1: f32, y1: f32, px: f32, py: f32| (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0);
        let area = edge(a.0, a.1, b.0, b.1, c.0, c.1);
        if area.abs() < 1e-6 {
            continue; // zero-area triangle (edge-on to the camera)
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
    img
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

    fn write_binary_stl(path: &Path, tris: &[Tri]) {
        let mut f = File::create(path).unwrap();
        f.write_all(&[0u8; 80]).unwrap();
        f.write_all(&(tris.len() as u32).to_le_bytes()).unwrap();
        for t in tris {
            let n = t[1].sub(t[0]).cross(t[2].sub(t[0])).norm();
            for comp in [n.x, n.y, n.z] {
                f.write_all(&comp.to_le_bytes()).unwrap();
            }
            for v in t {
                for comp in [v.x, v.y, v.z] {
                    f.write_all(&comp.to_le_bytes()).unwrap();
                }
            }
            f.write_all(&[0u8; 2]).unwrap();
        }
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

    #[test]
    fn over_budget_mesh_is_strided_and_still_renders() {
        let dir = std::env::temp_dir().join(format!("trove-thumbgen-test-budget-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("many.stl");

        // Same reasonably-sized triangle repeated well past MAX_TRIS — this is
        // what a genuinely high-poly mesh looks like (many facets, modest
        // overall bbox), unlike sliver triangles smeared across a huge span
        // (those go sub-pixel once fit to the frame and prove nothing).
        let n = MAX_TRIS + 5_000;
        let tri: Tri = [
            V3 { x: 0.0, y: 0.0, z: 0.0 },
            V3 { x: 1.0, y: 0.0, z: 0.0 },
            V3 { x: 0.0, y: 1.0, z: 0.3 },
        ];
        let tris: Vec<Tri> = std::iter::repeat(tri).take(n).collect();
        write_binary_stl(&path, &tris);

        let (img, dims) = render_stl_thumb(&path, 96).unwrap();
        assert!(dims.w > 0);
        assert!(img.pixels().any(|p| *p != BG));
        let _ = std::fs::remove_file(&path);
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
