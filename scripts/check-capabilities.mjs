#!/usr/bin/env node
/**
 * Capability reconciliation utility.
 *
 * Diffs human-readable capability strings written in
 * components/photoshop/advanced-subsystems.ts against the structured
 * capability records in components/photoshop/capabilities.ts and against
 * known encoder-availability invariants enforced by lower-level modules
 * (raster-codecs.ts, three-d-video-engine.ts, document-io.ts).
 *
 * The script is a static, source-text scanner: it does not import the modules
 * (which depend on the Next bundler) — it reads the source as strings and
 * applies pattern rules. It exits non-zero when at least one mismatch is
 * found, so it can be chained into `npm run verify`.
 *
 *   node scripts/check-capabilities.mjs            # prints mismatches and a summary
 *   node scripts/check-capabilities.mjs --json     # prints machine-readable JSON
 *
 * Run via:  npm run check:capabilities
 */

import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve as pathResolve, sep } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = pathResolve(here, "..")
const args = new Set(process.argv.slice(2))
const asJson = args.has("--json")

function load(relative) {
  const abs = pathResolve(ROOT, relative)
  if (!existsSync(abs)) {
    throw new Error(`Missing source file: ${relative}`)
  }
  return { path: relative.split("/").join(sep), text: readFileSync(abs, "utf8") }
}

/**
 * Returns the capability records as a Map<id, RecordObject> parsed from
 * the literal object array at the top of capabilities.ts. We do not need a
 * full parser — the file is mechanically authored, one record per `{ ... }`
 * block inside `const records = [ ... ]`.
 */
function parseCapabilityRecords(source) {
  const out = new Map()
  // Capture every object literal in the records array. A record always begins
  // with `id: "..."`.
  const recordRe = /\{\s*id:\s*"([^"]+)"[\s\S]*?\n\s*\}/g
  let match
  while ((match = recordRe.exec(source)) !== null) {
    const body = match[0]
    const id = match[1]
    const label = (/label:\s*"([^"]+)"/.exec(body) || [])[1] || ""
    const kind = (/kind:\s*"([^"]+)"/.exec(body) || [])[1] || ""
    const status = (/status:\s*"([^"]+)"/.exec(body) || [])[1] || ""
    const summary = (/summary:\s*"([\s\S]*?)"/.exec(body) || [])[1] || ""
    const limitations = []
    const limMatch = /limitations:\s*\[([\s\S]*?)\]/.exec(body)
    if (limMatch) {
      const items = limMatch[1].match(/"([^"\\]|\\.)*"/g) || []
      for (const item of items) {
        limitations.push(item.slice(1, -1))
      }
    }
    out.set(id, { id, label, kind, status, summary, limitations, raw: body })
  }
  return out
}

/**
 * Parses ADVANCED_FORMAT_CAPABILITIES entries from advanced-subsystems.ts.
 */
function parseAdvancedFormatCapabilities(source) {
  const arrayDecl = "ADVANCED_FORMAT_CAPABILITIES: AdvancedFormatCapability[] = ["
  const arrayStart = source.indexOf(arrayDecl)
  if (arrayStart < 0) return []
  // sliceStart points at the array's opening `[`, i.e. the last char of arrayDecl.
  const sliceStart = arrayStart + arrayDecl.length - 1
  // Find the matching closing bracket by counting nesting.
  let depth = 0
  let i = sliceStart
  for (; i < source.length; i++) {
    const ch = source[i]
    if (ch === "[") depth++
    else if (ch === "]") {
      depth--
      if (depth === 0) break
    }
  }
  const arrayBody = source.slice(sliceStart + 1, i)
  const entries = []
  // Each entry begins with `{ id: "..." }`. We split by counting braces.
  let braceDepth = 0
  let entryStart = -1
  for (let j = 0; j < arrayBody.length; j++) {
    const ch = arrayBody[j]
    if (ch === "{") {
      if (braceDepth === 0) entryStart = j
      braceDepth++
    } else if (ch === "}") {
      braceDepth--
      if (braceDepth === 0 && entryStart >= 0) {
        const body = arrayBody.slice(entryStart, j + 1)
        const id = (/id:\s*"([^"]+)"/.exec(body) || [])[1] || ""
        const label = (/label:\s*"([^"]+)"/.exec(body) || [])[1] || ""
        const support = (/support:\s*"([^"]+)"/.exec(body) || [])[1] || ""
        const supportLabel = (/supportLabel:\s*"([^"]+)"/.exec(body) || [])[1] || ""
        const decodePath = (/decodePath:\s*"([\s\S]*?)"/.exec(body) || [])[1] || ""
        const metadataPath = (/metadataPath:\s*"([\s\S]*?)"/.exec(body) || [])[1] || ""
        const exportPath = (/exportPath:\s*"([\s\S]*?)"/.exec(body) || [])[1] || ""
        const limitations = (/limitations:\s*"([\s\S]*?)"/.exec(body) || [])[1] || ""
        const layerResult = (/layerResult:\s*"([\s\S]*?)"/.exec(body) || [])[1] || ""
        const extensions = []
        const extMatch = /extensions:\s*\[([\s\S]*?)\]/.exec(body)
        if (extMatch) {
          for (const m of extMatch[1].matchAll(/"([^"]+)"/g)) extensions.push(m[1])
        }
        entries.push({
          id,
          label,
          extensions,
          support,
          supportLabel,
          decodePath,
          metadataPath,
          exportPath,
          limitations,
          layerResult,
          raw: body,
        })
        entryStart = -1
      }
    }
  }
  return entries
}

