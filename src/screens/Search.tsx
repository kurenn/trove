/* Search.tsx — advanced search screen. */

import { useEffect, useMemo, useState } from "react";
import { Icon, Tag } from "../components/Icons";
import { FiltersPanel, Toolbar } from "../components/filters";
import { ModelResults } from "../components/cards";
import { useDataset, applyFilters } from "../data/dataset";
import { DEFAULT_FILTERS } from "../data/types";
import { useApp } from "../lib/store";
import type { Filters, Model, Route } from "../data/types";

export function SearchScreen({ route }: { route: Extract<Route, { name: "search" }> }) {
  const query = useApp((s) => s.query);
  const setQuery = useApp((s) => s.setQuery);
  const fav = useApp((s) => s.fav);
  const onFav = useApp((s) => s.toggleFav);
  const nav = useApp((s) => s.nav);
  const S = useDataset();

  const seed = useMemo<Filters>(() => {
    const base: Filters = { ...DEFAULT_FILTERS, tags: [] };
    if (route.tag) base.tags = [route.tag];
    if (route.saved) base.tags = [...route.saved.tags];
    return base;
  }, [route]);

  const [f, setF] = useState<Filters>(seed);
  const [view, setView] = useState<"grid" | "list">("grid");
  useEffect(() => { setF(seed); if (route.saved) setQuery(route.saved.q || ""); }, [seed]);

  const results = applyFilters(S.MODELS, query, f);
  const onOpen = (m: Model) => nav({ name: "model", id: m.id });
  const suggestions = ["support-free", "articulated", "vase-mode", "functional", "low-poly"];

  return (
    <div className="content-inner fade-in">
      <h1 className="page-title">Search</h1>
      <div className="searchbar" style={{ maxWidth: "100%", margin: "18px 0 8px" }}>
        <Icon name="search" size={20} />
        <input className="input" style={{ height: 52, fontSize: 16 }} autoFocus placeholder="Search by name, tag, creator, file type…"
               value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
        <span className="faint" style={{ fontSize: 13, fontWeight: 600 }}>Try:</span>
        {suggestions.map((s) => <Tag key={s} active={f.tags.includes(s)} onClick={() => setF((x) => ({ ...x, tags: x.tags.includes(s) ? x.tags.filter((t) => t !== s) : [...x.tags, s] }))}>{s}</Tag>)}
        <div className="spacer" />
        <button className="btn btn-sm"><Icon name="bookmark" size={15} /> Save this search</button>
      </div>

      <Toolbar view={view} setView={setView} count={results.length} hideFilterToggle />
      <div className="with-filters">
        <FiltersPanel f={f} setF={setF} models={S.MODELS} />
        <ModelResults models={results} view={view} onOpen={onOpen} fav={fav} onFav={onFav} />
      </div>
    </div>
  );
}
