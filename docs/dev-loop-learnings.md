# Dev-loop learnings

Durable, reusable insight from `/dev-loop` runs. Not a diary — the map, not the trip.
One `##` section per run, newest first.

## 2026-08-31 — Rust STL thumbnail rasterizer (`feature/rust-stl-thumbnails`)

### An assertion that cannot fail is worse than no assertion

This run shipped **two** of them before either was caught, both looking rigorous:

1. An over-budget test built `MAX_TRIS + 5_000` **identical** triangles. It passed
   whether decimation kept every triangle, one triangle, or the wrong ones — and it had
   *replaced* a test that was correctly failing. It hid the run's headline defect.
2. Its replacement asserted a `VmHWM` (peak-RSS) delta stayed under a bound. `VmHWM` is
   a since-process-start high-water mark, and the test's own fixtures had already peaked
   ~2x above any bound it could check. `grew_kb` was 0 either way.

Both were found by a rater that **measured** rather than read. Neither Codex nor the
orchestrator caught either by inspection.

**Apply:** a regression test nobody has watched fail is decoration. Require the
before/after — run it against the unfixed code, record the failure, then fix. In the
final round the rater mutation-tested (delete each guard, re-run) and killed 4 mutants
while finding 3 survivors that inspection had missed. Mutation testing is cheap here and
worth making routine.

### Beware process-global metrics in tests

Peak-RSS, process-wide counters, and monotonic high-water marks are polluted by parallel
tests and by the test's own setup. A genuinely isolated memory measurement needs
subprocess isolation. Usually the right answer is to make the regression structurally
impossible instead — collapsing this module to a single streaming path removed the
threshold there was anything to regress against.

### A z-buffer is O(size²) — memory is bounded by the raster target, not the mesh

The plan mandated triangle decimation to bound memory for large STLs. It bounded
nothing that wasn't already bounded, and cost the silhouette: keeping every Nth triangle
paints ~1/stride of the shape. Measured on a UV sphere at 512px — 30.6% coverage at 1M
triangles, **5.9% at 6.7M**. The 335 MB model the feature was built for rendered as
scattered dots. Two streaming passes (bbox, then rasterize) bound memory by the
framebuffer at any input size, and the code got *shorter*.

**Apply:** before decimating geometry for "memory", check what actually holds memory.

### `detect()` that reads the whole file is not free

The dual in-memory/streaming path was justified by saving a second read for small files.
But ASCII STL has no length field, so choosing the path required a full streaming vertex
count first: binary cost 1-2 reads, **ASCII cost 2-3**. The optimization was a
pessimization for one of its two formats, over SMB, and nobody measured it.

### Slow work between checkpoints breaks assumptions the surrounding code was built on

The sibling thumbnail passes check cancellation once per item because their per-item work
is milliseconds. Dropping a multi-second mesh render into that shape silently made the
scan uncancellable, and made a "cancel then write" check into a real race window. Three
separate findings across two reviewers all reduced to this one cause.

**Apply:** when inserting slow work into a loop written for fast work, re-derive the
loop's invariants — cancellation granularity, lock hold time, and write atomicity.

### A cache entry keyed on "is it set?" must never be set to a failure

`render_stl_thumb` returned `Some` for a mesh that rasterized to pure background (one
stray far-away vertex does this). The pass wrote a blank JPEG and set `models.thumb` —
and because both the Rust candidate query and the webview's `requestThumb` skip rows
where `thumb` is set, that blank tile was **permanent**. No rescan, no fallback.

**Apply:** wherever presence-of-a-value is the "already done" signal, a failed
computation must write nothing at all.

### Adversarial reviewers repeat themselves; weigh persistence against threat model

Codex raised the same thumbnail-file race in all three rounds. Re-examined each time, it
stayed low: the window is ~1 ms, the flag is set before the competing walk starts, and
the output is deterministic. Decisively, `write_scaled` and `save_thumb` save
non-atomically too — it is a **repo-wide pre-existing pattern**, so fixing it in the new
pass alone would leave two siblings unfixed and break code-fit. Deferred to its own PR.

**Apply:** "the reviewer said it three times" is not evidence of severity. Check whether
the finding is *introduced* by the diff or *inherited* from the surrounding code — the
answer changes which PR should fix it.
