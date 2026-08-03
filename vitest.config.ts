import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      reportsDirectory: "coverage",
      include: [
        "editor/runtime-telemetry.ts",
        "editor/diagnostics-export.ts",
        "editor/storage-registry.ts",
        "editor/store.ts",
        "editor/selectors.ts",
        "editor/reducer-model.ts",
      ],
    },
  },
})
