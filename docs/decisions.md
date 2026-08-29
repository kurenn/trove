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
