/* Settings.tsx — settings tabs. */

import { useState, type ReactNode } from "react";
import { Icon } from "../components/Icons";
import { useApp } from "../lib/store";
import { isTauri, api } from "../lib/tauri";
import { ShortcutField } from "../components/ShortcutField";

type TabId = "profile" | "library" | "appearance" | "advanced";

export function SettingsScreen() {
  const nav = useApp((s) => s.nav);
  const dark = useApp((s) => s.tweaks.dark);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const name = useApp((s) => s.name);
  const setName = useApp((s) => s.setName);
  const replayOnboarding = useApp((s) => s.replayOnboarding);
  const toast = useApp((s) => s.toast);
  const qfShortcut = useApp((s) => s.quickfindShortcut);
  const setQfShortcut = useApp((s) => s.setQuickfindShortcut);
  const theme = dark ? "dark" : "light";

  const reindexAll = async () => {
    if (!isTauri) { toast("Reindexing…"); return; }
    const libs = useApp.getState().libraries;
    if (!libs.length) { toast("No libraries to reindex"); return; }
    toast("Rebuilding index & thumbnails…");
    for (const l of libs) { try { await api.rescanLibraryForce(l.id); } catch { /* ignore */ } }
  };

  const [tab, setTab] = useState<TabId>(
    (import.meta.env.DEV ? (new URLSearchParams(window.location.search).get("settab") as TabId) : null) || "library"
  );
  const [sw, setSw] = useState({ watch: true, thumbs: true, tags: true, analytics: true, lock: false });

  const TABS: [TabId, string, string][] = [
    ["profile", "Profile", "user"],
    ["library", "Libraries", "folder"],
    ["appearance", "Appearance", "sun"],
    ["advanced", "Advanced", "settings"],
  ];

  const Switch = ({ k }: { k: keyof typeof sw }) =>
    <button className={"switch" + (sw[k] ? " on" : "")} onClick={() => setSw((s) => ({ ...s, [k]: !s[k] }))}><i /></button>;
  const Row = ({ t, d, children }: { t: string; d: string; children: ReactNode }) =>
    <div className="set-row"><div><div className="rt">{t}</div><div className="rd">{d}</div></div>{children}</div>;

  return (
    <div className="content-inner fade-in">
      <div className="page-head"><div><h1 className="page-title">Settings</h1></div></div>
      <div className="settings-grid">
        <div className="set-nav">
          {TABS.map(([id, label, ic]) => (
            <button key={id} className={"nav-item" + (tab === id ? " is-active" : "")} onClick={() => setTab(id)}><Icon name={ic} size={18} />{label}</button>
          ))}
        </div>
        <div>
          {tab === "library" && (
            <div className="set-section">
              <div className="panel">
                <div className="panel-h"><Icon name="server" size={18} /> Mounted folders</div>
                <p className="muted" style={{ fontSize: 13.5, marginTop: -6 }}>Trove indexes models from the folders you mount — local or remote. Manage them on the Libraries screen.</p>
                <button className="btn" style={{ marginTop: 14 }} onClick={() => nav({ name: "storage" })}><Icon name="folder" size={16} /> Manage libraries</button>
              </div>
              <div className="panel">
                <div className="panel-h">Indexing defaults</div>
                <Row t="Watch folders for changes" d="Automatically index new files as they appear in mounted folders."><Switch k="watch" /></Row>
                <Row t="Render 3D thumbnails" d="Generate preview images for every model."><Switch k="thumbs" /></Row>
                <Row t="Smart auto-tagging" d="Infer tags from filenames, folder structure and geometry."><Switch k="tags" /></Row>
              </div>
            </div>
          )}
          {tab === "appearance" && (
            <>
            <div className="panel">
              <div className="panel-h"><Icon name="sun" size={18} /> Appearance</div>
              <Row t="Theme" d="Switch between light and dark."><button className="btn btn-sm" onClick={toggleTheme}><Icon name={theme === "dark" ? "sun" : "moon"} size={15} /> {theme === "dark" ? "Dark" : "Light"}</button></Row>
              <Row t="Default view" d="How the library grid opens."><select className="input btn-sm" style={{ width: "auto", height: 32 }}><option>Grid</option><option>List</option></select></Row>
            </div>
            <div className="panel">
              <div className="panel-h"><Icon name="search" size={18} /> Quick Find</div>
              <Row t="Global shortcut" d="Summon Quick Find from anywhere — even when Trove is in the background. Click to record a new combination.">
                <ShortcutField value={qfShortcut} onChange={setQfShortcut} />
              </Row>
            </div>
            </>
          )}
          {tab === "profile" && (
            <div className="panel">
              <div className="panel-h"><Icon name="user" size={18} /> Profile</div>
              <Row t="Display name" d="Personalizes your Trove."><input className="input btn-sm" style={{ width: 200, height: 32 }} value={name} placeholder="Your name" onChange={(e) => setName(e.target.value)} /></Row>
              <Row t="Require passcode on launch" d="Optionally lock this Trove instance behind a device passcode."><Switch k="lock" /></Row>
            </div>
          )}
          {tab === "advanced" && (
            <div className="panel">
              <div className="panel-h"><Icon name="settings" size={18} /> Advanced</div>
              <Row t="Usage analytics" d="Share anonymous, self-hosted-only usage stats."><Switch k="analytics" /></Row>
              <Row t="Reindex everything" d="Force a full rescan of every library — rebuilds the search index and regenerates all thumbnails. Use after editing files in place."><button className="btn btn-sm" onClick={reindexAll}><Icon name="refresh" size={15} /> Reindex</button></Row>
              <Row t="Replay first-run setup" d="Walk through the onboarding flow again."><button className="btn btn-sm" onClick={replayOnboarding}><Icon name="sparkles" size={15} /> Replay</button></Row>
              <Row t="Version" d="Trove 2.0 · open source"><span className="spool-mono faint">2.0.0</span></Row>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
