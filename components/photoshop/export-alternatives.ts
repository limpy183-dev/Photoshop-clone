/**
 * Maps export-format limitation/warning text to one or more "use X instead"
 * alternative formats that resolve the limitation. Consumed by the export
 * dialogs (export-as-dialog, batch-export-dialog) to render actionable
 * one-click switch buttons next to each warning.
 *
 * Rules of thumb:
 *  - alpha loss      -> PNG (lossless RGBA) and WebP (smaller RGBA)
 *  - 256-color limit -> PNG (true color) and WebP (true color)
 *  - browser encoder unavailable for WebP/AVIF -> PNG, JPEG
 *  - WebM unavailable in this browser -> APNG / animated WebP / GIF / PNG ZIP
 *  - high-bit precision loss -> TIFF (16/32-bit), PGM/PPM (16-bit)
 *  - layer/transparency loss in JPEG / animation -> PNG
 *  - SVG: editable vectors flattened -> SVG itself preserves structure
 *
 * All alternative ids are values you can pass straight to `setFormat()` in
 * the export-as dialog (ExportFormat) or to `setFormat()` in the batch-export
 * dialog (BrowserRasterExportFormat).
 */

import type { ExportFormat, CompatibilityManifestEntry, BrowserRasterExportFormat } from "./document-io"

export interface ExportAlternative {
  /** Target ExportFormat (export-as) or BrowserRasterExportFormat (batch). */
  format: string
  /** Short button label, e.g. "Use PNG". */
  label: string
  /** Reason this alternative resolves the warning, shown in tooltip. */
  reason: string
}

/**
 * Returns the alternatives to suggest given the active format and a single
 * limitation/warning record. Returns an empty array when the warning
 * cannot be addressed by switching formats (e.g. an ICC limitation that is
 * about external workflow integrity, not the chosen encoder).
 */