/**
 * Reconciliation rules. Each rule looks at one or more pieces of source text
 * and returns a list of mismatch records {severity, ruleId, message, location}.
 */
function buildRules(state) {
  const rules = []

  const advancedById = new Map(state.advanced.map((entry) => [entry.id, entry]))
  const capabilityById = state.capabilities

  // Rule 1: every advanced-subsystems entry that claims "Browser native" must
  // map to a capabilities.ts record with status `usable` or stronger, never
  // `stub`/`unsupported`.
  for (const entry of state.advanced) {
    const looksNative = entry.support === "native"
    const claimsNative =
      /Browser native/i.test(entry.supportLabel) ||
      /Decoded by the browser image engine/i.test(entry.decodePath)
    if (!looksNative && !claimsNative) continue
    // Find a matching capability id pattern.
    const candidates = []
    for (const [id, cap] of capabilityById) {
      if (!id.startsWith("format.") && !id.startsWith("export.")) continue
      const normalizedLabel = cap.label.toLowerCase()
      if (
        normalizedLabel.includes(entry.label.toLowerCase()) ||
        cap.id.split(".").pop() === entry.id ||
        // PNG/JPEG/WebP browser raster
        (entry.id === "browser-raster" && id === "export.browser-raster")
      ) {
        candidates.push(cap)
      }
    }
    if (!candidates.length) continue
    const weakest = candidates.find((cap) => cap.status === "stub" || cap.status === "unsupported")
    if (weakest) {
      rules.push({
        severity: "error",
        ruleId: "native-claim-vs-capability-status",
        message: `advanced-subsystems entry "${entry.id}" claims ${entry.supportLabel} but capability "${weakest.id}" has status="${weakest.status}".`,
        locations: ["components/photoshop/advanced-subsystems.ts", "components/photoshop/capabilities.ts"],
      })
    }
  }

  // Rule 2: any advanced-format limitations that mention "8-bit" must agree
  // with capability records that own the bit-depth statement (color.browser-rgba,
  // color.high-bit-pipeline).
  const browserRgba = capabilityById.get("color.browser-rgba")
  const highBit = capabilityById.get("color.high-bit-pipeline")
  if (!browserRgba) {
    rules.push({
      severity: "error",
      ruleId: "missing-color-browser-rgba",
      message: "capabilities.ts is missing the color.browser-rgba capability record that other modules reference.",
      locations: ["components/photoshop/capabilities.ts"],
    })
  } else if (!/8-bit RGBA/.test(browserRgba.summary) && !/8-bit/.test(browserRgba.summary)) {
    rules.push({
      severity: "error",
      ruleId: "color-browser-rgba-text",
      message: `capability "color.browser-rgba" summary should mention the 8-bit canvas pixel pipeline; got: "${browserRgba.summary.slice(0, 80)}..."`,
      locations: ["components/photoshop/capabilities.ts"],
    })
  }
  if (!highBit) {
    rules.push({
      severity: "error",
      ruleId: "missing-color-high-bit-pipeline",
      message: "capabilities.ts is missing the color.high-bit-pipeline capability record.",
      locations: ["components/photoshop/capabilities.ts"],
    })
  }

  // Rule 3: any advanced entry that mentions "ICC profile" / "ICC" / "ICC conversion" must
  // have a corresponding mention in the color.icc-conversion capability summary.
  const icc = capabilityById.get("color.icc-conversion")
  if (icc) {
    for (const entry of state.advanced) {
      if (entry.id === "browser-raster") continue
      const claimsIcc =
        /ICC/.test(entry.metadataPath) ||
        /ICC/.test(entry.exportPath) ||
        /ICC/.test(entry.decodePath) ||
        /ICC/.test(entry.limitations)
      if (!claimsIcc) continue
      if (!/ICC/i.test(icc.summary)) {
        rules.push({
          severity: "warn",
          ruleId: "advanced-icc-no-capability-mention",
          message: `advanced-subsystems entry "${entry.id}" mentions ICC but color.icc-conversion summary does not.`,
          locations: ["components/photoshop/capabilities.ts"],
        })
        break
      }
    }
  } else {
    rules.push({
      severity: "error",
      ruleId: "missing-color-icc-conversion",
      message: "capabilities.ts is missing the color.icc-conversion capability record referenced by advanced format entries.",
      locations: ["components/photoshop/capabilities.ts"],
    })
  }

  // Rule 4: video export capability says "MediaRecorder MP4/H.264 or WebM" —
  // verify that VIDEO_EXPORT_PRESETS in three-d-video-engine.ts actually lists
  // those mime types (or H.264-capable codecs).
  const videoCap = capabilityById.get("video.export-presets-frame-animation")
  if (!videoCap) {
    rules.push({
      severity: "error",
      ruleId: "missing-video-export-capability",
      message: "capabilities.ts is missing the video.export-presets-frame-animation record.",
      locations: ["components/photoshop/capabilities.ts"],
    })
  } else {
    const claimsH264 = /H\.?264/i.test(videoCap.summary) || /MP4/i.test(videoCap.summary)
    const claimsWebm = /WebM/i.test(videoCap.summary)
    const claimsFallback = /fall back/i.test(videoCap.summary) || /ZIP frame/i.test(videoCap.summary) || /timeline-package/i.test(videoCap.summary)
    const enginePath = "components/photoshop/three-d-video-engine.ts"
    const engineSource = state.video
    const enginePresetsHasH264 = /codec=avc1|codec=h264|h\.264|"video\/mp4"/i.test(engineSource)
    const enginePresetsHasWebm = /"video\/webm"/i.test(engineSource)
    const enginePresetsHasFallback = /timeline-package|fallback/i.test(engineSource)
    if (claimsH264 && !enginePresetsHasH264) {
      rules.push({
        severity: "error",
        ruleId: "video-h264-claim-vs-engine",
        message: "capability video.export-presets-frame-animation claims H.264/MP4 support but VIDEO_EXPORT_PRESETS does not list any avc1/H.264/video/mp4 codec.",
        locations: [enginePath, "components/photoshop/capabilities.ts"],
      })
    }
    if (claimsWebm && !enginePresetsHasWebm) {
      rules.push({
        severity: "error",
        ruleId: "video-webm-claim-vs-engine",
        message: "capability video.export-presets-frame-animation claims WebM support but VIDEO_EXPORT_PRESETS does not list video/webm.",
        locations: [enginePath, "components/photoshop/capabilities.ts"],
      })
    }
    if (claimsFallback && !enginePresetsHasFallback) {
      rules.push({
        severity: "error",
        ruleId: "video-fallback-claim-vs-engine",
        message: "capability video.export-presets-frame-animation claims a ZIP/timeline-package fallback but three-d-video-engine.ts does not emit a timeline-package plan.",
        locations: [enginePath, "components/photoshop/capabilities.ts"],
      })
    }
  }

  // Rule 5: capability export.browser-raster's summary mentions formats — make
  // sure that BrowserRasterExportFormat in document-io.ts at least lists png,
  // jpeg, webp, avif, gif (the formats the capability text talks about).
  const exportRaster = capabilityById.get("export.browser-raster")
  if (exportRaster) {
    const docIo = state.documentIo
    const declRe = /export type BrowserRasterExportFormat\s*=\s*([^\n;]+)/
    const decl = declRe.exec(docIo)
    if (decl) {
      const lits = decl[1].match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) || []
      const required = ["png", "jpeg", "webp", "avif", "gif"]
      for (const fmt of required) {
        if (/PNG|JPEG|WebP|AVIF|GIF/i.test(exportRaster.summary) && !lits.includes(fmt)) {
          rules.push({
            severity: "error",
            ruleId: "browser-raster-format-missing",
            message: `capability export.browser-raster references ${fmt.toUpperCase()} but BrowserRasterExportFormat does not include "${fmt}".`,
            locations: ["components/photoshop/document-io.ts", "components/photoshop/capabilities.ts"],
          })
        }
      }
    }
  }

  // Rule 6: every status string in capability records must be one of the
  // declared union members. The declaration is at the top of the file.
  const allowedStatuses = new Set(["complete", "usable", "approximation", "stub", "unsupported"])
  for (const cap of capabilityById.values()) {
    if (!allowedStatuses.has(cap.status)) {
      rules.push({
        severity: "error",
        ruleId: "invalid-status",
        message: `capability "${cap.id}" has unrecognized status="${cap.status}".`,
        locations: ["components/photoshop/capabilities.ts"],
      })
    }
  }

  // Rule 7: every advanced support label that says "Browser native" must be
  // paired with `support: "native"`, and "Decoder-backed" must be `preview`.
  for (const entry of state.advanced) {
    if (/^Browser native$/i.test(entry.supportLabel) && entry.support !== "native") {
      rules.push({
        severity: "error",
        ruleId: "advanced-support-label-mismatch",
        message: `advanced-subsystems entry "${entry.id}" says supportLabel="Browser native" but support="${entry.support}".`,
        locations: ["components/photoshop/advanced-subsystems.ts"],
      })
    }
    if (/Decoder-backed/i.test(entry.supportLabel) && entry.support === "unsupported") {
      rules.push({
        severity: "error",
        ruleId: "advanced-support-label-mismatch",
        message: `advanced-subsystems entry "${entry.id}" says supportLabel includes "Decoder-backed" but support="unsupported".`,
        locations: ["components/photoshop/advanced-subsystems.ts"],
      })
    }
  }

  // Rule 8: HEIF/HEIC and JPEG 2000 must remain "preview"-class because the
  // capability records explicitly state production conformance is outside the
  // browser pipeline.
  const heif = advancedById.get("heif")
  if (heif && heif.support === "native") {
    rules.push({
      severity: "error",
      ruleId: "heif-promoted-incorrectly",
      message: `advanced-subsystems entry "heif" is marked "native" but capability format.heif still notes ICC/certified handoff is approximated. Either downgrade or update capability summary.`,
      locations: ["components/photoshop/advanced-subsystems.ts", "components/photoshop/capabilities.ts"],
    })
  }
  const j2k = advancedById.get("jpeg2000")
  if (j2k && j2k.support === "native") {
    rules.push({
      severity: "error",
      ruleId: "jpeg2000-promoted-incorrectly",
      message: `advanced-subsystems entry "jpeg2000" is marked "native" but capability format.jpeg2000 still says production conformance is dedicated tooling.`,
      locations: ["components/photoshop/advanced-subsystems.ts", "components/photoshop/capabilities.ts"],
    })
  }

  // Rule 9: capability "format.psd" should agree with advanced-subsystems
  // that PSB exports are limited to ag-psd's RGB/8 bpc writer when both
  // entries mention encoding limits.
  const psd = capabilityById.get("format.psd")
  if (psd && psd.limitations.some((line) => /RGB/i.test(line) && /8\s*b/i.test(line))) {
    const psbCap = capabilityById.get("format.psb")
    if (psbCap && !psbCap.limitations.some((line) => /8/i.test(line) || /memory/i.test(line))) {
      rules.push({
        severity: "warn",
        ruleId: "psb-limitations-incomplete",
        message: "capability format.psd notes ag-psd's writer is RGB/8-bit only, but format.psb limitations do not mirror that statement.",
        locations: ["components/photoshop/capabilities.ts"],
      })
    }
  }

  return rules
}

