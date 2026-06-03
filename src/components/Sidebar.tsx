/* Sidebar.tsx — left navigation. */

import { Icon, Logo, Avatar } from "./Icons";
import { useDataset } from "../data/dataset";
import { useApp } from "../lib/store";
import type { Route } from "../data/types";

export function Sidebar() {
  const route = useApp((s) => s.route);
  const fav = useApp((s) => s.fav);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const nav = useApp((s) => s.nav);
  const S = useDataset();
  const displayName = useApp((s) => s.name) || "Local profile";

  const items: { id: Route["name"]; icon: string; label: string; count?: number }[] = [
    { id: "library", icon: "grid", label: "Library", count: S.stats.models },
    { id: "search", icon: "search", label: "Search" },
    { id: "favorites", icon: "heart", label: "Favorites", count: fav.length },
    { id: "collections", icon: "layers", label: "Collections", count: S.COLLECTIONS.length },
    { id: "creators", icon: "user", label: "Creators", count: S.CREATORS.length },
    { id: "storage", icon: "server", label: "Libraries" },
  ];

  return (
    <aside className={"sidebar" + (sidebarOpen ? " open" : "")}>
      <div className="sidebar-head">
        <button className="nav-item" style={{ height: "auto", padding: 4 }} onClick={() => nav({ name: "library" })}>
          <Logo size={28} />
        </button>
      </div>
      <nav className="sidebar-nav">
        {items.map((it) => (
          <button key={it.id} className={"nav-item" + (route.name === it.id ? " is-active" : "")} onClick={() => nav({ name: it.id } as Route)}>
            <Icon name={it.icon} size={19} />{it.label}
            {it.count != null && <span className="count">{it.count}</span>}
          </button>
        ))}
        <div className="nav-section">Collections</div>
        {S.COLLECTIONS.slice(0, 4).map((c) => (
          <button key={c.id} className="nav-item" onClick={() => nav({ name: "collection", id: c.id })}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: c.tone, flexShrink: 0 }} />{c.name}
            <span className="count">{c.count}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <button className="nav-item" onClick={() => nav({ name: "settings" })}>
          <Avatar name={displayName} tone="var(--accent)" size={28} />
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
            <span style={{ fontWeight: 700, fontSize: 13.5 }}>{displayName}</span>
            <span className="faint" style={{ fontSize: 11.5 }}>local profile</span>
          </span>
          <Icon name="settings" size={17} style={{ marginLeft: "auto", opacity: 0.7 }} />
        </button>
      </div>
    </aside>
  );
}
