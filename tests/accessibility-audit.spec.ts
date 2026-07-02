import { expect, test } from "@playwright/test"

import { createAccessibilityAuditReport, formatAccessibilityAuditReport } from "../components/photoshop/accessibility-audit"
import { PANEL_DEFINITIONS } from "../components/photoshop/panel-registry"
import { DEFAULT_SHORTCUTS } from "../components/photoshop/shortcuts"

test("accessibility audit reports keyboard focus touch and panel metadata", () => {
  const report = createAccessibilityAuditReport({
    shortcuts: [
      ...DEFAULT_SHORTCUTS,
      { id: "conflict", keys: "Ctrl+N", action: "Conflicting New", category: "Test" },
    ],
    panels: PANEL_DEFINITIONS.map((panel) => ({
      id: panel.id,
      label: panel.label,
      category: panel.category,
      keywords: panel.keywords,
      stack: panel.stack,
    })),
    dialogs: [
      { id: "preferences", label: "Preferences", usesFocusTrap: true, ariaTitle: true, ariaDescription: true },
      { id: "legacy", label: "Legacy Dialog", usesFocusTrap: false, ariaTitle: false },
    ],
    controls: [
      { id: "refresh", label: "Refresh", ariaLabel: "Refresh audit", role: "button", width: 32, height: 32, iconOnly: true },
      { id: "tiny-icon", role: "button", width: 24, height: 24, iconOnly: true },
    ],
  }, "2026-06-20T00:00:00.000Z")

  expect(report.sections.map((section) => section.id)).toEqual(["keyboard", "focus-traps", "touch-targets", "panels"])
  expect(report.summary.errors).toBeGreaterThanOrEqual(3)
  expect(report.sections.find((section) => section.id === "keyboard")?.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ severity: "error", label: "ctrl+n" })]),
  )
  expect(report.sections.find((section) => section.id === "touch-targets")?.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "control-tiny-icon-size", severity: "warn" }),
      expect.objectContaining({ id: "control-tiny-icon-label", severity: "error" }),
    ]),
  )
  expect(PANEL_DEFINITIONS.find((panel) => panel.id === "accessibility-audit")).toMatchObject({
    label: "Editor Accessibility Metadata Audit",
    category: "Inspection and Guides",
  })
  expect(formatAccessibilityAuditReport(report)).toContain("Panel and Tab ARIA")
})
