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
        "components/photoshop/runtime-telemetry.ts",
        "components/photoshop/diagnostics-export.ts",
        "components/photoshop/storage-registry.ts",
        "components/photoshop/editor-store.ts",
        "components/photoshop/editor-selectors.ts",
        "components/photoshop/editor-reducer-model.ts",
      ],
    },
  },
})