function main() {
  const capabilitiesSrc = load("components/photoshop/capabilities.ts")
  const advancedSrc = load("components/photoshop/advanced-subsystems.ts")
  const videoSrc = load("components/photoshop/three-d-video-engine.ts")
  const documentIoSrc = load("components/photoshop/document-io.ts")

  const state = {
    capabilities: parseCapabilityRecords(capabilitiesSrc.text),
    advanced: parseAdvancedFormatCapabilities(advancedSrc.text),
    video: videoSrc.text,
    documentIo: documentIoSrc.text,
  }

  if (!state.capabilities.size) {
    console.error("check-capabilities: failed to parse any capability records — has capabilities.ts changed shape?")
    process.exit(2)
  }
  if (!state.advanced.length) {
    console.error("check-capabilities: failed to parse ADVANCED_FORMAT_CAPABILITIES — has advanced-subsystems.ts changed shape?")
    process.exit(2)
  }

  const findings = buildRules(state)
  const errors = findings.filter((f) => f.severity === "error")
  const warnings = findings.filter((f) => f.severity === "warn")

  if (asJson) {
    process.stdout.write(JSON.stringify({
      summary: {
        capabilities: state.capabilities.size,
        advancedFormats: state.advanced.length,
        errors: errors.length,
        warnings: warnings.length,
      },
      findings,
    }, null, 2) + "\n")
  } else {
    console.log(`Capability reconciliation: scanned ${state.capabilities.size} capability records and ${state.advanced.length} advanced-format entries`)
    if (!findings.length) {
      console.log("OK - no mismatches found.")
    } else {
      for (const f of findings) {
        const tag = f.severity === "error" ? "ERROR" : "WARN "
        console.log(`  [${tag}] ${f.ruleId}: ${f.message}`)
        for (const loc of f.locations) {
          console.log(`           @ ${loc}`)
        }
      }
      console.log(`Total: ${errors.length} error(s), ${warnings.length} warning(s)`)
    }
  }

  process.exit(errors.length ? 1 : 0)
}

main()
