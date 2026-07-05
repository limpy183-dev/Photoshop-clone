import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { assertBundleReportHasNoViolations } from "../../scripts/bundle-report-policy"
import { selectInitialRouteResources } from "../../scripts/measure-route-bundles.mjs"

describe("bundle report policy", () => {
  it("excludes client-loaded dynamic chunks after the route entry cutoff", () => {
    const resources = [
      {
        decodedBodySize: 100,
        encodedBodySize: 40,
        initiatorType: "script",
        name: "http://bundle.local/_next/static/chunks/main.js",
        responseEnd: 10,
        transferSize: 60,
      },
      {
        decodedBodySize: 200,
        encodedBodySize: 80,
        initiatorType: "script",
        name: "http://bundle.local/_next/static/chunks/app/editor/page.js",
        responseEnd: 20,
        transferSize: 100,
      },
      {
        decodedBodySize: 900,
        encodedBodySize: 300,
        initiatorType: "script",
        name: "http://bundle.local/_next/static/chunks/editor-shell.js",
        responseEnd: 30,
        transferSize: 340,
      },
    ]

    expect(selectInitialRouteResources(resources, 25)).toEqual(resources.slice(0, 2))
  })

  it("accepts a report without violations", () => {
    expect(() => assertBundleReportHasNoViolations({ violations: [] })).not.toThrow()
  })

  it("rejects every committed report containing a violation", () => {
    expect(() =>
      assertBundleReportHasNoViolations({
        violations: [
          {
            rule: "decoded-startup-js",
            route: "/editor",
            value: 2_000_000,
            budget: 1_572_864,
          },
        ],
      }),
    ).toThrow("/editor decoded-startup-js: 2000000 exceeds 1572864")
  })

  it("keeps optional diagnostics out of the persistent status bar graph", () => {
    const source = readFileSync("components/photoshop/status-bar.tsx", "utf8")
    for (const optionalModule of [
      "./color-pipeline",
      "./document-io",
      "./filter-preview",
      "./large-document",
      "./memory-budget",
      "./offscreen-canvas",
      "./preferences-engine",
      "./tile-only-export-planning",
    ]) {
      expect(source, optionalModule).not.toContain(`from "${optionalModule}"`)
    }
  })

  it("loads project codecs only when autosave or recovery needs them", () => {
    const source = readFileSync("components/photoshop/autosave-recovery.tsx", "utf8")
    expect(source).not.toContain('from "./document-io"')
    expect(source).toContain('import("./document-project-io")')
  })

  it("keeps filter kernels out of the default layers panel", () => {
    const source = readFileSync("components/photoshop/panels/layers-panel.tsx", "utf8")
    expect(source).not.toContain('from "../filters"')
    expect(source).toContain('from "../filters-meta"')
  })
})
