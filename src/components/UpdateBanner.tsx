/* UpdateBanner.tsx — slim strip shown when a newer signed release is available.
   "Restart & update" downloads + installs + relaunches; the X dismisses until the
   next launch (the auto-check runs again then). */

import { useState } from "react";
import { Icon } from "./Icons";
import { useApp } from "../lib/store";
import { installPendingUpdate } from "../lib/updater";

export function UpdateBanner() {
  const version = useApp((s) => s.updateVersion);
  const setUpdateVersion = useApp((s) => s.setUpdateVersion);
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  if (!version) return null;

  const install = async () => {
    setBusy(true);
    try {
      await installPendingUpdate(setPct); // relaunches on success
    } catch (e) {
      toast(`Update failed: ${e}`);
      setBusy(false);
    }
  };

  return (
    <div className="update-banner">
      <Icon name="download" size={16} />
      <span className="ub-text">
        {busy ? `Downloading update… ${pct}%` : <>Trove <b>{version}</b> is available.</>}
      </span>
      {!busy && (
        <>
          <button className="ub-btn" onClick={install}><Icon name="refresh" size={14} /> Restart &amp; update</button>
          <button className="ub-x" onClick={() => setUpdateVersion(null)} aria-label="Dismiss"><Icon name="x" size={15} /></button>
        </>
      )}
    </div>
  );
}
