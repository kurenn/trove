/* Setup.tsx — first-run onboarding (Name → Folder → Ready).
   Ported from the design handoff. Under Tauri it drives the real native folder
   picker + streaming scan (ring/list/stats come from the live index); in a plain
   browser it simulates the scan so the flow still demos. */

import { useEffect, useRef, useState } from "react";
import { Icon, Logo, Avatar } from "../components/Icons";
import { useDataset } from "../data/dataset";
import { useApp } from "../lib/store";
import { isTauri, api, pickFolder } from "../lib/tauri";
import { ShortcutField } from "../components/ShortcutField";

const STEPS = ["Name", "Folder", "Ready"] as const;
const PLACEHOLDER = "/srv/3d-models";
const SIM_FILES = [
  "helix_vase.3mf", "cable_tray.step", "koi_flexi.3mf", "d20.stl",
  "planetary.3mf", "lowpoly_fox.stl", "bracket.step", "flexi_dragon.3mf",
];

/** Animated gem mark. */
function OnboardMark({ size = 56 }: { size?: number }) {
  return (
    <svg className="ob-mark" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect className="gem-glow" x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)" opacity=".4" />
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)" />
      <g stroke="var(--accent-ink)" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round">
        <path className="facet" d="M16 6 L25 13.5 L16 26 L7 13.5 Z" />
        <path className="facet" d="M7 13.5 H25" />
        <path className="facet" d="M16 6 L12.5 13.5 L16 26" />
        <path className="facet" d="M16 6 L19.5 13.5 L16 26" />
      </g>
    </svg>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  // pathLength normalizes the dash math to 0–100 units regardless of the
  // rendered circle geometry (avoids the arc not drawing in some webviews).
  return (
    <div className={"ob-ring" + (p >= 100 ? " done" : "")}>
      <svg viewBox="0 0 84 84">
        <circle className="track" cx="42" cy="42" r="36" fill="none" strokeWidth="6" />
        <circle className="bar" cx="42" cy="42" r="36" fill="none" strokeWidth="6"
                pathLength={100} strokeDasharray={`${p} 100`} />
      </svg>
      <div className="pct">{p >= 100 ? <Icon name="check" size={26} style={{ color: "var(--accent)" }} /> : `${Math.round(p)}%`}</div>
    </div>
  );
}

/** Smooth, decelerating "percent" from an unknown-total streaming file count. */
const softPct = (files: number) => Math.min(96, Math.round(100 * (1 - 1 / (1 + files / 250))));

interface ScanLine { key: string; label: string; rendered: boolean }

