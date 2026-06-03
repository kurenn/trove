/* Topbar.tsx — top bar with search trigger, theme toggle, mount action. */

import { Icon } from "./Icons";
import { useApp } from "../lib/store";

export function Topbar() {
  const query = useApp((s) => s.query);
  const dark = useApp((s) => s.tweaks.dark);
  const nav = useApp((s) => s.nav);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const setSidebarOpen = useApp((s) => s.setSidebarOpen);
  const setSearchOpen = useApp((s) => s.setSearchOpen);

  return (
    <div className="topbar">
      <button className="btn btn-icon menu-btn" onClick={() => setSidebarOpen(true)}><Icon name="rows" /></button>
      <button className="searchbar-trigger" onClick={() => setSearchOpen(true)}>
        <Icon name="search" size={18} />
        <span className={query ? "" : "ph"}>{query || "Search models, tags, creators…"}</span>
        <kbd>⌘K</kbd>
      </button>
      <div className="spacer" />
      <button className="btn btn-icon" title="Toggle theme" onClick={toggleTheme}>
        <Icon name={dark ? "sun" : "moon"} />
      </button>
      <button className="btn btn-icon" title="Notifications"><Icon name="bell" /></button>
      <button className="btn btn-primary" onClick={() => nav({ name: "storage", openAdd: true })}>
        <Icon name="folder" size={18} /> Mount folder
      </button>
    </div>
  );
}
