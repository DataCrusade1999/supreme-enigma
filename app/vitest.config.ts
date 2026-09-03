import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    passWithNoTests: true,
    setupFiles: ["./vitest.setup.ts"],
    // Vitest replaces its default exclude list entirely when one is given, so
    // spread the defaults rather than restating them — a hand-written list
    // silently drops whichever defaults it forgets.
    exclude: [...configDefaults.exclude, "**/.next/**", "e2e/**"],
  },
});
