import {
  DEFAULT_PREFERENCES,
  loadPreferencesFromStorage,
  type CursorStylePreference,
  type RulerUnitPreference,
} from "./preferences-engine"
import type { CustomShapeId, Layer, PathHandleMode, ShapeProps } from "./types"

export interface CanvasRuntimePreferences {
  cursorStyle: CursorStylePreference
  showBrushPreview: boolean
  showBrushSizeCrosshair: boolean
  showToolStatusHud: boolean
  screenDpi: number
  printResolution: number
  rulerUnits: RulerUnitPreference
}

export type MoveToolRuntimeOptions = {
  autoSelect: boolean
  select: "layer" | "group"
  showTransformControls: boolean
}

export type ShapeToolRuntimeOptions = {
  strokeWidth: number
  radius: number
  sides: number
  innerRadiusRatio: number
  vertexRoundness: number
  polygonStarMode: boolean
  smoothCorners: boolean
  smoothIndent: boolean
  rotation: number
  cornerRadiusTL?: number
  cornerRadiusTR?: number
  cornerRadiusBR?: number
  cornerRadiusBL?: number
}

export type PathToolRuntimeOptions = {
  handleMode: PathHandleMode
}

export type FrameToolRuntimeOptions = {
  shape: "rect" | "ellipse"
}

export type EyedropperSampleSize = "point" | "3x3" | "5x5"

declare global {
  interface Window {
    __psMoveOptions?: Partial<MoveToolRuntimeOptions>
    __psShapeOptions?: Partial<ShapeToolRuntimeOptions>
    __psPathOptions?: Partial<PathToolRuntimeOptions>
    __psFrameOptions?: Partial<FrameToolRuntimeOptions>
    __psCustomShape?: string
    __psCustomShapePreset?: ShapeProps
    __psEyedropperSampleSize?: EyedropperSampleSize
  }
}

export const clampZoom = (v: number) => Math.max(0.05, Math.min(32, v))

export function getMoveRuntimeOptions(): MoveToolRuntimeOptions {
  return {
    autoSelect: window.__psMoveOptions?.autoSelect ?? true,
    select: window.__psMoveOptions?.select ?? "layer",
    showTransformControls: window.__psMoveOptions?.showTransformControls ?? false,
  }
}

export function getShapeRuntimeOptions(): ShapeToolRuntimeOptions {
  return {
    strokeWidth: Math.max(0, window.__psShapeOptions?.strokeWidth ?? 0),
    radius: Math.max(0, window.__psShapeOptions?.radius ?? 0),
    sides: Math.max(3, Math.min(64, window.__psShapeOptions?.sides ?? 6)),
    innerRadiusRatio: Math.max(0.05, Math.min(0.95, window.__psShapeOptions?.innerRadiusRatio ?? 0.45)),
    vertexRoundness: Math.max(0, Math.min(1, window.__psShapeOptions?.vertexRoundness ?? 0)),
    polygonStarMode: window.__psShapeOptions?.polygonStarMode === true,
    smoothCorners: window.__psShapeOptions?.smoothCorners === true,
    smoothIndent: window.__psShapeOptions?.smoothIndent === true,
    rotation: window.__psShapeOptions?.rotation ?? 0,
    cornerRadiusTL: window.__psShapeOptions?.cornerRadiusTL,
    cornerRadiusTR: window.__psShapeOptions?.cornerRadiusTR,
    cornerRadiusBR: window.__psShapeOptions?.cornerRadiusBR,
    cornerRadiusBL: window.__psShapeOptions?.cornerRadiusBL,
  }
}

export function getPathRuntimeOptions(): PathToolRuntimeOptions {
  return {
    handleMode: window.__psPathOptions?.handleMode ?? "symmetric",
  }
}

export function getFrameRuntimeOptions(): FrameToolRuntimeOptions {
  return {
    shape: window.__psFrameOptions?.shape ?? "rect",
  }
}

export function getCustomShapeRuntimeId(): CustomShapeId {
  const shape = window.__psCustomShape
  const supported: readonly CustomShapeId[] = [
    "star5",
    "star6",
    "heart",
    "arrow-right",
    "arrow-left",
    "arrow-up",
    "arrow-down",
    "speech",
    "check",
    "cross",
    "lightning",
    "polygon-hex",
    "polygon-tri",
    "diamond",
  ]
  return supported.includes(shape as CustomShapeId) ? (shape as CustomShapeId) : "star5"
}

export function getCustomShapeRuntimePreset(): ShapeProps | null {
  const preset = window.__psCustomShapePreset
  if (!preset || typeof preset !== "object") return null
  return preset
}

export function getEyedropperSampleSize(): EyedropperSampleSize {
  return window.__psEyedropperSampleSize ?? "point"
}

export function readCanvasRuntimePreferences(): CanvasRuntimePreferences {
  const prefs = loadPreferencesFromStorage()
  return canvasRuntimePreferencesFrom(prefs)
}

export function defaultCanvasRuntimePreferences(): CanvasRuntimePreferences {
  return canvasRuntimePreferencesFrom(DEFAULT_PREFERENCES)
}

export function canvasRuntimePreferencesFrom(
  prefs: ReturnType<typeof loadPreferencesFromStorage>,
): CanvasRuntimePreferences {
  return {
    cursorStyle: prefs.toolBehavior.cursorStyle,
    showBrushPreview: prefs.toolBehavior.showBrushPreview,
    showBrushSizeCrosshair: prefs.toolBehavior.showBrushSizeCrosshair,
    showToolStatusHud: prefs.toolBehavior.showToolStatusHud,
    screenDpi: prefs.rulerGrid.screenDpi,
    printResolution: prefs.rulerGrid.printResolution,
    rulerUnits: prefs.rulerGrid.rulerUnits,
  }
}

export function layerBlocksAllEdits(layer: Layer | null | undefined) {
  return !layer || layer.locked || layer.lockAll
}

export function layerAllowsDrawing(layer: Layer | null | undefined): layer is Layer {
  return Boolean(layer && !layerBlocksAllEdits(layer) && !layer.lockDraw && layer.kind !== "group")
}

export function layerAllowsMoving(layer: Layer | null | undefined): layer is Layer {
  return Boolean(layer && !layerBlocksAllEdits(layer) && !layer.lockMove && layer.kind !== "group")
}
