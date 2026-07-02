import type {
  CapabilityDocumentSnapshot,
  CapabilityStatus,
  CapabilityWarning,
} from "./capability-types"

export type { CapabilityDocumentSnapshot } from "./capability-types"

type WarningCapability = {
  id: string
  status: CapabilityStatus
  recommendedAction?: string
}

const WARNING_CAPABILITIES: Record<string, WarningCapability> = {
  "color.browser-rgba": {
    id: "color.browser-rgba",
    status: "usable",
    recommendedAction:
      "Use the high-bit pipeline warnings to identify any operation that falls back to canvas preview data.",
  },
  "color.high-bit-pipeline": {
    id: "color.high-bit-pipeline",
    status: "usable",
    recommendedAction:
      "Prefer TIFF or 16-bit PNM export when preserving high-bit sample precision matters.",
  },
  "color.icc-conversion": {
    id: "color.icc-conversion",
    status: "usable",
    recommendedAction:
      "Use professional color-managed software for contract proofs that require certified press profiles.",
  },
  "smart-object.filters": {
    id: "smart-object.filters",
    status: "usable",
  },
  "smart-object.linked": {
    id: "smart-object.linked",
    status: "usable",
    recommendedAction:
      "Use project format for preserving local smart object source metadata.",
  },
  "format.psd": {
    id: "format.psd",
    status: "approximation",
    recommendedAction:
      "Use the project format for maximum app metadata preservation when round-trip fidelity outside this app matters.",
  },
  "export.browser-raster": {
    id: "export.browser-raster",
    status: "usable",
    recommendedAction:
      "Use exported report/preflight notes for handoff limitations.",
  },
}

function warning(
  capabilityId: keyof typeof WARNING_CAPABILITIES,
  label: string,
  detail: string,
): CapabilityWarning {
  const record = WARNING_CAPABILITIES[capabilityId]
  return {
    label,
    capabilityId: record.id,
    status: record.status,
    detail,
    recommendedAction: record.recommendedAction,
  }
}

export function capabilityWarningsForDocument(
  doc: CapabilityDocumentSnapshot | null | undefined,
): CapabilityWarning[] {
  if (!doc) return []
  const warnings: CapabilityWarning[] = []
  const layers = doc.layers ?? []
  const bitDepth = Number(doc.bitDepth ?? 8)
  const colorMode = String(doc.colorMode ?? "RGB")
  const smartFilterCount = layers.reduce(
    (sum, layer) => sum + (layer.smartFilters?.length ?? 0),
    0,
  )
  const smartObjectCount = layers.filter(
    (layer) => layer.kind === "smart-object" || layer.smartObject,
  ).length
  const appOnlyLayerCount = layers.filter(
    (layer) =>
      layer.kind === "3d" ||
      layer.kind === "video" ||
      layer.kind === "adjustment" ||
      Boolean(layer.frame) ||
      Boolean(layer.artboard) ||
      Boolean(layer.threeD) ||
      Boolean(layer.video) ||
      Boolean(layer.smartFilters?.length),
  ).length

  warnings.push(
    warning(
      "color.browser-rgba",
      "Browser pixel pipeline",
      bitDepth > 8
        ? `${bitDepth}-bit documents retain typed-array edit sources where supported; the displayed canvas remains an 8-bit RGBA preview.`
        : "Rendered editing uses browser 8-bit RGBA canvas pixels.",
    ),
  )

  if (bitDepth > 8) {
    warnings.push(
      warning(
        "color.high-bit-pipeline",
        "High-bit editing",
        "High-bit typed arrays now back compatible filters, adjustment layers, brush/paint synchronization, source-vs-preview readouts, and precision TIFF/PNM exports; unsupported operations still report preview fallback risk.",
      ),
    )
  }

  if (!["RGB", "Grayscale"].includes(colorMode)) {
    warnings.push(
      warning(
        "color.icc-conversion",
        "Color mode",
        `${colorMode} mode is stored as document intent; display, filters, and export operate through browser RGB canvas data.`,
      ),
    )
  }

  if (smartFilterCount) {
    warnings.push(
      warning(
        "smart-object.filters",
        "Smart filters",
        `${smartFilterCount} smart filter${smartFilterCount === 1 ? "" : "s"} remain editable in-project; PSD/export workflows may rasterize the visual result.`,
      ),
    )
  }

  if (smartObjectCount) {
    warnings.push(
      warning(
        "smart-object.linked",
        "Smart object lifecycle",
        `${smartObjectCount} smart object layer${smartObjectCount === 1 ? "" : "s"} use browser-local smart source records with permission-aware relink/update checks, polling notifications for linked files, and tile-backed render materialization.`,
      ),
    )
  }

  if (
    appOnlyLayerCount ||
    doc.plugins?.length ||
    doc.variableDataSets?.length ||
    doc.comps?.length ||
    doc.slices?.length ||
    doc.guides?.length
  ) {
    warnings.push(
      warning(
        "format.psd",
        "PSD round trip",
        "Project format preserves more app metadata than PSD import/export; PSD workflows keep a raster-compatible subset.",
      ),
    )
  }

  warnings.push(
    warning(
      "export.browser-raster",
      "Raster export",
      "Raster export applies supported ICC conversions and embeds PNG/JPEG profile metadata; content credentials remain a handoff limitation.",
    ),
  )

  return warnings
}
