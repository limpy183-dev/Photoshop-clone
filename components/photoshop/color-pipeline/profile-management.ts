import type { PipelineBitDepth, PipelineColorMode } from "../color-pipeline-conversions"

// ── Assign / Convert Profile Consistency ────────────────────────────

export interface ProfileAssignment {
  profileName: string
  intent: "perceptual" | "relative-colorimetric" | "saturation" | "absolute-colorimetric"
  blackPointCompensation: boolean
}

export interface ProfileAssignmentPlan {
  currentProfile: string
  newProfile: string
  action: "assign" | "convert"
  gamutMappingNote: string
  expectedShift: "none" | "minor" | "moderate" | "significant"
  warnings: string[]
}

/**
 * Plan a profile assignment (no pixel changes, just tag).
 */
export function planProfileAssignment(
  currentProfile: string,
  newProfile: string,
): ProfileAssignmentPlan {
  const warnings: string[] = []
  const current = (currentProfile || "sRGB").toLowerCase()
  const target = (newProfile || "sRGB").toLowerCase()

  let expectedShift: ProfileAssignmentPlan["expectedShift"] = "none"
  let gamutMappingNote = "No pixel data will be modified. Only the profile tag changes."

  if (current === target) {
    gamutMappingNote = "Same profile — no visible change."
  } else if (current.includes("srgb") && target.includes("adobe")) {
    expectedShift = "moderate"
    gamutMappingNote = "Colors will appear less saturated as the same numbers are reinterpreted in a wider gamut."
    warnings.push("Assigning a wider gamut profile without converting will desaturate the visual appearance.")
  } else if (current.includes("adobe") && target.includes("srgb")) {
    expectedShift = "moderate"
    gamutMappingNote = "Colors will appear more saturated as the same numbers are reinterpreted in a narrower gamut."
    warnings.push("Assigning a narrower profile without converting may clip some previously in-gamut colors visually.")
  } else if (current.includes("prophoto") || target.includes("prophoto")) {
    expectedShift = "significant"
    gamutMappingNote = "ProPhoto RGB has a very different gamut. Significant visual shift expected."
    warnings.push("ProPhoto assignment without conversion causes large visual shifts.")
  } else {
    expectedShift = "minor"
    gamutMappingNote = "Profile reassignment changes how pixel values are interpreted for display."
  }

  return { currentProfile, newProfile, action: "assign", gamutMappingNote, expectedShift, warnings }
}

/**
 * Plan a profile conversion (pixels are transformed).
 */
export function planProfileConversion(
  currentProfile: string,
  targetProfile: string,
  intent: string = "relative-colorimetric",
): ProfileAssignmentPlan {
  const warnings: string[] = []
  const current = (currentProfile || "sRGB").toLowerCase()
  const target = (targetProfile || "sRGB").toLowerCase()

  let expectedShift: ProfileAssignmentPlan["expectedShift"] = "none"
  let gamutMappingNote = `Pixel data will be transformed from ${currentProfile || "sRGB"} to ${targetProfile || "sRGB"} using ${intent} intent.`

  if (current === target) {
    gamutMappingNote = "Same profile — no conversion needed."
  } else if (current.includes("srgb") && (target.includes("cmyk") || target.includes("fogra"))) {
    expectedShift = "significant"
    gamutMappingNote = "RGB to CMYK conversion. Some bright saturated colors will be clipped."
    warnings.push("RGB to CMYK conversion is lossy. Out-of-gamut colors will be mapped to the nearest in-gamut color.")
  } else if (target.includes("srgb") && current.includes("adobe")) {
    expectedShift = "minor"
    gamutMappingNote = "Adobe RGB to sRGB — some saturated greens and cyans may be clipped."
  } else {
    expectedShift = "minor"
    gamutMappingNote = "Standard profile conversion with gamut mapping."
  }

  return { currentProfile, newProfile: targetProfile, action: "convert", gamutMappingNote, expectedShift, warnings }
}

/**
 * Validate whether a profile is compatible with the document's color mode and bit depth.
 */
export function validateProfileForDocument(
  profileName: string,
  colorMode: PipelineColorMode,
  bitDepth: PipelineBitDepth,
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = []
  const name = (profileName || "").toLowerCase()

  // Check color mode compatibility
  if (colorMode === "CMYK" && (name.includes("srgb") || name.includes("adobe rgb") || name.includes("prophoto"))) {
    warnings.push(`Profile "${profileName}" is an RGB profile but the document is in CMYK mode.`)
    return { valid: false, warnings }
  }
  if (colorMode === "RGB" && (name.includes("cmyk") || name.includes("fogra") || name.includes("swop"))) {
    warnings.push(`Profile "${profileName}" is a CMYK profile but the document is in RGB mode.`)
    return { valid: false, warnings }
  }
  if (colorMode === "Grayscale" && !name.includes("gray") && !name.includes("grey") && name !== "dot gain 20%" && name !== "dot gain 25%") {
    warnings.push(`Profile "${profileName}" may not be a Grayscale profile.`)
  }

  // Bit depth warnings
  if (bitDepth === 32 && name.includes("cmyk")) {
    warnings.push("32-bit float with CMYK profiles may produce unexpected results in some preview paths.")
  }

  return { valid: warnings.length === 0 || !warnings.some((w) => w.includes("is a")), warnings }
}
