/* Library.tsx — home grid with faceted filters and active-filter pills. */

import { useState } from "react";
import { Icon } from "../components/Icons";
import { FiltersPanel, Toolbar } from "../components/filters";
import { ModelResults } from "../components/cards";
import { useDataset, applyFilters } from "../data/dataset";
import { DEFAULT_FILTERS } from "../data/types";
import { useApp } from "../lib/store";
import type { Filters, Model } from "../data/types";

export function LibraryScreen() {
  const query = useApp((s) => s.query);
  const fav = useApp((s) => s.fav);
  const onFav = useApp((s) => s.toggleFav);
  const nav = useApp((s) => s.nav);
  const S = useDataset();

  const [view, setView] = useState<"grid" | "list">("grid");
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(true);
  const results = applyFilters(S.MODELS, query, f);
  const onOpen = (m: Model) => nav({ name: "model", id: m.id });

  const activePills: [keyof Filters, string | boolean, string][] = [
    ...f.tags.map((t) => ["tags", t, t] as [keyof Filters, string, string]),
    ...f.types.map((t) => ["types", t, t.toUpperCase()] as [keyof Filters, string, string]),
    ...f.licenses.map((t) => ["licenses", t, t] as [keyof Filters, string, string]),
    ...(f.supportFree ? ([["supportFree", true, "support-free"]] as [keyof Filters, boolean, string][]) : []),
  ];
  const removePill = (key: keyof Filters, val: string | boolean) =>
    setF((s) => key === "supportFree"
      ? { ...s, supportFree: false }
      : { ...s, [key]: (s[key] as string[]).filter((x) => x !== val) });

  return (
    <div className="content-inner fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Library</h1>
          <p className="page-sub">{S.stats.models} models · {S.stats.files} files · {S.stats.filament}g of filament catalogued</p>
        </div>
        <div className="stat-row" style={{ maxWidth: 360 }}>
          <div className="stat"><div className="v">{S.CREATORS.length}</div><div className="k">creators</div></div>
          <div className="stat"><div className="v">{S.COLLECTIONS.length}</div><div className="k">collections</div></div>
        </div>
      </div>

      {S.MODELS.length === 0 ? (
        <div className="empty">
          <Icon name="folder" size={40} style={{ opacity: 0.4 }} />
          <p style={{ marginTop: 14, fontWeight: 700, fontSize: 16 }}>No models yet</p>
          <p style={{ fontSize: 13.5, maxWidth: 360, margin: "6px auto 0" }}>
            Mount a folder of 3D files and Trove will index it in place — nothing is moved or modified.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={() => nav({ name: "storage", openAdd: true })}>
            <Icon name="folder" size={17} /> Mount a folder
          </button>
        </div>
      ) : (
      <>
      <Toolbar view={view} setView={setView} count={results.length} showFilters={showFilters} onToggleFilters={() => setShowFilters(!showFilters)} />

      {activePills.length > 0 && (
        <div className="active-filters">
          {activePills.map(([k, v, l]) => (
            <span key={String(k) + String(v)} className="fpill">{l}<button onClick={() => removePill(k, v)}><Icon name="x" size={13} /></button></span>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => setF(DEFAULT_FILTERS)}>Clear all</button>
        </div>
      )}

      {showFilters
        ? <div className="with-filters">
            <FiltersPanel f={f} setF={setF} models={S.MODELS} />
            <ModelResults models={results} view={view} onOpen={onOpen} fav={fav} onFav={onFav} />
          </div>
        : <ModelResults models={results} view={view} onOpen={onOpen} fav={fav} onFav={onFav} />}
      </>
      )}
    </div>
  );
}
