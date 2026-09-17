/* ReindexBanner.tsx — slim strip shown when a library was indexed by an older
   scan version (typically right after an update that changed naming/grouping or
   added previews). "Reindex now" rescans just those libraries; the notice then
   hides while they scan and disappears for good once each scan completes, because
   the backend's `stale` flag clears. The X dismisses until the next launch, like
   UpdateBanner — it comes back while the index is still out of date.
   Copy mentions this release's changes; refresh it on the next SCAN_VERSION bump. */

import { useState } from "react";
import { Icon } from "./Icons";
import { useApp } from "../lib/store";
import { api, isTauri } from "../lib/tauri";
import { librariesNeedingReindex } from "../data/dataset";

export function ReindexBanner() {
  const libraries = useApp((s) => s.libraries);
  const setLibraries = useApp((s) => s.setLibraries);
  const toast = useApp((s) => s.toast);
  const [dismissed, setDismissed] = useState(false);
  const stale = librariesNeedingReindex(libraries);
  if (dismissed || !stale.length) return null;

  const reindex = async () => {
    toast("Reindexing — large libraries can take a while. Previews fill in as it goes.");
    if (!isTauri) {
      // Browser/mock: nothing to scan; just clear the flag so the notice can be previewed.
      setLibraries(libraries.map((l) => ({ ...l, stale: false })));
      return;
    }
    for (const l of stale) {
      try {
        setLibraries(await api.rescanLibrary(l.id)); // rows come back 'scanning' → notice hides
      } catch (e) {
        toast(`Couldn't reindex ${l.name}: ${e}`);
      }
    }
  };

  const target = stale.length === 1 ? <b>{stale[0].name}</b> : <>your <b>{stale.length} libraries</b></>;

  return (
    <div className="update-banner" role="status">
      <Icon name="refresh" size={16} />
      <span className="ub-text">
        This update improves previews and model names. Reindex {target} once to pick them up.
      </span>
      <button className="ub-btn" onClick={reindex}><Icon name="refresh" size={14} /> Reindex now</button>
      <button className="ub-x" onClick={() => setDismissed(true)} aria-label="Dismiss"><Icon name="x" size={15} /></button>
    </div>
  );
}
