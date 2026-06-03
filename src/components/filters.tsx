/* filters.tsx — FacetGroup, FiltersPanel, Toolbar. */

import { useState, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { Icon } from "./Icons";
import { useDataset } from "../data/dataset";
import type { Filters, Model } from "../data/types";

export function FacetGroup({ title, children, defaultOpen = true }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="facet">
      <div className="facet-h" onClick={() => setOpen(!open)}>
        {title}<Icon name={open ? "chevronDown" : "chevronRight"} size={16} style={{ color: "var(--ink-3)" }} />
      </div>
      {open && <div className="facet-body">{children}</div>}
    </div>
  );
}

interface FiltersPanelProps {
  f: Filters;
  setF: Dispatch<SetStateAction<Filters>>;
  models: Model[];
}

export function FiltersPanel({ f, setF, models }: FiltersPanelProps) {
  const S = useDataset();
  const count = (pred: (m: Model) => boolean) => models.filter(pred).length;
  const toggle = (key: "tags" | "types" | "licenses", val: string) =>
    setF((s) => ({ ...s, [key]: s[key].includes(val) ? s[key].filter((x) => x !== val) : [...s[key], val] }));
  return (
    <div className="facets">
      <FacetGroup title="Print readiness">
        <label className="check">
          <input type="checkbox" checked={f.supportFree} onChange={() => setF((s) => ({ ...s, supportFree: !s.supportFree }))} />
          <span className="box"><Icon name="check" size={13} /></span>Support-free only
          <span className="ct">{count((m) => !m.supports)}</span>
        </label>
      </FacetGroup>
      <FacetGroup title="Tags">
        {S.ALL_TAGS.slice(0, 10).map((t) => (
          <label key={t} className="check">
            <input type="checkbox" checked={f.tags.includes(t)} onChange={() => toggle("tags", t)} />
            <span className="box"><Icon name="check" size={13} /></span>{t}
            <span className="ct">{count((m) => m.tags.includes(t))}</span>
          </label>
        ))}
      </FacetGroup>
      <FacetGroup title="File type">
        {S.FILE_TYPES.map((t) => (
          <label key={t} className="check">
            <input type="checkbox" checked={f.types.includes(t)} onChange={() => toggle("types", t)} />
            <span className="box"><Icon name="check" size={13} /></span><span className="spool-mono" style={{ textTransform: "uppercase" }}>{t}</span>
            <span className="ct">{count((m) => m.files.some((fl) => fl.type === t))}</span>
          </label>
        ))}
      </FacetGroup>
      <FacetGroup title="License" defaultOpen={false}>
        {S.LICENSES.map((t) => (
          <label key={t} className="check">
            <input type="checkbox" checked={f.licenses.includes(t)} onChange={() => toggle("licenses", t)} />
            <span className="box"><Icon name="check" size={13} /></span>{t}
            <span className="ct">{count((m) => m.license === t)}</span>
          </label>
        ))}
      </FacetGroup>
    </div>
  );
}

interface ToolbarProps {
  view: "grid" | "list";
  setView: (v: "grid" | "list") => void;
  count: number;
  onToggleFilters?: () => void;
  showFilters?: boolean;
  hideFilterToggle?: boolean;
}

export function Toolbar({ view, setView, count, onToggleFilters, showFilters, hideFilterToggle }: ToolbarProps) {
  return (
    <div className="list-toolbar">
      <span className="result-count">{count} model{count !== 1 ? "s" : ""}</span>
      {!hideFilterToggle && (
        <button className="btn btn-sm" onClick={onToggleFilters}>
          <Icon name="filter" size={16} /> {showFilters ? "Hide" : "Filters"}
        </button>
      )}
      <div className="spacer" />
      <div className="seg">
        <button className={view === "grid" ? "is-active" : ""} onClick={() => setView("grid")}><Icon name="grid" size={16} /></button>
        <button className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}><Icon name="rows" size={16} /></button>
      </div>
    </div>
  );
}
