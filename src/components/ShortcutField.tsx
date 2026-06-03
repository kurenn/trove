/* ShortcutField.tsx — capture & display a global hotkey accelerator.
   Stores Tauri-format accelerators ("CommandOrControl+Shift+Space"); renders
   platform-appropriate symbols. */

import { useEffect, useState } from "react";
import { Icon } from "./Icons";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Tauri accelerator → human symbols (⌘⇧Space etc). */
export function prettyShortcut(acc: string): string {
  if (!acc) return "—";
  return acc.split("+").map((tok) => {
    switch (tok) {
      case "CommandOrControl":
      case "CmdOrCtrl": return IS_MAC ? "⌘" : "Ctrl";
      case "Command": case "Super": case "Meta": return IS_MAC ? "⌘" : "Win";
      case "Control": return IS_MAC ? "⌃" : "Ctrl";
      case "Alt": case "Option": return IS_MAC ? "⌥" : "Alt";
      case "Shift": return "⇧";
      case "Space": return "Space";
      default: return tok;
    }
  }).join(IS_MAC ? "" : "+");
}

/** Build a Tauri accelerator from a KeyboardEvent, or null if not a valid combo. */
function toAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.metaKey || e.ctrlKey) mods.push("CommandOrControl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");

  let key: string | null = null;
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit[0-9]$/.test(c)) key = c.slice(5);
  else if (/^F\d{1,2}$/.test(c)) key = c;
  else if (c === "Space") key = "Space";
  else if (c === "ArrowUp") key = "Up";
  else if (c === "ArrowDown") key = "Down";
  else if (c === "ArrowLeft") key = "Left";
  else if (c === "ArrowRight") key = "Right";
  else if (["Enter", "Tab", "Backslash", "Period", "Comma", "Slash"].includes(c)) key = c;

  if (!key) return null;
  // Require a modifier (or an F-key) so it's safe as a global shortcut.
  if (mods.length === 0 && !/^F\d/.test(key)) return null;
  return [...mods, key].join("+");
}

export function ShortcutField({ value, onChange }: { value: string; onChange: (acc: string) => void }) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecording(false); return; }
      // Ignore lone modifier presses; wait for a real key.
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      const acc = toAccelerator(e);
      if (acc) { onChange(acc); setRecording(false); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);

  return (
    <button
      className={"btn btn-sm" + (recording ? " btn-primary" : "")}
      style={{ minWidth: 132, fontFamily: "var(--font-mono)" }}
      onClick={() => setRecording((r) => !r)}
      title="Click, then press your shortcut">
      <Icon name="search" size={14} />
      {recording ? "Press keys…" : prettyShortcut(value)}
    </button>
  );
}