export function alternativesForLimitation(
  currentFormat: ExportFormat,
  item: { label: string; detail: string; status?: string },
): ExportAlternative[] {
  const text = `${item.label} ${item.detail}`.toLowerCase()
  const out: ExportAlternative[] = []

  // ---- Alpha / transparency loss ----
  if (
    /alpha transparency/i.test(item.label) ||
    /no alpha channel/.test(text) ||
    /alpha channel/.test(text) ||
    /composited against the selected matte/.test(text)
  ) {
    if (currentFormat !== "png") {
      out.push({
        format: "png",
        label: "Use PNG",
        reason: "PNG preserves the alpha channel without flattening to the matte color.",
      })
    }
    if (currentFormat !== "webp") {
      out.push({
        format: "webp",
        label: "Use WebP",
        reason: "WebP also preserves alpha and usually produces smaller files than PNG.",
      })
    }
  }

  // ---- GIF: 256 colors / palette / 1-bit transparency ----
  if (
    /gif palette/i.test(item.label) ||
    /256-color/.test(text) ||
    /256 color/.test(text) ||
    /indexed palette/.test(text) ||
    /1-bit transparency/.test(text)
  ) {
    if (currentFormat !== "png") {
      out.push({
        format: "png",
        label: "Use PNG",
        reason: "PNG-24 supports the full 24-bit color range with 8-bit alpha (no 256-color quantization).",
      })
    }
    if (currentFormat !== "webp") {
      out.push({
        format: "webp",
        label: "Use WebP",
        reason: "WebP supports 24-bit color plus alpha and produces smaller files than PNG.",
      })
    }
  }

  // ---- Frame animation but no animation in current format ----
  if (/timeline frames can be converted to gif/i.test(text) || /single-frame/.test(text)) {
    if (currentFormat !== "apng" && currentFormat === "gif") {
      out.push({
        format: "apng",
        label: "Use APNG",
        reason: "APNG preserves 24-bit color and full alpha across frames; GIF is limited to 256 colors.",
      })
      out.push({
        format: "animated-webp",
        label: "Use Anim WebP",
        reason: "Animated WebP supports lossy/lossless frames with alpha and full color depth.",
      })
    }
  }

  // ---- High-bit precision loss ----
  if (
    /high-bit/i.test(item.label) ||
    /16-bit/.test(text) ||
    /32-bit/.test(text) ||
    /bit depth/.test(text) ||
    /typed-array/.test(text) ||
    /bits per channel/.test(text)
  ) {
    if (currentFormat !== "tiff") {
      out.push({
        format: "tiff",
        label: "Use TIFF",
        reason: "TIFF preserves 16/32-bit typed-array samples directly instead of routing through an 8-bit canvas blob.",
      })
    }
    if (currentFormat !== "pgm" && currentFormat !== "ppm") {
      out.push({
        format: "ppm",
        label: "Use PPM",
        reason: "Netpbm PPM/PGM encodes 16-bit samples without browser canvas downcasting.",
      })
    }
  }

  // ---- Color mode / ICC related: keep noisy items quiet, only suggest TIFF
  // when ICC + non-RGB is at risk and the format itself can't carry profile data.
  if (
    /icc profile embedding/i.test(item.label) &&
    (item.status === "unsupported" || /does not carry an icc profile payload/i.test(text))
  ) {
    if (currentFormat !== "png") {
      out.push({
        format: "png",
        label: "Use PNG",
        reason: "PNG embeds the converted ICC profile in an iCCP chunk.",
      })
    }
    if (currentFormat !== "tiff") {
      out.push({
        format: "tiff",
        label: "Use TIFF",
        reason: "TIFF embeds the converted ICC profile in tag 34675.",
      })
    }
  }

  // ---- Metadata embedding unsupported in current format ----
  if (
    /metadata embedding/i.test(item.label) &&
    (item.status === "unsupported" || /this format does not carry the app's export metadata fields/i.test(text))
  ) {
    if (currentFormat !== "png") {
      out.push({
        format: "png",
        label: "Use PNG",
        reason: "PNG embeds XMP, C2PA, IPTC, and EXIF metadata chunks.",
      })
    }
    if (currentFormat !== "jpeg") {
      out.push({
        format: "jpeg",
        label: "Use JPEG",
        reason: "JPEG embeds XMP and C2PA APP segments.",
      })
    }
  }

  // ---- Editable vector flatten when current format is raster, except SVG ----
  if (
    /editable vector/i.test(item.label) &&
    item.status === "flattened" &&
    currentFormat !== "svg"
  ) {
    out.push({
      format: "svg",
      label: "Use SVG",
      reason: "SVG preserves editable vector structure where browser-safe geometry is available.",
    })
  }

  // ---- Editable text flatten ----
  if (
    /editable text/i.test(item.label) &&
    item.status === "flattened" &&
    currentFormat !== "svg" &&
    currentFormat !== "metadata-json"
  ) {
    out.push({
      format: "metadata-json",
      label: "Use Sidecar",
      reason: "The metadata sidecar JSON preserves editable text layer descriptors next to the raster file.",
    })
  }

  // Deduplicate by format.
  const seen = new Set<string>()
  return out.filter((alt) => {
    if (seen.has(alt.format)) return false
    seen.add(alt.format)
    return true
  })
}

/**
 * Returns alternatives suggested by a top-level compatibility-manifest warning
 * string (a flat sentence like "JPEG does not preserve transparency...").
 */
export function alternativesForWarning(
  currentFormat: ExportFormat,
  warning: string,
): ExportAlternative[] {
  return alternativesForLimitation(currentFormat, { label: "Warning", detail: warning })
}

/**
 * Variant for the simpler batch-export dialog which only handles
 * BrowserRasterExportFormat values. Filters the export-as alternatives down
 * to the set the batch dialog can actually switch to.
 */
export function batchAlternativesForLimitation(
  currentFormat: BrowserRasterExportFormat,
  item: { label: string; detail: string; status?: string },
): ExportAlternative[] {
  const allowed = new Set<string>(["png", "jpeg", "webp", "avif", "gif"])
  return alternativesForLimitation(currentFormat as ExportFormat, item).filter((alt) =>
    allowed.has(alt.format),
  )
}

/**
 * Convenience: given a list of manifest entries and warnings, build a flat
 * set of (warning, alternative[]) pairs deduplicated by display label.
 */
export interface ResolvedExportAlternative {
  key: string
  label: string
  detail: string
  status?: string
  alternatives: ExportAlternative[]
}

export function resolveExportAlternatives(
  currentFormat: ExportFormat,
  items: CompatibilityManifestEntry[],
  warnings: string[] = [],
): ResolvedExportAlternative[] {
  const resolved: ResolvedExportAlternative[] = []
  for (const item of items) {
    const alternatives = alternativesForLimitation(currentFormat, item)
    if (!alternatives.length) continue
    resolved.push({
      key: `item:${item.label}`,
      label: item.label,
      detail: item.detail,
      status: item.status,
      alternatives,
    })
  }
  for (const warning of warnings) {
    const alternatives = alternativesForWarning(currentFormat, warning)
    if (!alternatives.length) continue
    resolved.push({
      key: `warning:${warning.slice(0, 60)}`,
      label: "Compatibility warning",
      detail: warning,
      alternatives,
    })
  }
  return resolved
}
