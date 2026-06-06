import { defineConfig } from "vitest/config";

// Unit tests run in plain Node (no jsdom): the specs cover pure domain logic
// (filtering, slim-payload fallbacks, windowing math) and the Zustand store with
// the Tauri bridge mocked — none of it renders React or touches the DOM.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
