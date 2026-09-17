import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  // tsconfig maps @/* to ./*, and the route handlers import "@/lib/…".
  // Vitest does not read tsconfig paths, so without this every vi.mock("@/…")
  // fails to resolve — and vi.mock must match the specifier the module under
  // test actually imports.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
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
