import type { Shortcut } from "./shortcuts"

export type AccessibilityAuditSeverity = "ok" | "info" | "warn" | "error"

export interface AccessibilityAuditFinding {
  id: string
  label: string
  severity: AccessibilityAuditSeverity
  detail: string
}

export interface AccessibilityAuditSection {
  id: "keyboard" | "focus-traps" | "touch-targets" | "panels"
  title: string
  findings: AccessibilityAuditFinding[]
}

export interface AccessibilityAuditPanelTarget {
  id: string
  label: string
  category?: string
  keywords?: readonly string[]
  stack?: string
}

export interface AccessibilityAuditDialogTarget {
  id: string
  label: string
  usesFocusTrap: boolean
  ariaTitle: boolean
  ariaDescription?: boolean
}

export interface AccessibilityAuditControlTarget {
  id: string
  label?: string
  role?: string
  ariaLabel?: string
  width: number
  height: number
  iconOnly?: boolean
}

export interface AccessibilityAuditInput {
  shortcuts: readonly Shortcut[]
  panels: readonly AccessibilityAuditPanelTarget[]
  dialogs?: readonly AccessibilityAuditDialogTarget[]
  controls?: readonly AccessibilityAuditControlTarget[]
}

export interface AccessibilityAuditReport {
  generatedAt: string
  summary: {
    errors: number
    warnings: number
    info: number
    keyboardShortcuts: number
    focusTrapTargets: number
    touchTargets: number
    panels: number
  }
  sections: AccessibilityAuditSection[]
}

function shortcutCombos(keys: string) {
  return keys
    .split("/")
    .map((combo) => combo.trim())
    .filter(Boolean)
}

function statusFinding(id: string, label: string, severity: AccessibilityAuditSeverity, detail: string): AccessibilityAuditFinding {
  return { id, label, severity, detail }
}

function keyboardFindings(shortcuts: readonly Shortcut[]): AccessibilityAuditFinding[] {
  const findings: AccessibilityAuditFinding[] = []
  const comboToShortcut = new Map<string, Shortcut[]>()
  for (const shortcut of shortcuts) {
    const combos = shortcutCombos(shortcut.keys)
    if (!combos.length) {
      findings.push(statusFinding(`shortcut-${shortcut.id}-unassigned`, shortcut.action, "warn", "Shortcut action has no assigned key sequence."))
      continue
    }
    for (const combo of combos) {
      const normalized = combo.toLowerCase()
      comboToShortcut.set(normalized, [...(comboToShortcut.get(normalized) ?? []), shortcut])
    }
  }
  for (const [combo, owners] of comboToShortcut) {
    const actionNames = [...new Set(owners.map((owner) => owner.action))]
    if (actionNames.length > 1) {
      findings.push(statusFinding(
        `shortcut-conflict-${combo.replace(/[^a-z0-9]+/g, "-")}`,
        combo,
        "error",
        `Shortcut is assigned to multiple actions: ${actionNames.join(", ")}.`,
      ))
    }
  }
  if (!findings.length) {
    findings.push(statusFinding("keyboard-map-ok", "Keyboard map", "ok", `${shortcuts.length} shortcuts have assigned non-conflicting key sequences.`))
  }
  return findings
}

function focusTrapFindings(dialogs: readonly AccessibilityAuditDialogTarget[]): AccessibilityAuditFinding[] {
  if (!dialogs.length) return [statusFinding("focus-traps-empty", "Focus traps", "info", "No dialog audit targets were provided.")]
  const findings: AccessibilityAuditFinding[] = []
  for (const dialog of dialogs) {
    if (!dialog.usesFocusTrap) {
      findings.push(statusFinding(`dialog-${dialog.id}-focus`, dialog.label, "error", "Dialog does not declare a focus-trap primitive."))
    }
    if (!dialog.ariaTitle) {
      findings.push(statusFinding(`dialog-${dialog.id}-title`, dialog.label, "warn", "Dialog is missing an accessible title target."))
    }
    if (dialog.usesFocusTrap && dialog.ariaTitle) {
      findings.push(statusFinding(`dialog-${dialog.id}-ok`, dialog.label, "ok", dialog.ariaDescription ? "Focus trap, title, and description are declared." : "Focus trap and title are declared."))
    }
  }
  return findings
}

