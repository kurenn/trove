import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev server. https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // Prevent Vite from obscuring Rust errors.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // Don't watch the Rust side.
      ignored: ["**/src-tauri/**"],
    },
  },
  // occt-import-js ships a wasm asset that should not be inlined.
  assetsInclude: ["**/*.wasm"],
  build: {
    target: "es2021",
    sourcemap: true,
  },
});
