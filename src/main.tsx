import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Launcher } from "./Launcher";
import { isTauri } from "./lib/tauri";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/launcher.css";

async function boot() {
  let isLauncher = false;
  if (isTauri) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      isLauncher = getCurrentWindow().label === "launcher";
    } catch { /* fall back to main app */ }
  } else if (import.meta.env.DEV) {
    // Dev preview of the launcher in a plain browser: ?launcher=1
    isLauncher = new URLSearchParams(window.location.search).get("launcher") === "1";
  }

  // The boot splash is for the main app only — drop it now in the transparent
  // Quick Find launcher window. (The main window's splash is removed by App once
  // the first dataset is ready.)
  if (isLauncher) document.getElementById("boot")?.remove();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>{isLauncher ? <Launcher /> : <App />}</React.StrictMode>
  );
}

boot();