function touchTargetFindings(controls: readonly AccessibilityAuditControlTarget[]): AccessibilityAuditFinding[] {
  if (!controls.length) return [statusFinding("touch-targets-empty", "Touch targets", "info", "No control audit targets were provided.")]
  const findings: AccessibilityAuditFinding[] = []
  for (const control of controls) {
    if (control.width < 32 || control.height < 32) {
      findings.push(statusFinding(`control-${control.id}-size`, control.label ?? control.id, "warn", `${control.width}x${control.height}px is below the 32px minimum target used by compact editor chrome.`))
    }
    if (control.iconOnly && !control.ariaLabel && !control.label) {
      findings.push(statusFinding(`control-${control.id}-label`, control.id, "error", "Icon-only control is missing an aria-label or visible label."))
    }
  }
  if (!findings.length) {
    findings.push(statusFinding("touch-targets-ok", "Touch targets", "ok", `${controls.length} controls meet compact editor target and labeling checks.`))
  }
  return findings
}

function panelFindings(panels: readonly AccessibilityAuditPanelTarget[]): AccessibilityAuditFinding[] {
  const findings: AccessibilityAuditFinding[] = []
  const ids = new Set<string>()
  for (const panel of panels) {
    if (ids.has(panel.id)) {
      findings.push(statusFinding(`panel-${panel.id}-duplicate`, panel.id, "error", "Panel id is duplicated in the registry."))
    }
    ids.add(panel.id)
    if (!panel.label.trim()) {
      findings.push(statusFinding(`panel-${panel.id}-label`, panel.id, "error", "Panel tab is missing a visible label."))
    }
    if (!panel.keywords?.length) {
      findings.push(statusFinding(`panel-${panel.id}-keywords`, panel.label || panel.id, "warn", "Panel has no search keywords, reducing keyboard discoverability."))
    }
    if (!panel.category) {
      findings.push(statusFinding(`panel-${panel.id}-category`, panel.label || panel.id, "info", "Panel has no category for command-palette grouping."))
    }
  }
  if (!findings.length) {
    findings.push(statusFinding("panels-ok", "Panel tabs", "ok", `${panels.length} panels have labels, categories, and search metadata.`))
  }
  return findings
}

export function createAccessibilityAuditReport(input: AccessibilityAuditInput, generatedAt = new Date().toISOString()): AccessibilityAuditReport {
  const sections: AccessibilityAuditSection[] = [
    { id: "keyboard", title: "Keyboard Map", findings: keyboardFindings(input.shortcuts) },
    { id: "focus-traps", title: "Focus Traps", findings: focusTrapFindings(input.dialogs ?? []) },
    { id: "touch-targets", title: "Touch Targets", findings: touchTargetFindings(input.controls ?? []) },
    { id: "panels", title: "Panel and Tab ARIA", findings: panelFindings(input.panels) },
  ]
  const all = sections.flatMap((section) => section.findings)
  return {
    generatedAt,
    summary: {
      errors: all.filter((finding) => finding.severity === "error").length,
      warnings: all.filter((finding) => finding.severity === "warn").length,
      info: all.filter((finding) => finding.severity === "info").length,
      keyboardShortcuts: input.shortcuts.length,
      focusTrapTargets: input.dialogs?.length ?? 0,
      touchTargets: input.controls?.length ?? 0,
      panels: input.panels.length,
    },
    sections,
  }
}

export function formatAccessibilityAuditReport(report: AccessibilityAuditReport) {
  const lines = [
    "Accessibility Audit Report",
    `Generated: ${report.generatedAt}`,
    `Summary: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.info} informational findings`,
    "",
  ]
  for (const section of report.sections) {
    lines.push(section.title)
    for (const finding of section.findings) {
      lines.push(`- [${finding.severity}] ${finding.label}: ${finding.detail}`)
    }
    lines.push("")
  }
  return lines.join("\n").trimEnd() + "\n"
}
