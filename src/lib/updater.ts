/* updater.ts — in-app auto-update via tauri-plugin-updater. Checks the signed
   `latest.json` published on GitHub Releases, then downloads → verifies → installs
   → relaunches. The Update object isn't serializable, so it's held module-side;
   the store only keeps the available version string for rendering. */

import { isTauri } from "./tauri";

// The pending Update handle from the last successful check (has the install method).
let pending: { version: string; downloadAndInstall: (cb?: (e: DownloadEvent) => void) => Promise<void> } | null = null;

interface DownloadEvent {
  event: "Started" | "Progress" | "Finished";
  data?: { contentLength?: number; chunkLength?: number };
}

/** Check the release feed. Returns the new version string if an update is
    available, or null if already up to date. THROWS on failure (network, feed,
    config) — so callers can distinguish "up to date" from "couldn't check" rather
    than silently claiming the app is current. */
export async function checkForUpdate(): Promise<string | null> {
  if (!isTauri) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (update) {
    pending = update as unknown as typeof pending;
    return update.version;
  }
  pending = null;
  return null;
}

export function hasPendingUpdate(): boolean {
  return pending != null;
}

/** Download + install the pending update, reporting 0–100 progress, then relaunch
    into the new version. Throws on failure so the caller can surface it. */
export async function installPendingUpdate(onProgress?: (pct: number) => void): Promise<void> {
  if (!pending) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  let total = 0;
  let received = 0;
  await pending.downloadAndInstall((e: DownloadEvent) => {
    if (e.event === "Started") total = e.data?.contentLength ?? 0;
    else if (e.event === "Progress") {
      received += e.data?.chunkLength ?? 0;
      if (total > 0) onProgress?.(Math.min(100, Math.round((received / total) * 100)));
    } else if (e.event === "Finished") onProgress?.(100);
  });
  await relaunch();
}
