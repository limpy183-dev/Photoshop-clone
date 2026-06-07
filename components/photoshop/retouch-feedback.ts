import type { BrushSettings, CloneSourcePreset, CloneSourceSettings, ToolId } from "./types"

export type RetouchFeedbackTool =
  | "brush"
  | "pencil"
  | "mixer-brush"
  | "clone-stamp"
  | "healing-brush"
  | "spot-healing"
  | "patch"
  | "smudge"
  | "blur"
  | "sharpen"
  | "dodge"
  | "burn"
  | "sponge"
  | "history-brush"
  | "art-history-brush"

export interface RetouchFeedbackInput {
  tool: RetouchFeedbackTool | ToolId | string
  brush: BrushSettings
  cloneSource: CloneSourceSettings
  cursor?: { x: number; y: number } | null
}

export interface RetouchHudChip {
  label: string
  value: string
  tone: "neutral" | "accent" | "warning"
}

export interface RetouchFeedbackModel {
  primaryStatus: string
  hudChips: RetouchHudChip[]
  brushEdge: {
    radius: number
    hardnessRadius: number
    spacing: number
    scatterRadius: number
    tipKind: BrushSettings["tipShape"]
    detail: string
  }
  previewGhost: {
    visible: boolean
    sourcePoint: { x: number; y: number } | null
    destinationPoint: { x: number; y: number } | null
    scale: number
    rotation: number
    opacity: number
    label: string
  }
  healingPreview: {
    visible: boolean
    mode: "sample-required" | "source-blend" | "content-aware"
    label: string
  }
}

function activeClonePreset(cloneSource: CloneSourceSettings): CloneSourcePreset | null {
  return cloneSource.activePresetId
    ? cloneSource.presets.find((preset) => preset.id === cloneSource.activePresetId) ?? null
    : null
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function toolStatus(tool: string, hasSource: boolean) {
  if (tool === "clone-stamp" || tool === "history-brush" || tool === "art-history-brush") {
    return hasSource ? "Clone source ready" : "Set a sample point"
  }
  if (tool === "healing-brush") return hasSource ? "Healing sample ready" : "Set a sample point"
  if (tool === "spot-healing") return "Content-aware healing"
  if (tool === "mixer-brush") return "Mixer reservoir active"
  if (tool === "smudge") return "Smudge from current pixels"
  return "Brush preview active"
}

function brushDetail(brush: BrushSettings) {
  if (brush.tipShape === "bristle") {
    const wet = brush.bristleTip?.wetness ?? 25
    const density = brush.bristleTip?.density ?? 55
    return `Bristle tip, wetness ${Math.round(wet)}%, density ${Math.round(density)}%.`
  }
  if (brush.tipShape === "erodible") {
    const wear = brush.erodibleTip?.wear ?? 0
    const sharpness = brush.erodibleTip?.sharpness ?? 70
    return `Erodible tip, sharpness ${Math.round(sharpness)}%, wear ${Math.round(wear)}%.`
  }
  return `${brush.tipShape === "square" ? "Square" : "Round"} tip, ${Math.round(brush.hardness)}% hardness.`
}

export function buildRetouchingFeedbackModel(input: RetouchFeedbackInput): RetouchFeedbackModel {
  const { brush, cloneSource, cursor } = input
  const tool = String(input.tool)
  const preset = activeClonePreset(cloneSource)
  const sourcePoint = preset
    ? {
        x: round(preset.sourceX + cloneSource.offsetX),
        y: round(preset.sourceY + cloneSource.offsetY),
      }
    : null
  const destinationPoint = cursor ? { x: round(cursor.x), y: round(cursor.y) } : null
  const usesCloneSource = tool === "clone-stamp" || tool === "healing-brush" || tool === "history-brush" || tool === "art-history-brush"
  const hasSource = !!preset || (tool === "history-brush" || tool === "art-history-brush")
  const radius = Math.max(0.5, brush.size / 2)
  const scatter = Math.max(0, brush.scatter ?? 0)
  const opacity = Math.max(0.2, Math.min(0.85, cloneSource.showOverlay ? 0.42 : 0))

  const hudChips: RetouchHudChip[] = [
    { label: cloneSource.sample === "all-layers" ? "All layers" : cloneSource.sample === "current-below" ? "Current & below" : "Current layer", value: "Sample", tone: "neutral" },
    { label: cloneSource.aligned ? "Aligned" : "Non-aligned", value: "Clone", tone: cloneSource.aligned ? "neutral" : "accent" },
    { label: `${Math.round(brush.opacity)}% / ${Math.round(brush.flow)}%`, value: "Opacity / Flow", tone: "neutral" },
  ]

  if (brush.smoothing > 0) hudChips.push({ label: `${Math.round(brush.smoothing)}%`, value: "Smoothing", tone: "accent" })
  if (cloneSource.scale !== 100 || cloneSource.rotation !== 0) {
    hudChips.push({ label: `${Math.round(cloneSource.scale)}%, ${Math.round(cloneSource.rotation)}deg`, value: "Source transform", tone: "accent" })
  }
  if (usesCloneSource && !hasSource) hudChips.push({ label: "Alt-click required", value: "Source", tone: "warning" })

  return {
    primaryStatus: toolStatus(tool, hasSource),
    hudChips,
    brushEdge: {
      radius: round(radius),
      hardnessRadius: round(radius * Math.max(0, Math.min(1, brush.hardness / 100))),
      spacing: round((brush.spacing ?? 25) / 100 * brush.size),
      scatterRadius: round(scatter ? brush.size * (scatter / 100) : 0),
      tipKind: brush.tipShape ?? "round",
      detail: brushDetail(brush),
    },
    previewGhost: {
      visible: usesCloneSource && !!sourcePoint && !!destinationPoint && cloneSource.showOverlay,
      sourcePoint,
      destinationPoint,
      scale: cloneSource.scale,
      rotation: cloneSource.rotation,
      opacity,
      label: preset?.name ?? "Clone source",
    },
    healingPreview: {
      visible: tool === "spot-healing" || (tool === "healing-brush" && !!sourcePoint),
      mode: tool === "spot-healing" ? "content-aware" : sourcePoint ? "source-blend" : "sample-required",
      label: tool === "spot-healing" ? "Synthesizes from nearby texture" : sourcePoint ? "Blends sampled texture with destination tone" : "Alt-click a clean texture source before healing",
    },
  }
}