export function SetupWizard({ onDone, onSkip }: { onDone: (name: string) => void; onSkip: () => void }) {
  const S = useDataset();
  const libraries = useApp((s) => s.libraries);
  const storedName = useApp((s) => s.name);
  const qfShortcut = useApp((s) => s.quickfindShortcut);
  const setQfShortcut = useApp((s) => s.setQuickfindShortcut);

  // Dev-only deep-link for screenshots/QA: ?obstep=1&obname=Ada&obpath=/x
  const dev = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
  const [step, setStep] = useState(dev ? Number(dev.get("obstep")) || 0 : 0);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState(dev?.get("obname") ?? storedName);
  const [path, setPath] = useState(dev?.get("obpath") ?? "");
  const [opts, setOpts] = useState({ watch: true, thumbs: true });
  const [shown, setShown] = useState(false);
  const [simScanned, setSimScanned] = useState(0);
  const [libId, setLibId] = useState<string | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // WebKit form inputs don't always reflow when a web font loads late, leaving
  // the big name field's text mis-aligned until focus. `document.fonts.ready` is
  // not enough here: it can resolve BEFORE the display face's binary is even
  // requested (Google's CSS loads, but the font file is fetched lazily on first
  // use), so the remount can fire while the fallback metrics are still in place.
  // Explicitly load the EXACT face this input uses, then flip — remounting with
  // correct metrics (the controlled value is preserved across the remount).
  useEffect(() => {
    let alive = true;
    const fonts = (document as any).fonts;
    const FACE = "700 24px 'Bricolage Grotesque'";
    if (!fonts?.load) { setFontsReady(true); return; }
    if (fonts.check?.(FACE)) { setFontsReady(true); return; } // already cached
    Promise.resolve(fonts.load(FACE))
      .catch(() => {})
      .finally(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (fontsReady && step === 0) nameRef.current?.focus(); }, [fontsReady, step]);

  const first = name.trim().split(/\s+/)[0] || "";

  // Real (Tauri) scan state derived from the live index; simulated otherwise.
  const lib = libId ? libraries.find((l) => l.id === libId) : undefined;
  const done = isTauri
    ? !!lib && lib.status !== "scanning"
    : simScanned >= SIM_FILES.length;
  const pct = isTauri
    ? (done ? 100 : softPct(lib?.files ?? 0))
    : (simScanned / SIM_FILES.length) * 100;

  const scanLines: ScanLine[] = isTauri
    ? S.MODELS.slice(0, 16).map((m) => ({
        key: m.id,
        label: m.parts[0]?.files[0]?.name || m.name,
        rendered: opts.thumbs && !!m.thumb,
      }))
    : SIM_FILES.slice(0, simScanned).map((fn) => ({ key: fn, label: fn, rendered: opts.thumbs }));

  // autofocus the name field
  useEffect(() => { if (step === 0) nameRef.current?.focus(); }, [step]);

  // entrance gate: add ob-go one frame after each step mounts
  useEffect(() => {
    setShown(false);
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setShown(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [step]);

  // Browser-only simulated scan when reaching step 2.
  useEffect(() => {
    if (step !== 2 || isTauri) return;
    setSimScanned(0);
    const iv = setInterval(() => {
      setSimScanned((n) => { if (n >= SIM_FILES.length) { clearInterval(iv); return n; } return n + 1; });
    }, 380);
    return () => clearInterval(iv);
  }, [step]);

  const canContinue = step === 0 ? first.length > 0 : step === 1 ? path.trim().length > 0 : done;

  const go = (next: number) => { setDir(next > step ? 1 : -1); setStep(next); };

  const browse = async () => {
    const p = await pickFolder();
    if (p) setPath(p);
    else if (!isTauri && !path.trim()) setPath(PLACEHOLDER); // browser demo: fill placeholder
  };

  // Kick off the real scan when moving from Folder → Ready (Tauri only).
  const startRealScan = async () => {
    if (!isTauri) return;
    try {
      const updated = await api.addLibrary(path.trim(), name.trim() || null, {
        organize: true, tags: true, thumbs: opts.thumbs, watch: opts.watch,
      });
      useApp.getState().setLibraries(updated);
      const created = updated.find((l) => l.path === path.trim());
      setLibId(created?.id ?? null);
    } catch (e) {
      useApp.getState().toast(String(e));
    }
  };

  const advance = () => {
    if (step === 0) { go(1); return; }
    if (step === 1) { startRealScan(); go(2); return; }
    onDone(name.trim());
  };
  const onKeyName = (e: React.KeyboardEvent) => { if (e.key === "Enter" && canContinue) advance(); };

  return (
    <div className="ob">
      <div className="ob-inner">
        <div className="ob-top">
          <Logo size={28} />
          <button className="btn btn-ghost btn-sm" onClick={onSkip}>Skip setup <Icon name="arrowRight" size={15} /></button>
        </div>

        <div className="ob-prog">
          {STEPS.map((s, i) => (
            <div key={s} className={"ob-pip " + (i < step ? "done" : i === step ? "active" : "")}><i /></div>
          ))}
          <span className="ob-count">{String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")} · {STEPS[step]}</span>
        </div>

        <div className="ob-card ob-stage" data-dir={dir}>
          <div className={"ob-screen" + (shown ? " ob-go" : "")} key={step}>

            {step === 0 && (
              <div className="ob-stagger">
                <OnboardMark size={56} />
                <div>
                  <div className="ob-eyebrow">Welcome to Trove</div>
                  <h1 className="ob-h">Let's set up your library.<br />First — what should we call you?</h1>
                </div>
                <p className="ob-sub">Trove reads your model files in place. Nothing is ever moved, renamed, or modified.</p>
                <input key={fontsReady ? "name-f1" : "name-f0"} ref={nameRef} className="ob-bigin" value={name} placeholder="Your name"
                       onChange={(e) => setName(e.target.value)} onKeyDown={onKeyName} aria-label="Your name" />
                <div className="ob-greet">
                  {first ? (
                    <>
                      <span className="ob-greet-in"><Avatar name={name} tone="var(--accent)" size={44} /></span>
                      <span className="gtext">Nice to meet you, <b>{first}</b>.</span>
                    </>
                  ) : (
                    <span className="gtext faint">We'll use this to personalize your space.</span>
                  )}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="ob-stagger">
                <div className={"ob-folder" + (path.trim() ? " open" : "")}>
                  <div className="fld-tab" />
                  <div className="fld-back" />
                  <div className="sheet s1"><b /><b /><b /></div>
                  <div className="sheet s2"><b /><b /><b /></div>
                  <div className="sheet s3"><b /><b /><b /></div>
                  <div className="fld-front" />
                </div>
                <div>
                  <div className="ob-eyebrow">Step 2 · Your folder</div>
                  <h1 className="ob-h">Point Trove at one folder of models.</h1>
                </div>
                <p className="ob-sub">{first ? `Pick the folder where your files live, ${first}. ` : "Pick the folder where your files live. "}You can add more libraries later.</p>
                <div className="ob-pathrow">
                  <input className="input spool-mono" value={path} placeholder={PLACEHOLDER}
                         onChange={(e) => setPath(e.target.value)} aria-label="Folder path" />
                  <button className="btn" onClick={browse}><Icon name="folder" size={16} /> Browse…</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                  {([["watch", "eye", "Watch for changes", "Auto-index new files"],
                     ["thumbs", "cube", "Render thumbnails", "3D previews for each model"]] as const).map(([k, ic, t, d]) => (
                    <button key={k} className="ob-opt" onClick={() => setOpts((o) => ({ ...o, [k]: !o[k] }))}
                            style={opts[k] ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}>
                      <span className="oic"><Icon name={ic} size={18} /></span>
                      <span style={{ flex: 1, textAlign: "left" }}>
                        <span className="ot">{t}</span>
                        <span className="od">{d}</span>
                      </span>
                      {opts[k] && <Icon name="check" size={17} style={{ color: "var(--accent)" }} />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="ob-stagger">
                <ProgressRing pct={pct} />
                <div style={{ textAlign: "center" }}>
                  <div className="ob-eyebrow">{done ? "All set" : "Building your library"}</div>
                  <h1 className="ob-h" style={{ marginTop: 8 }}>
                    {done ? <>You're ready{first ? <>, {first}</> : ""}.</> : "Indexing your models…"}
                  </h1>
                  <p className="ob-sub spool-mono" style={{ margin: "8px auto 0", fontSize: 13 }}>{path || PLACEHOLDER}</p>
                </div>
                <div className="ob-scanlist" style={{ maxHeight: 196, overflowY: "auto" }}>
                  {scanLines.map((ln) => (
                    <div key={ln.key} className="ob-scanline">
                      <Icon name="check" size={14} className="ok" />
                      <span className="nm">{ln.label}</span>
                      {ln.rendered && <span className="meta">rendered</span>}
                    </div>
                  ))}
                  {!done && (
                    <div className="ob-scanline" style={{ color: "var(--ink-3)" }}>
                      <Icon name="refresh" size={14} style={{ animation: "obSpin 1s linear infinite" }} /> indexing…
                    </div>
                  )}
                </div>
                {done && (
                  <>
                    <div className="stat-row">
                      <div className="stat"><div className="v">{S.stats.models}</div><div className="k">models found</div></div>
                      <div className="stat"><div className="v">{S.stats.files}</div><div className="k">files</div></div>
                      <div className="stat"><div className="v">{S.ALL_TAGS.length}</div><div className="k">tags created</div></div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 18, padding: "12px 14px", borderRadius: "var(--r-md)", background: "var(--surface-2)" }}>
                      <span style={{ fontSize: 13.5 }}>
                        <Icon name="search" size={14} style={{ verticalAlign: "-2px", color: "var(--accent)" }} /> Summon <b>Quick Find</b> from anywhere with
                      </span>
                      <ShortcutField value={qfShortcut} onChange={setQfShortcut} />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="ob-nav">
          <button className="btn btn-ghost" onClick={() => (step === 0 ? onSkip() : go(step - 1))}>
            <Icon name="arrowLeft" size={16} /> {step === 0 ? "Not now" : "Back"}
          </button>
          <button className="btn btn-primary btn-lg" disabled={!canContinue} onClick={advance}>
            {step === 0 ? "Continue" : step === 1 ? "Scan my folder" : "Enter Trove"}
            <Icon name="arrowRight" size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
